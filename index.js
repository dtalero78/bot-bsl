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
   Después de pagar, sube el comprobante aquí: https://www.bsl.com.co/soporte-pago

3. Otros servicios y preguntas:
   - Puedes escribir cualquier pregunta relacionada con exámenes médicos ocupacionales, certificados, horarios, formas de pago, servicios adicionales o cualquier otra consulta sobre BSL y recibirás una respuesta clara y útil.

Recuerda: Tu objetivo es resolver la duda del usuario lo más breve posible, con instrucciones claras y si la pregunta no está relacionada con la información de BSL, responde "Por el momento solo puedo resolver dudas sobre exámenes ocupacionales y servicios de BSL".
`;

// Función utilitaria para enviar mensajes por WhatsApp
async function sendMessage(to, body) {
    return fetch("https://gate.whapi.cloud/messages/text", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WHAPI_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ to, body })
    });
}

// Endpoint principal
app.post('/soporte', async (req, res) => {
    try {
        const body = req.body;
        console.log("Payload recibido:", JSON.stringify(body, null, 2));
        if (!body || !body.messages || !Array.isArray(body.messages)) {
            return res.status(400).json({ success: false, error: "No hay mensajes en el payload." });
        }
        const message = body.messages[0]; // Solo procesamos el primer mensaje por simplicidad
        const tipo = message.type;
        const from = message.from || message.chat_id?.replace('@s.whatsapp.net', '');
        const to = from.includes('@s.whatsapp.net') ? from : `${from}@s.whatsapp.net`;

        // -------- 1. Si es imagen (análisis de comprobante) --------
        if (tipo === "image" && message.image && typeof message.image.id === "string") {
            const imageId = message.image.id;
            const mimeType = message.image.mime_type || "image/jpeg";
            const url = `https://gate.whapi.cloud/media/${imageId}`;
            // Descargar imagen de Whapi
            const whapiRes = await fetch(url, {
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
            // Enviar imagen a OpenAI Vision
            const prompt = "Extrae SOLO el valor pagado (valor de la transferencia en pesos colombianos) que aparece en este comprobante bancario. Responde solo el valor exacto, sin explicaciones, ni símbolos adicionales.";
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
            if (openaiJson.choices && openaiJson.choices[0] && openaiJson.choices[0].message) {
                resultado = openaiJson.choices[0].message.content;
            } else if (openaiJson.error && openaiJson.error.message) {
                resultado = `Error OpenAI: ${openaiJson.error.message}`;
            }
            // Responde al usuario por WhatsApp
            await sendMessage(to, `Hemos recibido tu comprobante. Valor detectado: $${resultado}`);
            return res.json({
                success: true,
                mensaje: "Valor detectado en el comprobante (imagen original)",
                valorDetectado: resultado
            });
        }

        // -------- 2. Si es texto (flujo de conversación con menú OpenAI) --------
        if (tipo === "text" && message.text && message.text.body) {
            // Construye contexto de conversación (puedes agregar historial, si lo guardas)
            const userMessage = message.text.body;
            // Llama a OpenAI (usando el prompt institucional y el mensaje del usuario)
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
                        { role: 'user', content: userMessage }
                    ],
                    max_tokens: 300
                })
            });
            const openaiJson = await aiRes.json();
            let respuestaBot = "No se obtuvo respuesta de OpenAI.";
            if (openaiJson.choices && openaiJson.choices[0] && openaiJson.choices[0].message) {
                respuestaBot = openaiJson.choices[0].message.content;
            } else if (openaiJson.error && openaiJson.error.message) {
                respuestaBot = `Error OpenAI: ${openaiJson.error.message}`;
            }
            // Envía respuesta por WhatsApp al usuario
            await sendMessage(to, respuestaBot);
            return res.json({
                success: true,
                mensaje: "Respuesta enviada al usuario.",
                respuesta: respuestaBot
            });
        }

        // -------- 3. Si no es texto ni imagen --------
        return res.status(200).json({ success: false, mensaje: "Tipo de mensaje no soportado." });

    } catch (error) {
        console.error("Error general en /soporte:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Inicia el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor escuchando en puerto", PORT);
});
