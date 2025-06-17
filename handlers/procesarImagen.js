const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');

async function procesarImagen(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;

    const imageId = message.image?.id;
    const mimeType = message.image?.mime_type || "image/jpeg";
    const urlImg = `https://gate.whapi.cloud/media/${imageId}`;

    const whapiRes = await fetch(urlImg, {
        method: 'GET',
        headers: { "Authorization": `Bearer ${process.env.WHAPI_KEY}` }
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
            'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
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

    const { mensajes: mensajesHistorial = [] } = await obtenerConversacionDeWix(from);

    const nuevoHistorial = [
        ...mensajesHistorial,
        { from: "usuario", mensaje: "(imagen de comprobante)", timestamp: new Date().toISOString() },
        { from: "sistema", mensaje: `Hemos recibido tu comprobante. Valor detectado: $${resultado}`, timestamp: new Date().toISOString() }
    ];

    await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
    await sendMessage(to, `Hemos recibido tu comprobante. Valor detectado: $${resultado}`);

    return res.json({ success: true, mensaje: "Valor detectado en el comprobante", valorDetectado: resultado });
}

module.exports = { procesarImagen };
