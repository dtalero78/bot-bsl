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

INFORMACIÓN INSTITUCIONAL:

1. Exámenes Ocupacionales:
  - Virtual: $46.000 COP
    - Pasos: Escoge la hora, realiza las pruebas en línea, un médico te contactará, paga y descarga tu certificado al instante.
    - Incluye: Médico Osteomuscular, Audiometría, Optometría.
    - Extras disponibles (pueden tener costo adicional):
      - Cardiovascular ($5.000), Vascular ($5.000), Espirometría ($5.000), Psicológico ($15.000), Dermatológico ($5.000), Perfil lipídico y otros laboratorios.
   - Para crear la orden hay que diligenciar el siguiente link: https://www.bsl.com.co/nuevaorden-1

  - Presencial: $69.000 COP
    - Lugar: Calle 134 No. 7-83, Bogotá.
    - Horario: Lunes a Viernes 7:30 AM - 4:30 PM, Sábados 8:00 AM - 11:30 AM.
    - No necesita agendar, es por orden de llegada.
    - Incluye lo mismo que el virtual.

2. Pagos y descarga de certificados:
  - Bancolombia: Cta Ahorros 44291192456, cédula 79981585
  - Daviplata: 3014400818
  - Nequi: 3008021701

3. Sobre el servicio virtual:
  - Escoge la hora, realiza las pruebas, el médico te contacta, pagas y descargas tu certificado.

4. Incluido en el certificado básico:
  - Médico Osteomuscular
  - Audiometría
  - Optometría

5. Extras opcionales:
  - Cardiovascular ($5.000)
  - Vascular ($5.000)
  - Espirometría ($5.000)
  - Psicológico ($15.000)
  - Dermatológico ($5.000)
  - Perfil lipídico (60.000)
  - Glicemia (20.000)

INDICACIONES ADICIONALES:

- Si el usuario pregunta temas que no están relacionados con nuestro servicio, di que eres un asistente de BSL y no puedes responder otras cosas.
- Si el usuario saluda o se despide puedes saludar o despedirte de parte de BSL.
- No uses formato tipo [texto](url). Escribe solo la URL como texto.
- Resume las respuestas lo más que puedas y cuando vayas a responder varios puntos sepáralo con viñetas lo más simplificado posible.
- La mayoría de los usuarios son personas que saben leer muy poco. Debes simplificar tus respuestas.
- Si el usuario pide perfil lipídico, glicemia u otros laboratorios, dile que puede hacer el osteomuscular, visual y auditivo virtual y los laboratorios presenciales para adjuntarlos después. También sirve si ya tiene unos laboratorios hechos. Se pueden agregar.
- Si necesita prueba psicosensométrica, es obligatorio presencial.

🔴 DETENCIÓN DEL BOT:

- Si el usuario dice que quiere hablar con un asesor, o pide ayuda de una persona, **responde brevemente diciendo que será transferido** y **escribe internamente la frase especial exacta: "...transfiriendo con asesor"**. Eso hará que el sistema detenga el bot.
- Después de analizar una imagen enviada por el usuario, **responde normalmente con el análisis** y luego **escribe también la frase: "...transfiriendo con asesor"** para detener el bot tras la respuesta.
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
            const bodyText = message?.text?.body?.trim();

            if (bodyText === "...transfiriendo con asesor") {
                console.log(`🛑 Bot desactivado manualmente para ${message.chat_id}`);

                await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: message.chat_id.split("@")[0],
                        observaciones: "stop"
                    })
                });
            }

            if (bodyText === "...te dejo con el bot 🤖") {
                console.log(`✅ Bot reactivado manualmente para ${message.chat_id}`);

                await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: message.chat_id.split("@")[0],
                        observaciones: ""
                    })
                });
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
