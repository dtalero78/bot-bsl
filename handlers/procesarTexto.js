const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { promptInstitucional } = require('../utils/prompt');
const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');
const { generarPdfDesdeApi2Pdf, sendPdf } = require('../utils/pdf');

async function procesarTexto(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;

    const userMessage = message.text.body.trim();
    const esNumeroId = /^\d{7,10}$/.test(userMessage);

    const conversacion = await obtenerConversacionDeWix(from);
    const mensajesHistorial = conversacion.mensajes || [];
    const observaciones = conversacion.observaciones || "";
    const proximaAccion = conversacion.proximaAccion || "";

    console.log(`[WIX] Consulta previa | userId: ${from} | observaciones: ${observaciones} | proximaAccion: ${proximaAccion}`);

    if (String(observaciones).toLowerCase().includes("stop")) {
        console.log(`[STOP] Usuario bloqueado por observaciones: ${from}`);
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones (silencioso)." });
    }

    // Si hay una acción pendiente de enviar PDF y el usuario escribe un número
    if (proximaAccion === "enviar_pdf" && esNumeroId) {
        try {
            const pdfUrl = await generarPdfDesdeApi2Pdf(userMessage);
            await sendPdf(to, pdfUrl);

            const nuevoHistorial = [
                ...mensajesHistorial,
                { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
                { from: "sistema", mensaje: "Aquí tienes tu certificado médico en PDF.", timestamp: new Date().toISOString() }
            ];

            await guardarConversacionEnWix({
                userId: from,
                nombre,
                mensajes: nuevoHistorial,
                proximaAccion: null  // Limpiar intención
            });

            return res.json({ success: true, mensaje: "PDF enviado correctamente." });
        } catch (err) {
            console.error("Error generando o enviando PDF:", err);
            await sendMessage(to, "Ocurrió un error al generar tu certificado. Intenta más tarde.");
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    // Chat normal con OpenAI
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
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
            max_tokens: 200
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

    await guardarConversacionEnWix({
        userId: from,
        nombre,
        mensajes: nuevoHistorial
        // no se modifica proximaAccion aquí
    });

    await sendMessage(to, respuestaBot);

    return res.json({ success: true, mensaje: "Respuesta enviada al usuario.", respuesta: respuestaBot });
}

module.exports = { procesarTexto };
