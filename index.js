require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(express.json({ limit: '10mb' }));

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHAPI_KEY = process.env.WHAPI_KEY;

// Prompt institucional que usarás con OpenAI para el menú
const promptInstitucional = `
Eres un asistente virtual para exámenes médicos ocupacionales de la empresa BSL en Colombia. Tu función es guiar a los usuarios de WhatsApp y responder sus preguntas de manera clara, breve y amable, siempre en un tono profesional y cercano.

INFORMACION INSTITUCIONAL:

1. Exámenes Ocupacionales:

   - Virtual: $46.000 COP  
     Pasos: Escoge la hora, realiza las pruebas en línea, un médico te contactará, paga y descarga tu certificado al instante.  
     Incluye: Médico Osteomuscular, Audiometría, Optometría.  
     Extras disponibles (pueden tener costo adicional):  
     Cardiovascular ($5.000), Vascular ($5.000), Espirometría ($5.000), Psicológico ($15.000), Dermatológico ($5.000), Perfil lipídico y otros laboratorios.

   - Presencial: $69.000 COP  
     Lugar: Calle 134 No. 7-83, Bogotá.  
     Horario: Lunes a Viernes 7:30 AM - 4:30 PM, Sábados 8:00 AM - 11:30 AM.  
     No necesita agendar, es por orden de llegada.  
     Incluye lo mismo que el virtual.

2. Pagos y descarga de certificados:  
   Bancolombia: Cta Ahorros 44291192456, cédula 79981585  
   Daviplata: 3014400818  
   Nequi: 3008021701  
    Al hacerlo envía el soporte de pago por este medio

3. Otros servicios y preguntas:
   - Puedes escribir cualquier pregunta relacionada con exámenes médicos ocupacionales, certificados, horarios, formas de pago, servicios adicionales o cualquier otra consulta sobre BSL y recibirás una respuesta clara y útil.

Recuerda: Tu objetivo es resolver la duda del usuario lo más breve posible, con instrucciones claras y si la pregunta no está relacionada con la información de BSL, responde "Por el momento solo puedo resolver dudas sobre exámenes ocupacionales y servicios de BSL".
`;

// Función para guardar conversación en Wix
async function guardarConversacionEnWix({ userId, nombre, mensajes }) {
    try {
        const resp = await fetch('https://www.bsl.com.co/_functions/guardarConversacion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, nombre, mensajes })
        });
        const json = await resp.json();
        console.log("Conversación guardada en Wix:", json);
    } catch (err) {
        console.error("Error guardando conversación en Wix:", err);
    }
}

// Función para obtener historial de usuario desde Wix (si quieres mantener historial continuo)
async function obtenerConversacionDeWix(userId) {
    try {
        const resp = await fetch(`https://www.bsl.com.co/_functions/obtenerConversacion?userId=${encodeURIComponent(userId)}`);
        if (!resp.ok) return null;
        const json = await resp.json();
        if (json && json.mensajes) return json.mensajes;
        return [];
    } catch (err) {
        console.error("Error obteniendo historial de Wix:", err);
        return [];
    }
}

// Función para enviar mensaje por WhatsApp
async function sendMessage(to, body) {
    const url = "https://gate.whapi.cloud/messages/text";
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WHAPI_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            to: to,
            body: body
        })
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

        // Solo procesar el primer mensaje (ajusta si quieres procesar más de uno)
        const message = body.messages[0];
        const from = message.from;
        const nombre = message.from_name || "Nombre desconocido";
        const tipo = message.type;
        const chatId = message.chat_id;
        const to = chatId || `${from}@s.whatsapp.net`;

        
        // Trae historial actual desde Wix
        let mensajesHistorial = await obtenerConversacionDeWix(from) || [];

        // Si es imagen (comprobante)
        if (tipo === "image" && message.image && typeof message.image.id === "string") {
            // Descarga imagen y analiza con OpenAI
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
            console.log("Tamaño base64:", base64Image.length);

            const openaiUrl = "https://api.openai.com/v1/chat/completions";
            const prompt = "Extrae SOLO el valor pagado (valor de la transferencia en pesos colombianos) que aparece en este comprobante bancario. Responde solo el valor exacto, sin explicaciones, ni símbolos adicionales.";

            const aiRes = await fetch(openaiUrl, {
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
            console.log("Respuesta cruda de OpenAI:", JSON.stringify(openaiJson, null, 2));

            let resultado = "No se obtuvo respuesta de OpenAI.";
            if (openaiJson.choices && openaiJson.choices[0] && openaiJson.choices[0].message) {
                resultado = openaiJson.choices[0].message.content;
            } else if (openaiJson.error && openaiJson.error.message) {
                resultado = `Error OpenAI: ${openaiJson.error.message}`;
            }

            // Guarda mensajes (historial)
            mensajesHistorial = mensajesHistorial || [];
            mensajesHistorial.push({
                from: "usuario",
                mensaje: "(imagen de comprobante)",
                timestamp: new Date().toISOString()
            });
            mensajesHistorial.push({
                from: "sistema",
                mensaje: `Hemos recibido tu comprobante. Valor detectado: $${resultado}`,
                timestamp: new Date().toISOString()
            });

            await guardarConversacionEnWix({
                userId: from,
                nombre: nombre,
                mensajes: mensajesHistorial
            });

            await sendMessage(to, `Hemos recibido tu comprobante. Valor detectado: $${resultado}`);
            return res.json({
                success: true,
                mensaje: "Valor detectado en el comprobante (imagen original)",
                valorDetectado: resultado
            });
        }

        // Si es texto, responde usando OpenAI (con historial como contexto)
        if (tipo === "text" && message.text && message.text.body) {
            const userMessage = message.text.body;

            // Opcional: puedes armar el contexto como prompt aquí usando historial.
            // Ejemplo básico:
            const historialPrompt = mensajesHistorial.map(
                m => `${m.from === "usuario" ? "Usuario" : "Asistente"}: ${m.mensaje}`
            ).join('\n');
            const systemPrompt = `Eres un asistente de WhatsApp para exámenes médicos. Responde de forma amigable y clara, guiando al usuario en todo el proceso.`;
            const prompt = `${systemPrompt}\n${historialPrompt}\nUsuario: ${userMessage}\nAsistente:`;

            const openaiUrl = "https://api.openai.com/v1/chat/completions";
            const aiRes = await fetch(openaiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        // Historial puede ir como mensajes previos (mejor para OpenAI)
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
            console.log("Respuesta cruda de OpenAI:", JSON.stringify(openaiJson, null, 2));

            let respuestaBot = "No se obtuvo respuesta de OpenAI.";
            if (openaiJson.choices && openaiJson.choices[0] && openaiJson.choices[0].message) {
                respuestaBot = openaiJson.choices[0].message.content;
            } else if (openaiJson.error && openaiJson.error.message) {
                respuestaBot = `Error OpenAI: ${openaiJson.error.message}`;
            }

            // Actualiza historial
            mensajesHistorial = mensajesHistorial || [];
            mensajesHistorial.push({
                from: "usuario",
                mensaje: userMessage,
                timestamp: new Date().toISOString()
            });
            mensajesHistorial.push({
                from: "sistema",
                mensaje: respuestaBot,
                timestamp: new Date().toISOString()
            });

            await guardarConversacionEnWix({
                userId: from,
                nombre: nombre,
                mensajes: mensajesHistorial
            });

            await sendMessage(to, respuestaBot);
            return res.json({
                success: true,
                mensaje: "Respuesta enviada al usuario.",
                respuesta: respuestaBot
            });
        }

        // Si no es imagen ni texto, ignora
        return res.json({
            success: true,
            mensaje: "Mensaje ignorado (no es texto ni imagen procesable)."
        });

    } catch (error) {
        console.error("Error general en /soporte:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor escuchando en puerto", PORT);
});