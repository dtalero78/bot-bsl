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
    const ultimosMessages = historial.slice(-15); // Más contexto
  
    // Buscar si hay un comprobante de pago en el historial reciente
    const hayComprobantePago = ultimosMessages.some(m =>
        m.mensaje.includes("📷 Comprobante de pago recibido") ||
        m.mensaje.includes("Comprobante de pago recibido") ||
        m.mensaje.includes("valor detectado") ||
        m.mensaje.includes("Valor detectado") ||
        m.mensaje.includes("Hemos recibido tu comprobante") ||
        m.mensaje.includes("comprobante_pago")
    );
  
    // 🆕 SOLO considerar confirmación de cita si REALMENTE hubo una imagen
    const hayConfirmacionCita = ultimosMessages.some(m =>
        (m.mensaje.includes("📅 Confirmación de cita recibida") ||
         m.mensaje.includes("Confirmación de cita recibida")) &&
        // Verificar que realmente vino de procesamiento de imagen
        m.from === "sistema"
    );
  
    // Buscar si hay un listado de exámenes  
    const hayListadoExamenes = ultimosMessages.some(m =>
        m.mensaje.includes("📋 Listado de exámenes recibido") ||
        m.mensaje.includes("Listado de exámenes recibido") ||
        m.mensaje.includes("orden médica") ||
        m.mensaje.includes("listado_examenes")
    );

    // 🆕 Detectar si ya se consultó información recientemente
    const yaSeConsultoInfo = ultimosMessages.some(m =>
        m.mensaje.includes("📄 Información registrada:") ||
        m.mensaje.includes("Información registrada:")
    );

    return {
        hayComprobantePago,
        hayConfirmacionCita,
        hayListadoExamenes,
        yaSeConsultoInfo,
        contexto: hayComprobantePago ? "pago" :
                 hayConfirmacionCita ? "consulta_cita" :
                 hayListadoExamenes ? "examenes" : 
                 yaSeConsultoInfo ? "ya_consultado" : "general"
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

// 🆕 Función para detectar si el usuario está haciendo una corrección
function esCorreccionDeHorario(mensaje) {
    const palabrasCorreccion = [
        "equivocada", "equivocado", "mal", "error", "incorrecto", "incorrecta",
        "debe ser", "debería ser", "es a las", "son las", "no es", "no son"
    ];
    
    return palabrasCorreccion.some(palabra => 
        mensaje.toLowerCase().includes(palabra)
    );
}

// 🆕 Función para detectar cuando el usuario quiere hablar con un asesor
function quiereAsesor(mensaje) {
    const palabrasAsesor = [
        "asesor", "persona", "humano", "ayuda", "problema", "error",
        "hablar con", "contactar", "comunicar", "equivocado", "mal"
    ];
    
    return palabrasAsesor.some(palabra => 
        mensaje.toLowerCase().includes(palabra)
    );
}

// 🆕 Función para detectar solicitudes de pago
function solicitaPago(mensaje) {
    const palabrasPago = [
        "pagar", "pago", "pagos", "certificado", "datos", "cuenta", 
        "transferir", "consignar", "donde pago", "como pago"
    ];
    
    return palabrasPago.some(palabra => 
        mensaje.toLowerCase().includes(palabra)
    );
}

// 🆕 Función para detectar si el bot preguntó sobre revisión del certificado
function ultimaPreguntaFueRevision(historial) {
    const ultimosMessages = historial.slice(-3);
    return ultimosMessages.some(m =>
        m.from === "sistema" && 
        m.mensaje.includes("¿Ya revisaste el certificado?")
    );
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
    Ya se consultó información: ${contextoInfo.yaSeConsultoInfo ? "SÍ" : "NO"}
    Bot preguntó por revisión de certificado: ${ultimaPreguntaFueRevision(historialLimpio) ? "SÍ" : "NO"}
    
    OPCIONES DE RESPUESTA (responde SOLO la etiqueta):
    - confirmar_cita: Usuario quiere consultar información de su cita médica (SOLO si no se consultó antes)
    - solicitar_certificado: Usuario quiere su certificado médico después de pagar  
    - aprobar_certificado: Usuario confirma/aprueba su certificado (respuestas como "sí", "apruebo", "está bien", "correcto")
    - solicitar_pago: Usuario quiere información de pago o confirma que ya revisó certificado
    - confirmar_revision: Usuario da CUALQUIER respuesta afirmativa confirmando que ya revisó el certificado 
      (incluye "si", "sí", "ya", "claro", "por supuesto", "desde luego", "obvio", "correcto", "exacto", etc.)
    - correccion_datos: Usuario indica que hay un error en los datos mostrados (palabras como "equivocado", "mal", "error", "debe ser")
    - solicitar_asesor: Usuario quiere hablar con una persona o reportar un problema
    - consulta_general: Preguntas generales sobre servicios, precios, horarios
    - sin_intencion_clara: No se puede determinar la intención claramente
    
    REGLAS ESPECIALES:
    - Si bot preguntó "¿Ya revisaste el certificado?" y usuario da CUALQUIER respuesta afirmativa = confirmar_revision
      (Incluye: "si", "sí", "ya", "claro", "por supuesto", "desde luego", "obvio", "afirmativo", "correcto", "exacto", etc.)
    - Si usuario menciona "pagar", "pago", "certificado" = solicitar_pago
    - Si ya se consultó información y el usuario dice que está mal = correccion_datos
    - Si hay comprobante de pago + cédula en historial = solicitar_certificado
    - Si hay confirmación de cita + cédula = confirmar_cita (SOLO si no se consultó antes)
    - Si el admin preguntó por aprobación = aprobar_certificado
    - Si usuario menciona "asesor", "problema", "error" = solicitar_asesor
    - Si ya se mostró información y usuario envía solo cédula = correccion_datos o solicitar_asesor
    
    Contexto de los últimos mensajes:
    ${contextoConversacion}
    
    Último mensaje del usuario: "${userMessage}"
    
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

    // 8. 🆕 MANEJO ESPECÍFICO POR CONTEXTO E INTENCIÓN

    // 🚨 NUEVO: Manejar confirmación de revisión de certificado
    // Usar clasificador principal + lógica de respaldo para confirmaciones
    if (intencion === "confirmar_revision" || 
        intencion === "aprobar_certificado" ||
        (ultimaPreguntaFueRevision(historialLimpio) && 
         (intencion === "consulta_general" || intencion === "sin_intencion_clara"))) {
        
        console.log("💳 Usuario confirmó que ya revisó el certificado - enviando datos de pago");
        
        const datosPago = `💳 **Datos para el pago:**

**Bancolombia:** Ahorros 44291192456 (cédula 79981585)
**Daviplata:** 3014400818 (Mar Rea)  
**Nequi:** 3008021701 (Dan Tal)
**También:** Transfiya

Envía tu comprobante de pago por aquí y tu número de documento para generar tu certificado.`;

        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: datosPago,
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Datos de pago enviados tras confirmación" });
    }

    // 🚨 NUEVO: Manejar solicitudes de pago
    if (intencion === "solicitar_pago" || solicitaPago(userMessage)) {
        console.log("💰 Usuario solicita información de pago");
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "¿Ya revisaste el certificado?",
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Pregunta sobre revisión de certificado enviada" });
    }

    // 🚨 NUEVO: Manejar correcciones de datos
    if (intencion === "correccion_datos" || intencion === "solicitar_asesor" || 
        (contextoInfo.yaSeConsultoInfo && (esCorreccionDeHorario(userMessage) || quiereAsesor(userMessage)))) {
        
        console.log("🔧 Usuario reporta error en datos o solicita asesor");
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "Entiendo tu preocupación. ...transfiriendo con asesor",
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Transferido a asesor por corrección de datos" });
    }

    // 🚨 NUEVO: Evitar bucle si ya se consultó información
    if (contextoInfo.yaSeConsultoInfo && esCedula(userMessage)) {
        console.log("🔄 Evitando bucle - ya se consultó información para esta cédula");
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "Ya consulté tu información. Si hay algún error o necesitas ayuda adicional, te transfiero con un asesor. ...transfiriendo con asesor",
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Evitado bucle infinito - transferido a asesor" });
    }

    // CONTEXTO: Usuario envió confirmación de cita + cédula (SOLO si realmente hubo imagen)
    if (contextoInfo.contexto === "consulta_cita" && ultimaCedula && !contextoInfo.yaSeConsultoInfo) {
        console.log("📅 Procesando consulta de cita con cédula (imagen confirmada):", ultimaCedula);
      
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

    // 10. Manejo de intención: CONFIRMAR CITA (cuando no hay contexto específico y NO se consultó antes)
    if (intencion === "confirmar_cita" && !contextoInfo.yaSeConsultoInfo) {
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

    // 11. Si el usuario solo envía cédula sin contexto Y no se ha consultado antes
    if (esCedula(userMessage) && contextoInfo.contexto === "general" && !contextoInfo.yaSeConsultoInfo) {
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