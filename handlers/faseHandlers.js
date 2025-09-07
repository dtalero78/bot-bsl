const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { promptInstitucional } = require('../utils/prompt');
const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnDB, obtenerConversacionDeDB } = require('../utils/dbAPI');
const { consultarInformacionPaciente } = require('../utils/consultarPaciente');
const { marcarPagado } = require('../utils/marcarPagado');
const { sendPdf, generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { esCedula } = require('../utils/validaciones');
const { 
    getOpcionesPostAgendamiento, 
    getOpcionesRevisionCertificado, 
    esOpcionNumerica 
} = require('../utils/faseDetector');
const { limpiarDuplicados, extraerUserId, esCedula: esCedulaShared, logInfo, logError } = require('../utils/shared');
const MessageService = require('../services/messageService');
const { getOpenAIService } = require('../services/openaiService');
const { config } = require('../config/environment');

/**
 * Función auxiliar para enviar mensaje y guardar en base de datos
 */
async function simpleEnviarYGuardar(to, from, nombre, mensaje, historial, fase) {
    try {
        // Enviar mensaje por WhatsApp
        await sendMessage(to, mensaje);
        
        // Actualizar historial con el mensaje del bot
        const nuevoHistorial = limpiarDuplicados([
            ...historial,
            {
                from: "sistema",
                mensaje: mensaje,
                timestamp: new Date().toISOString()
            }
        ]);
        
        // Guardar en base de datos
        await guardarConversacionEnDB({
            userId: extraerUserId(to),
            nombre: nombre,
            mensajes: nuevoHistorial,
            fase: fase
        });
        
        logInfo('faseHandlers', 'Mensaje enviado y guardado', { to, fase, mensaje: mensaje.substring(0, 50) });
        
    } catch (error) {
        logError('faseHandlers', 'Error en simpleEnviarYGuardar', { to, error });
        throw error;
    }
}


/**
 * FASE 1: INICIAL - Usar ChatGPT para respuestas naturales
 */
async function manejarFaseInicial(message, res, historial) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;
    const userMessage = message.text.body.trim();

    console.log("🎯 FASE INICIAL: Usando ChatGPT para respuesta natural");

    try {
        // Usar OpenAI para generar respuesta contextual
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
                    ...historial.slice(-8).map(m => ({
                        role: m.from === "usuario" ? "user" : "assistant",
                        content: m.mensaje
                    })),
                    { role: 'user', content: userMessage }
                ],
                max_tokens: 200
            })
        });

        const openaiJson = await aiRes.json();
        const respuestaBot = openaiJson.choices?.[0]?.message?.content || "¿En qué puedo ayudarte con los exámenes médicos?";

        // Enviar respuesta
        await simpleEnviarYGuardar(to, from, nombre, respuestaBot, historial, "inicial");
        return res.json({ success: true, respuesta: respuestaBot, fase: "inicial" });

    } catch (error) {
        console.error("❌ Error en fase inicial:", error);
        
        const respuestaFallback = "🩺 Nuestras opciones de exámenes ocupacionales:\n• Virtual: $46.000\n• Presencial: $69.000\n\n¿Cuál te interesa más?";
        
        await simpleEnviarYGuardar(to, from, nombre, respuestaFallback, historial, "inicial");
        return res.json({ success: true, respuesta: respuestaFallback, fase: "inicial" });
    }
}

/**
 * FASE 2: POST-AGENDAMIENTO - Menús numerados
 */
async function manejarPostAgendamiento(message, res, historial) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;
    const userMessage = message.text.body.trim();

    console.log("🎯 FASE POST-AGENDAMIENTO: Usando menús numerados");

    // Si el usuario no eligió opción numérica válida, mostrar menú
    if (!esOpcionNumerica(userMessage, 5)) {
        const opciones = getOpcionesPostAgendamiento();
        await simpleEnviarYGuardar(to, from, nombre, opciones, historial, "post_agendamiento");
        return res.json({ success: true, mensaje: "Menú post-agendamiento mostrado", fase: "post_agendamiento" });
    }

    // Procesar opción seleccionada
    const opcion = parseInt(userMessage.trim());
    let respuesta = "";

    switch (opcion) {
        case 1: // ¿A qué hora quedó mi cita?
            respuesta = "Para consultar el horario de tu cita, necesito tu número de documento. Por favor escríbelo (solo números, sin puntos).";
            break;
        case 2: // Problemas con la aplicación
            respuesta = "Para problemas técnicos:\n\n✅ Recarga la página\n✅ Limpia el caché\n✅ Usa Chrome o Safari actualizados\n\n¿Se solucionó?";
            break;
        case 3: // No funciona el formulario
            respuesta = "Si el formulario no funciona:\n\n1️⃣ Verifica tu conexión\n2️⃣ Completa todos los campos\n3️⃣ Revisa el formato de datos\n\n¿Necesitas más ayuda?";
            break;
        case 4: // Se cerró la aplicación
            respuesta = "Si se cerró:\n\n📱 Vuelve al link\n💾 Tus datos se guardan automáticamente\n🔄 Continúa donde quedaste\n\n¿Pudiste ingresar?";
            break;
        case 5: // Hablar con asesor
            respuesta = "...transfiriendo con asesor";
            break;
        default:
            respuesta = getOpcionesPostAgendamiento();
    }

    await simpleEnviarYGuardar(to, from, nombre, respuesta, historial, "post_agendamiento");
    return res.json({ success: true, respuesta, fase: "post_agendamiento" });
}

/**
 * FASE 3: REVISIÓN CERTIFICADO - Opciones específicas
 */
async function manejarRevisionCertificado(message, res, historial) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;
    const userMessage = message.text.body.trim();

    console.log("🎯 FASE REVISIÓN CERTIFICADO: Validando revisión");

    // Si no es opción numérica válida, mostrar menú de revisión
    if (!esOpcionNumerica(userMessage, 4)) {
        const opciones = getOpcionesRevisionCertificado();
        await simpleEnviarYGuardar(to, from, nombre, opciones, historial, "revision_certificado");
        return res.json({ success: true, mensaje: "Menú de revisión mostrado", fase: "revision_certificado" });
    }

    const opcion = parseInt(userMessage.trim());
    let respuesta = "";
    let nuevaFase = "revision_certificado";

    switch (opcion) {
        case 1: // Sí, está correcto
            respuesta = `💳 **Datos para el pago:**

**Bancolombia:** Ahorros 44291192456 (cédula 79981585)
**Daviplata:** 3014400818 (Mar Rea)  
**Nequi:** 3008021701 (Dan Tal)
**También:** Transfiya

Envía SOLO tu comprobante de pago por aquí`;
            nuevaFase = "pago";
            break;
        case 2: // Hay error
            respuesta = "...transfiriendo con asesor";
            break;
        case 3: // No pudo revisarlo
            respuesta = "Para revisar tu certificado:\n\n1️⃣ Verifica tu email (también spam)\n2️⃣ Descarga el PDF\n3️⃣ Revisa tus datos\n\n¿Lo encontraste?";
            break;
        case 4: // Hablar con asesor
            respuesta = "...transfiriendo con asesor";
            break;
        default:
            respuesta = getOpcionesRevisionCertificado();
    }

    await simpleEnviarYGuardar(to, from, nombre, respuesta, historial, nuevaFase);
    return res.json({ success: true, respuesta, fase: nuevaFase });
}

/**
 * FASE 4: PAGO - Procesar comprobantes y generar certificados
 */
async function manejarPago(message, res, historial) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;
    const userMessage = message.text.body.trim();

    console.log("🎯 FASE PAGO: Procesando información de pago");

    // Si envía cédula para procesar pago
    if (esCedula(userMessage)) {
        await simpleEnviarYGuardar(to, from, nombre, "🔍 Un momento por favor...", historial, "pago");

        try {
            const infoPaciente = await consultarInformacionPaciente(userMessage);
            
            if (infoPaciente && infoPaciente.length > 0) {
                const paciente = infoPaciente[0];
                
                if (paciente.atendido === "ATENDIDO") {
                    await marcarPagado(userMessage);
                    const pdfUrl = await generarPdfDesdeApi2Pdf(userMessage);
                    await sendPdf(to, pdfUrl, userMessage);
                    return res.json({ success: true, mensaje: "Certificado enviado", fase: "completado" });
                } else {
                    await marcarPagado(userMessage);
                    await simpleEnviarYGuardar(to, from, nombre, "Pago registrado. Un asesor te contactará para continuar.", historial, "pago");
                    return res.json({ success: true, mensaje: "Pago registrado", fase: "pago" });
                }
            } else {
                await simpleEnviarYGuardar(to, from, nombre, "...transfiriendo con asesor", historial, "pago");
                return res.json({ success: true, mensaje: "Transferido a asesor", fase: "pago" });
            }
        } catch (error) {
            console.error("❌ Error procesando pago:", error);
            await simpleEnviarYGuardar(to, from, nombre, "...transfiriendo con asesor", historial, "pago");
            return res.json({ success: false, error: error.message, fase: "pago" });
        }
    } else {
        // Si no es cédula, solicitar número de documento
        await simpleEnviarYGuardar(to, from, nombre, "Ahora escribe SOLO tu número de documento (sin puntos ni letras).", historial, "pago");
        return res.json({ success: true, mensaje: "Solicitando número de documento para pago", fase: "pago" });
    }
}

module.exports = {
    manejarFaseInicial,
    manejarPostAgendamiento,
    manejarRevisionCertificado,
    manejarPago
};