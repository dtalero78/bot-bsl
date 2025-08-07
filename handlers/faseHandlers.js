const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { promptInstitucional } = require('../utils/prompt');
const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');
const { consultarInformacionPaciente } = require('../utils/consultarPaciente');
const { marcarPagado } = require('../utils/marcarPagado');
const { sendPdf, generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { esCedula } = require('../utils/validaciones');
const { 
    getOpcionesPostAgendamiento, 
    getOpcionesRevisionCertificado, 
    esOpcionNumerica 
} = require('../utils/faseDetector');

// Función de utilidad para evitar mensajes duplicados
function limpiarDuplicados(historial) {
    const vistos = new Set();
    return historial.filter(m => {
        const clave = `${m.from}|${m.mensaje}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
    });
}

// Función para enviar y guardar mensaje
async function enviarMensajeYGuardar({ to, userId, nombre, texto, remitente = "sistema", fase = "inicial" }) {
    try {
        if (to) {
            const resultado = await sendMessage(to, texto);
            if (!resultado.success && resultado.error) {
                console.error(`❌ Error enviando mensaje a ${to}:`, resultado.error);
            }
        }
        
        const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
        const historialLimpio = limpiarDuplicados(historial);
        const nuevoHistorial = limpiarDuplicados([
            ...historialLimpio,
            { from: remitente, mensaje: texto, timestamp: new Date().toISOString() }
        ]);
        
        await guardarConversacionEnWix({ userId, nombre, mensajes: nuevoHistorial, fase });
        return { success: true };
    } catch (error) {
        console.error(`❌ Error en enviarMensajeYGuardar para ${userId}:`, error.message);
        return { success: false, error: error.message };
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

        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: respuestaBot,
            remitente: "sistema",
            fase: "inicial"
        });

        return res.json({ success: true, respuesta: respuestaBot, fase: "inicial" });

    } catch (error) {
        console.error("❌ Error en fase inicial:", error);
        
        const respuestaFallback = "🩺 Nuestras opciones de exámenes ocupacionales:\n• Virtual: $46.000\n• Presencial: $69.000\n\n¿Cuál te interesa más?";
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: respuestaFallback,
            remitente: "sistema",
            fase: "inicial"
        });

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

    // Si el usuario no ha elegido opción o eligió opción inválida, mostrar menú
    if (!esOpcionNumerica(userMessage, 5)) {
        const opciones = getOpcionesPostAgendamiento();
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: opciones,
            remitente: "sistema",
            fase: "post_agendamiento"
        });

        return res.json({ success: true, mensaje: "Menú post-agendamiento mostrado", fase: "post_agendamiento" });
    }

    // Procesar opción seleccionada
    const opcion = parseInt(userMessage.trim());
    let respuesta = "";

    switch (opcion) {
        case 1: // ¿A qué hora quedó mi cita?
            respuesta = "Para consultar el horario de tu cita, necesitaría tu número de documento. Por favor escríbelo (solo números, sin puntos).";
            break;

        case 2: // Problemas con la aplicación
            respuesta = "Para problemas técnicos con la aplicación:\n\n✅ Intenta recargar la página\n✅ Limpia el caché del navegador\n✅ Usa Chrome o Safari actualizados\n\n¿Solucionó tu problema?";
            break;

        case 3: // No me funciona el formulario
            respuesta = "Si el formulario no funciona:\n\n1️⃣ Verifica tu conexión a internet\n2️⃣ Completa todos los campos obligatorios\n3️⃣ Revisa que el formato de datos sea correcto\n\n¿Necesitas más ayuda específica?";
            break;

        case 4: // Se me cerró la aplicación
            respuesta = "Si se cerró la aplicación:\n\n📱 Vuelve a ingresar al link que te enviamos\n💾 Tus datos se guardan automáticamente\n🔄 Puedes continuar donde quedaste\n\n¿Pudiste ingresar nuevamente?";
            break;

        case 5: // Hablar con un asesor
            respuesta = "...transfiriendo con asesor";
            break;

        default:
            respuesta = getOpcionesPostAgendamiento();
    }

    await enviarMensajeYGuardar({
        to,
        userId: from,
        nombre,
        texto: respuesta,
        remitente: "sistema",
        fase: "post_agendamiento"
    });

    // Si eligió consultar cita (opción 1) y necesita cédula
    if (opcion === 1) {
        // Esperar a que envíe la cédula en el siguiente mensaje
        return res.json({ success: true, mensaje: "Solicitando número de documento", fase: "post_agendamiento" });
    }

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
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: opciones,
            remitente: "sistema",
            fase: "revision_certificado"
        });

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

        case 2: // Hay un error que corregir
            respuesta = "...transfiriendo con asesor";
            break;

        case 3: // No he podido revisarlo
            respuesta = "Te ayudo a revisar tu certificado:\n\n1️⃣ Verifica tu email (también spam)\n2️⃣ Descarga el PDF adjunto\n3️⃣ Revisa que tus datos estén correctos\n\n¿Pudiste encontrarlo?";
            break;

        case 4: // Hablar con un asesor
            respuesta = "...transfiriendo con asesor";
            break;

        default:
            respuesta = getOpcionesRevisionCertificado();
    }

    await enviarMensajeYGuardar({
        to,
        userId: from,
        nombre,
        texto: respuesta,
        remitente: "sistema",
        fase: nuevaFase
    });

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
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "🔍 Un momento por favor...",
            remitente: "sistema",
            fase: "pago"
        });

        try {
            const infoPaciente = await consultarInformacionPaciente(userMessage);
            
            if (infoPaciente && infoPaciente.length > 0) {
                const paciente = infoPaciente[0];
                
                if (paciente.atendido === "ATENDIDO") {
                    await marcarPagado(userMessage);
                    const pdfUrl = await generarPdfDesdeApi2Pdf(userMessage);
                    await sendPdf(to, pdfUrl, userMessage);
                    
                    // Marcar como completado
                    await enviarMensajeYGuardar({
                        to: null,
                        userId: from,
                        nombre,
                        texto: "Proceso completado exitosamente",
                        remitente: "sistema",
                        fase: "completado"
                    });
                    
                    return res.json({ success: true, mensaje: "Certificado enviado", fase: "completado" });
                } else {
                    await marcarPagado(userMessage);
                    await enviarMensajeYGuardar({
                        to,
                        userId: from,
                        nombre,
                        texto: "Pago registrado. Un asesor te contactará para continuar.",
                        remitente: "sistema",
                        fase: "pago"
                    });
                    return res.json({ success: true, mensaje: "Pago registrado", fase: "pago" });
                }
            } else {
                await enviarMensajeYGuardar({
                    to,
                    userId: from,
                    nombre,
                    texto: "...transfiriendo con asesor",
                    remitente: "sistema",
                    fase: "pago"
                });
                return res.json({ success: true, mensaje: "Transferido a asesor", fase: "pago" });
            }
        } catch (error) {
            console.error("❌ Error procesando pago:", error);
            await enviarMensajeYGuardar({
                to,
                userId: from,
                nombre,
                texto: "...transfiriendo con asesor",
                remitente: "sistema",
                fase: "pago"
            });
            return res.json({ success: false, error: error.message, fase: "pago" });
        }
    } else {
        // Si no es cédula, solicitar el número de documento
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "Ahora escribe SOLO tu número de documento (sin puntos ni letras).",
            remitente: "sistema",
            fase: "pago"
        });
        
        return res.json({ success: true, mensaje: "Solicitando número de documento para pago", fase: "pago" });
    }
}

module.exports = {
    manejarFaseInicial,
    manejarPostAgendamiento,
    manejarRevisionCertificado,
    manejarPago
};