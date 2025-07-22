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

// 🆕 Función mejorada para detectar el contexto de la conversación
function detectarContextoConversacion(historial) {
    const ultimosMessages = historial.slice(-10);
  
    // Buscar si hay un comprobante de pago en el historial reciente
    const hayComprobantePago = ultimosMessages.some(m =>
        m.mensaje.includes("📷 Comprobante de pago recibido") ||
        m.mensaje.includes("Comprobante de pago recibido") ||
        m.mensaje.includes("valor detectado") ||
        m.mensaje.includes("Valor detectado") ||
        m.mensaje.includes("Hemos recibido tu comprobante") ||
        m.mensaje.includes("comprobante_pago")
    );
  
    // Buscar si hay una confirmación de cita en el historial reciente
    const hayConfirmacionCita = ultimosMessages.some(m =>
        m.mensaje.includes("📅 Confirmación de cita recibida") ||
        m.mensaje.includes("Confirmación de cita recibida") ||
        m.mensaje.includes("confirmación de cita") ||
        m.mensaje.includes("confirmacion_cita")
    );
  
    // Buscar si hay un listado de exámenes
    const hayListadoExamenes = ultimosMessages.some(m =>
        m.mensaje.includes("📋 Listado de exámenes recibido") ||
        m.mensaje.includes("Listado de exámenes recibido") ||
        m.mensaje.includes("orden médica") ||
        m.mensaje.includes("listado_examenes")
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
    if (to) { // Solo enviar si se especifica un destinatario
        await sendMessage(to, texto);
    }
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

// 🆕 Función para marcar STOP automáticamente usando tu API existente
async function marcarStopEnWix(userId) {
    try {
        const resp = await fetch("https://www.bsl.com.co/_functions/actualizarObservaciones", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, observaciones: "stop" })
        });
        
        const result = await resp.json();
        console.log(`🛑 STOP marcado automáticamente para usuario: ${userId}`, result);
        return { success: true };
    } catch (err) {
        console.error("Error marcando STOP en Wix:", err);
        return { success: false, error: err.message };
    }
}

/**
* 🆕 Función mejorada para detectar mensaje del admin - más flexible
*/
function ultimoMensajeFueVerificarDatos(historial) {
    const mensajesAdmin = historial.filter(m => m.from === "admin");
    if (mensajesAdmin.length === 0) return false;
   
    const ultimoMensajeAdmin = mensajesAdmin[mensajesAdmin.length - 1];
    const mensajesStop = [
        "Revisa que todo esté en orden",
        "revisa que todo esté en orden", 
        "revisa que todo este en orden",
        "Revisa que todo este en orden",
        "revisa que todo está en orden",
        "Revisa que todo está en orden"
    ];
    
    return mensajesStop.some(msg => ultimoMensajeAdmin.mensaje.toLowerCase().includes(msg.toLowerCase()));
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

    console.log("📝 Historial recuperado de Wix para", from, ":", JSON.stringify(historialLimpio, null, 2));

    // --- FILTRO para evitar repetir el certificado ---
    if (yaSeEntregoCertificado(historialLimpio)) {
        await sendMessage(to, "Ya tienes tu certificado. Si necesitas otra cosa, dime por favor.");
        return res.json({ success: true, mensaje: "Certificado ya entregado." });
    }

    // 3. Verificar si el usuario está bloqueado
    if (String(observaciones).toLowerCase().includes("stop")) {
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones (silencioso)." });
    }

    // 4. 🆕 NUEVA LÓGICA: Marcar STOP automáticamente cuando admin dice el mensaje
    if (ultimoMensajeFueVerificarDatos(historialLimpio)) {
        console.log("🛑 Detectado mensaje del ADMIN - Marcando STOP automáticamente para:", from);
        
        // Marcar STOP usando la API existente
        await marcarStopEnWix(from);
        
        // Opcional: enviar mensaje de confirmación al usuario antes del bloqueo
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "Gracias por la información. Un asesor revisará tu caso y te contactará pronto.",
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Usuario marcado como STOP automáticamente tras mensaje del admin" });
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

    // 7. 🆕 Mejorar clasificación de intención con más contexto
    const promptClasificadorMejorado = `
    Clasifica la intención del último mensaje del usuario basándote en el contexto completo de la conversación.
    
    Contexto automático detectado: ${contextoInfo.contexto}
    Última cédula en historial: ${ultimaCedula ? "SÍ" : "NO"}
    
    OPCIONES DE RESPUESTA (responde SOLO la etiqueta):
    - confirmar_cita: Usuario quiere consultar información de su cita médica
    - solicitar_certificado: Usuario quiere su certificado médico después de pagar  
    - aprobar_certificado: Usuario confirma/aprueba su certificado (respuestas como "sí", "apruebo", "está bien", "correcto")
    - consulta_general: Preguntas generales sobre servicios, precios, horarios
    - sin_intencion_clara: No se puede determinar la intención claramente
    
    REGLAS ESPECIALES:
    - Si hay comprobante de pago + cédula en historial = solicitar_certificado
    - Si hay confirmación de cita + cédula = confirmar_cita
    - Si el admin preguntó por aprobación = aprobar_certificado
    
    Contexto de los últimos mensajes:
    ${contextoConversacion}
    
    Responde únicamente con una de las etiquetas de las opciones.
    `;

    const clasificacion = await fetch("https://api.openai.com/v1/chat/completions", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: promptClasificadorMejorado },
                { role: 'user', content: contextoConversacion }
            ],
            max_tokens: 20
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
            // Verificar si el paciente ya fue atendido antes de generar certificado
            const infoPaciente = await consultarInformacionPaciente(ultimaCedula);
            
            if (infoPaciente && infoPaciente.length > 0) {
                const paciente = infoPaciente[0];
                
                // Si ya está atendido, generar certificado directamente
                if (paciente.atendido === "ATENDIDO") {
                    await marcarPagado(ultimaCedula);
                    const pdfUrl = await generarPdfDesdeApi2Pdf(ultimaCedula);
                    await sendPdf(to, pdfUrl, ultimaCedula);
                    await eliminarConversacionDeWix(from);
                    console.log("✅ Certificado generado automáticamente tras pago");
                    return res.json({ success: true });
                } else {
                    // Si no está atendido, solo marcar como pagado y transferir
                    await marcarPagado(ultimaCedula);
                    await enviarMensajeYGuardar({
                        to,
                        userId: from,
                        nombre,
                        texto: "Pago registrado correctamente. Un asesor te contactará para continuar con el proceso.",
                        remitente: "sistema"
                    });
                    return res.json({ success: true });
                }
            } else {
                // No se encontró información del paciente
                await enviarMensajeYGuardar({
                    to,
                    userId: from,
                    nombre,
                    texto: "...transfiriendo con asesor",
                    remitente: "sistema"
                });
                return res.json({ success: true });
            }
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

    // 9. 🆕 Manejo mejorado de intención: APROBAR CERTIFICADO
    if (intencion === "aprobar_certificado") {
        if (ultimaCedula) {
            try {
                const infoPaciente = await consultarInformacionPaciente(ultimaCedula);
                
                if (infoPaciente && infoPaciente.length > 0) {
                    const paciente = infoPaciente[0];
                    
                    if (paciente.atendido === "ATENDIDO" && (!paciente.pvEstado || paciente.pvEstado === "")) {
                        await marcarPagado(ultimaCedula);
                        const pdfUrl = await generarPdfDesdeApi2Pdf(ultimaCedula);
                        await sendPdf(to, pdfUrl, ultimaCedula);
                        await eliminarConversacionDeWix(from);
                        return res.json({ success: true, mensaje: "Certificado generado tras aprobación" });
                    }
                }
            } catch (err) {
                console.error("Error procesando aprobación:", err);
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

    // 10. Manejo de intención: CONFIRMAR CITA (cuando no hay contexto específico)
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
           
            await eliminarConversacionDeWix(from);
            console.log("🗑️ Historial eliminado después de consultar cita para:", from);
        }

        return res.json({ success: true });
    }

    // 11. Si el usuario solo envía cédula sin contexto, preguntar qué necesita
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

    // 12. Chat normal con OpenAI
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