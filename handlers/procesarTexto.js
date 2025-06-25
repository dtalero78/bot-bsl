const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { promptInstitucional, promptClasificador } = require('../utils/prompt');
const { sendMessage } = require('../utils/sendMessage');
const { sendPdf, generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');
const { consultarInformacionPaciente } = require('../utils/consultarPaciente');
const { marcarPagado } = require('../utils/marcarPagado');
const { esCedula, contieneTexto } = require('../utils/validaciones');

async function procesarTexto(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;
    const userMessage = message.text.body.trim();
    const esNumeroId = esCedula(userMessage);

    // Guardar mensaje del usuario
    {
        const { mensajes: historial = [] } = await obtenerConversacionDeWix(from);
        const historialLimpio = limpiarDuplicados(historial);
        const nuevoHistorial = limpiarDuplicados([
            ...historialLimpio,
            { from: "usuario", mensaje: userMessage }
        ]);
        await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
    }

    const { mensajes: mensajesHistorial = [], observaciones = "" } = await obtenerConversacionDeWix(from);
    const mensajesHistorialLimpio = limpiarDuplicados(mensajesHistorial);

    if (String(observaciones).toLowerCase().includes("stop")) {
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones (silencioso)." });
    }

    if (esNumeroId) {
        const contextoCompleto = mensajesHistorialLimpio.map(m => m.mensaje).join(' ').toLowerCase();
        const haDichoCita = contieneTexto(contextoCompleto, ["cita", "confirmar", "consulta"]);
        const haDichoCertificado = contieneTexto(contextoCompleto, ["certificado", "pdf", "resultado"]);
        const haEnviadoSoporte = mensajesHistorialLimpio.some(m => /valor detectado/i.test(m.mensaje));

        if (!haDichoCita && !haDichoCertificado && !haEnviadoSoporte) {
            await enviarMensajeYGuardar({
                to,
                userId: from,
                nombre,
                texto: "¿Deseas confirmar tu cita o recibir tu certificado? Por favor responde con una de las dos opciones.",
                remitente: "sistema"
            });
            return res.json({ success: true });
        }

        const contextoConversacion = mensajesHistorialLimpio
            .slice(-25)
            .map(m => `${m.from}: ${m.mensaje}`)
            .join('\n');

        const clasificacion = await fetch("https://api.openai.com/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: promptClasificador },
                    { role: 'user', content: contextoConversacion }
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
            texto: "🔍 Un momento por favor...",
            remitente: "sistema"
        });

        if (intencion === "confirmar_cita") {
            const ultimaCedula = [...mensajesHistorialLimpio].reverse().find(m => esCedula(m.mensaje))?.mensaje || null;

            if (!ultimaCedula) {
                await enviarMensajeYGuardar({
                    to,
                    userId: from,
                    nombre,
                    texto: "Por favor indícame tu número de documento para poder confirmar tu cita.",
                    remitente: "sistema"
                });
                return res.json({ success: true });
            }

            const info = await consultarInformacionPaciente(ultimaCedula);
            if (!info || info.length === 0) {
                await enviarMensajeYGuardar({
                    to,
                    userId: from,
                    nombre,
                    texto: "...transfiriendo con asesor",
                    remitente: "sistema"
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
                { from: "sistema", mensaje: "Consulta médica enviada." }
            ]);
            await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
            return res.json({ success: true });
        }

        if (
            intencion === "pedir_certificado" ||
            (intencion === "sin_intencion_clara" && haEnviadoSoporte) ||
            (haEnviadoSoporte && /^\d+$/.test(userMessage))
        ) {
            try {
                await marcarPagado(userMessage);
                const pdfUrl = await generarPdfDesdeApi2Pdf(userMessage);
                await sendPdf(to, pdfUrl);

                const nuevoHistorial = limpiarDuplicados([
                    ...mensajesHistorialLimpio,
                    { from: "sistema", mensaje: "PDF generado y enviado correctamente." }
                ]);
                await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
                return res.json({ success: true });
            } catch (err) {
                console.error("Error generando o enviando PDF:", err);
                await enviarMensajeYGuardar({
                    to,
                    userId: from,
                    nombre,
                    texto: "...transfiriendo con asesor",
                    remitente: "sistema"
                });
                return res.status(500).json({ success: false });
            }
        }

        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "...transfiriendo con asesor",
            remitente: "sistema"
        });
        return res.json({ success: true });
    }

    // Chat normal
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
    const respuestaBot = openaiJson.choices?.[0]?.message?.content || "No se obtuvo respuesta de OpenAI.";

    const nuevoHistorial = limpiarDuplicados([
        ...mensajesHistorialLimpio,
        { from: "sistema", mensaje: respuestaBot }
    ]);
    await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
    await sendMessage(to, respuestaBot);

    return res.json({ success: true, respuesta: respuestaBot });
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

async function enviarMensajeYGuardar({ to, userId, nombre, texto, remitente = "sistema" }) {
    await sendMessage(to, texto);
    const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
    const historialLimpio = limpiarDuplicados(historial);
    const nuevoHistorial = limpiarDuplicados([
        ...historialLimpio,
        { from: remitente, mensaje: texto }
    ]);
    await guardarConversacionEnWix({ userId, nombre, mensajes: nuevoHistorial });
}

module.exports = { procesarTexto };
