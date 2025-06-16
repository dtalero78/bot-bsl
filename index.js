require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json({ limit: '10mb' }));

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHAPI_KEY = process.env.WHAPI_KEY;
const BOT_NUMBER = "573008021701";

const promptInstitucional = `
Eres un asistente virtual para exámenes médicos ocupacionales de la empresa BSL en Colombia...
[puedes reemplazar con el texto completo si lo necesitas]
`;

async function guardarConversacionEnWix({ userId, nombre, mensajes }) {
    try {
        const resp = await fetch('https://www.bsl.com.co/_functions/guardarConversacion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, nombre, mensajes })
        });
        const text = await resp.text();
        try {
            const json = JSON.parse(text);
            console.log("Conversación guardada en Wix:", json);
        } catch (parseError) {
            console.error("Respuesta de Wix NO es JSON:", text);
        }
    } catch (err) {
        console.error("Error guardando conversación en Wix:", err);
    }
}

async function obtenerConversacionDeWix(userId) {
    try {
        const resp = await fetch(`https://www.bsl.com.co/_functions/obtenerConversacion?userId=${encodeURIComponent(userId)}`);
        if (!resp.ok) return { mensajes: [], observaciones: "" };

        const json = await resp.json();
        const mensajes = json.mensajes || [];
        const observaciones = json.observaciones || "";

        return { mensajes, observaciones };
    } catch (err) {
        console.error("Error obteniendo historial de Wix:", err);
        return { mensajes: [], observaciones: "" };
    }
}



async function sendMessage(to, body) {
    const url = "https://gate.whapi.cloud/messages/text";
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WHAPI_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ to, body })
    });
    const json = await resp.json();
    console.log("Respuesta envío WhatsApp:", JSON.stringify(json, null, 2));
}

app.post('/soporte', async (req, res) => {
    try {
        const body = req.body;
        console.log("Payload recibido:", JSON.stringify(body, null, 2));

        if (!body || !body.messages || !Array.isArray(body.messages)) {
            return res.status(400).json({ success: false, error: "No hay mensajes en el payload." });
        }

        const message = body.messages[0];
       if (message.from_me === true || message.from === BOT_NUMBER) {
    const bodyText = message.text?.body || "";

    if (bodyText === "...transfiriendo con asesor") {
        const chatId = message.chat_id?.split("@")[0] || message.from;
        console.log(`🛑 Bot desactivado manualmente por mensaje especial "${bodyText}" para ${chatId}`);

        // Actualizar campo observaciones a "stop"
        try {
            await fetch('https://www.bsl.com.co/_functions/guardarObservacion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: chatId,
                    observaciones: "stop"
                })
            });
        } catch (err) {
            console.error("❌ Error actualizando observaciones:", err);
        }
    }

    console.log("Mensaje enviado por el bot, ignorado.");
    return res.json({ success: true, mensaje: "Mensaje enviado por el bot, no procesado." });
}


        const from = message.from;
        const nombre = message.from_name || "Nombre desconocido";
        const tipo = message.type;
        const chatId = message.chat_id;
        const to = chatId || `${from}@s.whatsapp.net`;

        // ✅ Obtener conversación con stopBot incluido
        const { mensajes: mensajesHistorial = [], observaciones = "" } = await obtenerConversacionDeWix(from);
console.log(`[WIX] Consulta previa | userId: ${from} | observaciones: ${observaciones}`);

if (String(observaciones).toLowerCase().includes("stop")) {
    console.log(`[STOP] Usuario bloqueado por observaciones: ${from}`);
    return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones (silencioso)." });
}



        // 🖼 Procesamiento de imagen
        if (tipo === "image" && message.image && typeof message.image.id === "string") {
            const imageId = message.image.id;
            const mimeType = message.image.mime_type || "image/jpeg";
            const urlImg = `https://gate.whapi.cloud/media/${imageId}`;

            const whapiRes = await fetch(urlImg, {
                method: 'GET',
                headers: { "Authorization": `Bearer ${WHAPI_KEY}` }
            });

            if (!whapiRes.ok) {
                const errorText = await whapiRes.text();
                console.error("Error de Whapi:", errorText);
                return res.status(500).json({ success: false, error: "No se pudo descargar la imagen de Whapi" });
            }

            const buffer = await whapiRes.buffer();
            const base64Image = buffer.toString('base64');

            const prompt = "Extrae SOLO el valor pagado (valor de la transferencia en pesos colombianos)...";
            const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                        ]
                    }],
                    max_tokens: 50
                })
            });

            const openaiJson = await aiRes.json();
            let resultado = "No se obtuvo respuesta de OpenAI.";
            if (openaiJson.choices?.[0]?.message) {
                resultado = openaiJson.choices[0].message.content;
            } else if (openaiJson.error?.message) {
                resultado = `Error OpenAI: ${openaiJson.error.message}`;
            }

            const nuevoHistorial = [
                ...mensajesHistorial,
                { from: "usuario", mensaje: "(imagen de comprobante)", timestamp: new Date().toISOString() },
                { from: "sistema", mensaje: `Hemos recibido tu comprobante. Valor detectado: $${resultado}`, timestamp: new Date().toISOString() }
            ];

            await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
            await sendMessage(to, `Hemos recibido tu comprobante. Valor detectado: $${resultado}`);

            return res.json({ success: true, mensaje: "Valor detectado en el comprobante", valorDetectado: resultado });
        }

        // 📝 Procesamiento de texto
        if (tipo === "text" && message.text?.body) {
            const userMessage = message.text.body;

            const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: promptInstitucional },
                        ...mensajesHistorial.map(m => ({
                            role: m.from === "usuario" ? "user" : "assistant",
                            content: m.mensaje
                        })),
                        { role: 'user', content: userMessage }
                    ],
                    max_tokens: 150
                })
            });

            const openaiJson = await aiRes.json();
            let respuestaBot = "No se obtuvo respuesta de OpenAI.";
            if (openaiJson.choices?.[0]?.message) {
                respuestaBot = openaiJson.choices[0].message.content;
            } else if (openaiJson.error?.message) {
                respuestaBot = `Error OpenAI: ${openaiJson.error.message}`;
            }

            const nuevoHistorial = [
                ...mensajesHistorial,
                { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
                { from: "sistema", mensaje: respuestaBot, timestamp: new Date().toISOString() }
            ];

            await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
            await sendMessage(to, respuestaBot);

            return res.json({ success: true, mensaje: "Respuesta enviada al usuario.", respuesta: respuestaBot });
        }

        return res.json({ success: true, mensaje: "Mensaje ignorado (no es texto ni imagen procesable)." });

    } catch (error) {
        console.error("Error general en /soporte:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor escuchando en puerto", PORT);
});
