require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(express.json({ limit: '10mb' })); // Por si llega base64 muy grande

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHAPI_KEY = process.env.WHAPI_KEY;

app.post('/soporte', async (req, res) => {
    try {
        const body = req.body;
        console.log("Payload recibido:", JSON.stringify(body, null, 2));

        if (!body || !body.messages || !Array.isArray(body.messages)) {
            return res.status(400).json({ success: false, error: "No hay mensajes en el payload." });
        }

        // Busca imagen en el mensaje
        const soporteEncontrado = body.messages.find(msg =>
            msg.type === "image" &&
            msg.image &&
            typeof msg.image.id === "string"
        );

        if (!soporteEncontrado) {
            return res.status(400).json({ success: false, mensaje: "No se recibió imagen válida para analizar." });
        }

        // Descarga la imagen binaria desde Whapi
        const imageId = soporteEncontrado.image.id;
        const mimeType = soporteEncontrado.image.mime_type || "image/jpeg";
        const url = `https://gate.whapi.cloud/media/${imageId}`;

        const whapiRes = await fetch(url, {
            method: 'GET',
            headers: { "Authorization": `Bearer ${WHAPI_KEY}` }
        });

        if (!whapiRes.ok) {
            const errorText = await whapiRes.text();
            console.error("Error de Whapi:", errorText);
            return res.status(500).json({ success: false, error: "No se pudo descargar la imagen de Whapi" });
        }

        // Lee la imagen como buffer
        const buffer = await whapiRes.buffer();
        const base64Image = buffer.toString('base64');
        console.log("Tamaño base64:", base64Image.length);
        console.log("Primeros 40 chars base64:", base64Image.substring(0, 40));
        console.log("MimeType:", mimeType);

        // Llama a OpenAI Vision (gpt-4o)
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

        return res.json({
            success: true,
            mensaje: "Valor detectado en el comprobante (imagen original)",
            valorDetectado: resultado
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
