const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { promptInstitucional, promptClasificador } = require('../utils/prompt');
const { sendMessage } = require('../utils/sendMessage');
const { sendPdf, generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');
const { consultarInformacionPaciente } = require('../utils/consultarPaciente');

async function procesarTexto(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;
    const userMessage = message.text.body.trim();
    const esNumeroId = /^\d{7,10}$/.test(userMessage);

    const { mensajes: mensajesHistorial = [], observaciones = "" } = await obtenerConversacionDeWix(from);
    const mensajesHistorialLimpio = limpiarDuplicados(mensajesHistorial);
    console.log(`[WIX] Consulta previa | userId: ${from} | observaciones: ${observaciones}`);

    if (String(observaciones).toLowerCase().includes("stop")) {
        console.log(`[STOP] Usuario bloqueado por observaciones: ${from}`);
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones (silencioso)." });
    }

    if (esNumeroId) {
        const mensajePrevioUsuario = [...mensajesHistorialLimpio]
            .reverse()
            .find(m => m.from === "usuario" && m.mensaje.length > 4 && isNaN(Number(m.mensaje)))?.mensaje || "";


        const clasificacion = await fetch("https://api.openai.com/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: promptClasificador
                    },
                    {
                        role: 'user',
                        content: mensajePrevioUsuario
                    }
                ],
                max_tokens: 10
            })
        });

        const resultadoClasificacion = await clasificacion.json();
        const intencion = resultadoClasificacion?.choices?.[0]?.message?.content?.trim() || "sin_intencion_clara";

        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "🔍 Un momento por favor..."
        });

        if (intencion === "confirmar_cita") {
            const info = await consultarInformacionPaciente(userMessage);
            if (!info || info.length === 0) {
                await enviarMensajeYGuardar({
                    to,
                    userId: from,
                    nombre,
                    texto: "No encontré información médica con ese documento."
                });
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
                const fechaAtencion = datos.fechaAtencion
                    ? new Date(datos.fechaAtencion).toLocaleString("es-CO", opcionesFecha).replace(',', ' a las')
                    : "No registrada";
                const resumen = `📄 Información registrada:\n👤 ${datos.primerNombre} ${datos.primerApellido}\n📅 Fecha consulta: ${fechaAtencion}\n📲 Celular: ${datos.celular || "No disponible"}`;
                await sendMessage(to, resumen);
            }
            const nuevoHistorial = limpiarDuplicados([
                ...mensajesHistorialLimpio,
                { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
                { from: "sistema", mensaje: "Consulta médica enviada.", timestamp: new Date().toISOString() }
            ]);
            await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
            return res.json({ success: true, mensaje: "Consulta enviada." });
        }

        const haEnviadoSoporte = mensajesHistorialLimpio.some(m =>
            /valor detectado/i.test(m.mensaje)
        );

        if (intencion === "pedir_certificado" || (intencion === "sin_intencion_clara" && haEnviadoSoporte)) {
            if (!haEnviadoSoporte) {
                await enviarMensajeYGuardar({
                    to,
                    userId: from,
                    nombre,
                    texto: "Para generar tu certificado, por favor primero envía el soporte de pago."
                });
                return res.json({ success: true, mensaje: "Falta comprobante." });
            }

            try {
                const pdfUrl = await generarPdfDesdeApi2Pdf(userMessage);
                await sendPdf(to, pdfUrl);

                const nuevoHistorial = limpiarDuplicados([
                    ...mensajesHistorialLimpio,
                    { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
                    { from: "sistema", mensaje: "PDF generado y enviado correctamente.", timestamp: new Date().toISOString() }
                ]);
                await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
                return res.json({ success: true, mensaje: "PDF generado y enviado." });

            } catch (err) {
                console.error("Error generando o enviando PDF:", err);
                await enviarMensajeYGuardar({
                    to,
                    userId: from,
                    nombre,
                    texto: "Ocurrió un error al generar tu certificado. Intenta más tarde."
                });
                return res.status(500).json({ success: false, error: err.message });
            }
        }


        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "Gracias por la información. ¿En qué te puedo ayudar?"
        });
        return res.json({ success: true, mensaje: "Intención no clara." });
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
                ...mensajesHistorialLimpio.map(m => ({
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

    const nuevoHistorial = limpiarDuplicados([
        ...mensajesHistorialLimpio,
        { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
        { from: "sistema", mensaje: respuestaBot, timestamp: new Date().toISOString() }
    ]);

    await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
    await sendMessage(to, respuestaBot);

    return res.json({ success: true, mensaje: "Respuesta enviada al usuario.", respuesta: respuestaBot });
}

function limpiarDuplicados(historial) {
    const vistos = new Set();
    return historial.filter(m => {
        const clave = `${m.from}|${m.mensaje}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
    });
}

async function enviarMensajeYGuardar({ to, userId, nombre, texto }) {
    await sendMessage(to, texto);
    const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
    const historialLimpio = limpiarDuplicados(historial);
    const nuevoHistorial = limpiarDuplicados([
        ...historialLimpio,
        { from: "sistema", mensaje: texto, timestamp: new Date().toISOString() }
    ]);
    await guardarConversacionEnWix({ userId, nombre, mensajes: nuevoHistorial });
}

module.exports = { procesarTexto };
