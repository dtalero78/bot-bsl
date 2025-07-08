const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { promptInstitucional, promptClasificador } = require('../utils/prompt');
const { sendMessage } = require('../utils/sendMessage');
const { sendPdf, generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');
const { consultarInformacionPaciente } = require('../utils/consultarPaciente');
const { marcarPagado } = require('../utils/marcarPagado');
const { esCedula, contieneTexto } = require('../utils/validaciones');

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

// Nueva función para evitar que se repita el envío del certificado
function yaSeEntregoCertificado(historial) {
    return historial.slice(-5).some(m =>
        m.from === "sistema" &&
        (
            m.mensaje.includes("PDF generado y enviado correctamente.") ||
            m.mensaje.includes("Aquí tienes tu certificado médico en PDF")
        )
    );
}

// 🆕 Función para detectar el contexto de la conversación
function detectarContextoConversacion(historial) {
    const ultimosMessages = historial.slice(-10);
   
    // Buscar si hay un comprobante de pago en el historial reciente
    const hayComprobantePago = ultimosMessages.some(m =>
        m.mensaje.includes("Comprobante de pago recibido") ||
        m.mensaje.includes("valor detectado") ||
        m.mensaje.includes("Valor detectado")
    );
   
    // Buscar si hay una confirmación de cita en el historial reciente
    const hayConfirmacionCita = ultimosMessages.some(m =>
        m.mensaje.includes("Confirmación de cita recibida") ||
        m.mensaje.includes("confirmación de cita")
    );
   
    // Buscar si hay un listado de exámenes
    const hayListadoExamenes = ultimosMessages.some(m =>
        m.mensaje.includes("Listado de exámenes recibido") ||
        m.mensaje.includes("orden médica")
    );

    return {
        hayComprobantePago,
        hayConfirmacionCita,
        hayListadoExamenes,
        contexto: hayComprobantePago ? "pago" :
                 hayConfirmacionCita ? "consulta_cita" :
                 hayListadoExamenes ? "examenes" : "general"
    };
}

// Función para enviar y guardar mensaje en historial
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

async function eliminarConversacionDeWix(userId) {
    try {
        const resp = await fetch("https://www.bsl.com.co/_functions/eliminarConversacion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId })
        });
        return await resp.json();
    } catch (err) {
        console.error("Error eliminando conversación en Wix:", err);
        return { success: false, error: err.message };
    }
}

/**
 * Verifica si el último mensaje del sistema fue "Verifica los datos de tu certificado"
 */
function ultimoMensajeFueVerificarDatos(historial) {
    const mensajesSistema = historial.filter(m => m.from === "sistema");
    if (mensajesSistema.length === 0) return false;
    
    const ultimoMensajeSistema = mensajesSistema[mensajesSistema.length - 1];
    return ultimoMensajeSistema.mensaje === "Verifica los datos de tu certificado";
}

async function procesarTexto(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;
    const userMessage = message.text.body.trim();

    // 1. Guardar el mensaje del usuario
    {
        const { mensajes: historial = [] } = await obtenerConversacionDeWix(from);
        const historialLimpio = limpiarDuplicados(historial);
        const nuevoHistorial = limpiarDuplicados([
            ...historialLimpio,
            { from: "usuario", mensaje: userMessage }
        ]);
        await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
    }

    // 2. Obtener historial actualizado y limpiar duplicados
    const { mensajes: mensajesHistorial = [], observaciones = "" } = await obtenerConversacionDeWix(from);
    const historialLimpio = limpiarDuplicados(mensajesHistorial);

    // Debug: imprime el historial actual
    console.log("📝 Historial recuperado de Wix para", from, ":", JSON.stringify(historialLimpio, null, 2));

    // --- FILTRO para evitar repetir el certificado ---
    if (yaSeEntregoCertificado(historialLimpio)) {
        await sendMessage(to, "Ya tienes tu certificado. Si necesitas otra cosa, dime por favor.");
        return res.json({ success: true, mensaje: "Certificado ya entregado." });
    }
    // -------------------------------------------------

    // 3. Verificar si el usuario está bloqueado
    if (String(observaciones).toLowerCase().includes("stop")) {
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones (silencioso)." });
    }

    // 4. 🆕 Verificar si debe preguntar por aprobación del certificado
    if (ultimoMensajeFueVerificarDatos(historialLimpio)) {
        console.log("📋 Detectado mensaje de verificación de certificado");
        
        // Buscar la última cédula en el historial
        const ultimaCedulaVerificacion = [...historialLimpio].reverse().find(m => esCedula(m.mensaje))?.mensaje || null;
        
        if (ultimaCedulaVerificacion) {
            try {
                const infoPaciente = await consultarInformacionPaciente(ultimaCedulaVerificacion);
                
                if (infoPaciente && infoPaciente.length > 0) {
                    const paciente = infoPaciente[0];
                    
                    // Verificar condiciones: atendido = "ATENDIDO" y pvEstado vacío
                    if (paciente.atendido === "ATENDIDO" && (!paciente.pvEstado || paciente.pvEstado === "")) {
                        console.log("✅ Paciente atendido y sin pvEstado, preguntando aprobación");
                        
                        await enviarMensajeYGuardar({
                            to,
                            userId: from,
                            nombre,
                            texto: "¿Apruebas tu certificado?",
                            remitente: "sistema"
                        });
                        
                        return res.json({ success: true, mensaje: "Pregunta de aprobación enviada" });
                    } else {
                        console.log("❌ No cumple condiciones para aprobación:", {
                            atendido: paciente.atendido,
                            pvEstado: paciente.pvEstado
                        });
                    }
                }
            } catch (err) {
                console.error("Error verificando estado del paciente:", err);
            }
        }
    }

    // 5. 🆕 Detectar contexto de la conversación
    const contextoInfo = detectarContextoConversacion(historialLimpio);
    console.log("🎯 Contexto detectado:", contextoInfo);

    // 6. Preparar contexto
    const ultimaCedula = [...historialLimpio].reverse().find(m => esCedula(m.mensaje))?.mensaje || null;

    const contextoConversacion = historialLimpio
        .slice(-25)
        .map(m => `${m.from}: ${m.mensaje}`)
        .join('\n');

    // 7. Clasificar intención
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

    console.log("🎯 Intención clasificada:", intencion);
    console.log("🎯 Contexto:", contextoInfo.contexto);

    // 8. 🆕 MANEJO ESPECÍFICO POR CONTEXTO

    // CONTEXTO: Usuario envió confirmación de cita + cédula
    if (contextoInfo.contexto === "consulta_cita" && ultimaCedula) {
        console.log("📅 Procesando consulta de cita con cédula:", ultimaCedula);
       
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "🔍 Un momento por favor...",
            remitente: "sistema"
        });

        try {
            const info = await consultarInformacionPaciente(ultimaCedula);
            if (!info || info.length === 0) {
                await enviarMensajeYGuardar({
                    to,
                    userId: from,
                    nombre,
                    texto: "...transfiriendo con asesor",
                    remitente: "sistema"
                });
                return res.json({ success: true });
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
                
                // 🆕 ELIMINAR CONVERSACIÓN después de enviar la información de la cita
                await eliminarConversacionDeWix(from);
                console.log("🗑️ Historial eliminado después de consultar cita para:", from);
                
                return res.json({ success: true });
            }
        } catch (err) {
            console.error("Error consultando información:", err);
            await enviarMensajeYGuardar({
                to,
                userId: from,
                nombre,
                texto: "...transfiriendo con asesor",
                remitente: "sistema"
            });
            return res.json({ success: true });
        }
    }

    // CONTEXTO: Usuario envió comprobante de pago + cédula  
    if (contextoInfo.contexto === "pago" && ultimaCedula) {
        console.log("💰 Procesando generación de certificado con cédula:", ultimaCedula);
       
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "🔍 Un momento por favor...",
            remitente: "sistema"
        });

        try {
            await marcarPagado(ultimaCedula);
            const pdfUrl = await generarPdfDesdeApi2Pdf(ultimaCedula);
            await sendPdf(to, pdfUrl, ultimaCedula);

            // Elimina la conversación de Wix después de enviar el certificado
            await eliminarConversacionDeWix(from);
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

    // 9. Manejo de intención: CONFIRMAR CITA (cuando no hay contexto específico)
    if (intencion === "confirmar_cita") {
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

        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "🔍 Un momento por favor...",
            remitente: "sistema"
        });

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
            
            // 🆕 ELIMINAR CONVERSACIÓN después de enviar la información de la cita
            await eliminarConversacionDeWix(from);
            console.log("🗑️ Historial eliminado después de consultar cita para:", from);
        }

        return res.json({ success: true });
    }

    // 10. Si el usuario solo envía cédula sin contexto, preguntar qué necesita
    if (esCedula(userMessage) && contextoInfo.contexto === "general") {
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "He recibido tu número de documento. ¿Necesitas consultar información sobre tu cita o ya realizaste el pago del examen?",
            remitente: "sistema"
        });
        return res.json({ success: true });
    }

    // 11. Chat normal con OpenAI
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
                ...historialLimpio.map(m => ({
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
    console.log("🟢 OpenAI response:", JSON.stringify(openaiJson, null, 2));

    const nuevoHistorial = limpiarDuplicados([
        ...historialLimpio,
        { from: "sistema", mensaje: respuestaBot }
    ]);
    await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
    await sendMessage(to, respuestaBot);

    return res.json({ success: true, respuesta: respuestaBot });
}

module.exports = { procesarTexto };