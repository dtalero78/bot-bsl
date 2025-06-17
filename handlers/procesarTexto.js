const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { promptInstitucional } = require('../utils/prompt');
const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');
const { generarPdfDesdeApi2Pdf, sendPdf } = require('../utils/pdf');
const { consultarInformacionPaciente } = require('../utils/consultarPaciente');

async function procesarTexto(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;

    const userMessage = message.text.body.trim();
    const esNumeroId = /^\d{7,10}$/.test(userMessage);

    const { mensajes: mensajesHistorial = [], observaciones = "" } = await obtenerConversacionDeWix(from);
    console.log(`[WIX] Consulta previa | userId: ${from} | observaciones: ${observaciones}`);

    if (String(observaciones).toLowerCase().includes("stop")) {
        console.log(`[STOP] Usuario bloqueado por observaciones: ${from}`);
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones (silencioso)." });
    }

    // Detectar si envió número de documento
    if (esNumeroId) {
        const ultimoMensaje = mensajesHistorial[mensajesHistorial.length - 1]?.mensaje || "";

        const pidioConsulta = ultimoMensaje.toLowerCase().includes("consulta") ||
            ultimoMensaje.toLowerCase().includes("cita") ||
            ultimoMensaje.toLowerCase().includes("médico") ||
            ultimoMensaje.toLowerCase().includes("atención");

        // 🔔 Mensaje previo
        await sendMessage(to, "🔍 Un momento por favor, estamos consultando tu información...");

        if (esNumeroId) {
            const ultimoMensaje = mensajesHistorial[mensajesHistorial.length - 1]?.mensaje || "";

            const pidioConsulta = ultimoMensaje.toLowerCase().includes("consulta") ||
                ultimoMensaje.toLowerCase().includes("cita") ||
                ultimoMensaje.toLowerCase().includes("médico") ||
                ultimoMensaje.toLowerCase().includes("atención");

            // 🔔 Mensaje previo común
            await sendMessage(to, "🔍 Un momento por favor, estamos consultando tu información...");

            if (pidioConsulta) {
                try {
                    const info = await consultarInformacionPaciente(userMessage);

                    if (!info || info.length === 0) {
                        await sendMessage(to, "No encontré información médica con ese documento.");
                    } else {
                        const datos = info[0];
                        const opcionesFecha = {
                            timeZone: "America/Bogota",
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true
                        };

                        const fechaAtencionFormateada = datos.fechaAtencion
                            ? new Date(datos.fechaAtencion).toLocaleString("es-CO", opcionesFecha)
                            : "No registrada";

                        const resumen = `📄 Información registrada:
👤 ${datos.primerNombre} ${datos.primerApellido}
📅 Fecha consulta: ${fechaAtencionFormateada.replace(',', ' a las')}
📲 Celular: ${datos.celular || "No disponible"}`;

                        await sendMessage(to, resumen);
                    }

                    const nuevoHistorial = [
                        ...mensajesHistorial,
                        { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
                        { from: "sistema", mensaje: "Consulta médica enviada.", timestamp: new Date().toISOString() }
                    ];

                    await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
                    return res.json({ success: true, mensaje: "Consulta enviada." });

                } catch (err) {
                    console.error("❌ Error en consulta paciente:", err);
                    await sendMessage(to, "Ocurrió un error consultando la información. Intenta más tarde.");
                    return res.status(500).json({ success: false, error: err.message });
                }
            } else {
                // 🧾 Generación del PDF
                try {
                    const pdfUrl = await generarPdfDesdeApi2Pdf(userMessage);
                    await sendPdf(to, pdfUrl);

                    const nuevoHistorial = [
                        ...mensajesHistorial,
                        { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
                        { from: "sistema", mensaje: "PDF generado y enviado correctamente.", timestamp: new Date().toISOString() }
                    ];

                    await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
                    return res.json({ success: true, mensaje: "PDF generado y enviado." });

                } catch (err) {
                    console.error("Error generando o enviando PDF:", err);
                    await sendMessage(to, "Ocurrió un error al generar tu certificado. Intenta más tarde.");
                    return res.status(500).json({ success: false, error: err.message });
                }
            }
        }

    }

    // Chat con OpenAI
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

    // Si el modelo detecta que está preguntando por su consulta
    if (
        respuestaBot.toLowerCase().includes("parece que estás preguntando por tu consulta") ||
        userMessage.toLowerCase().includes("cita") ||
        userMessage.toLowerCase().includes("consulta") ||
        userMessage.toLowerCase().includes("médico") ||
        userMessage.toLowerCase().includes("atención")
    ) {
        await sendMessage(to, "Para ayudarte mejor, por favor dime tu número de documento.");

        const nuevoHistorial = [
            ...mensajesHistorial,
            { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
            { from: "sistema", mensaje: "Se solicitó el número de documento para consulta médica", timestamp: new Date().toISOString() }
        ];

        await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
        return res.json({ success: true, mensaje: "Solicitado documento para consulta médica." });
    }

    // Guardar y responder normalmente
    const nuevoHistorial = [
        ...mensajesHistorial,
        { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
        { from: "sistema", mensaje: respuestaBot, timestamp: new Date().toISOString() }
    ];

    await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
    await sendMessage(to, respuestaBot);

    return res.json({ success: true, mensaje: "Respuesta enviada al usuario.", respuesta: respuestaBot });
}

module.exports = { procesarTexto };
