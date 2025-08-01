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

// Función mejorada para detectar si ya se enviaron datos de pago recientemente
function yaSeEnviaronDatosPago(historial) {
    const ultimosMessages = historial.slice(-5);
    return ultimosMessages.some(m =>
        m.from === "sistema" && 
        (m.mensaje.includes("💳") ||
         m.mensaje.includes("Datos para el pago") ||
         m.mensaje.includes("Bancolombia: Ahorros 44291192456") ||
         m.mensaje.includes("Bancolombia:** Ahorros 44291192456") ||
         m.mensaje.includes("Daviplata:** 3014400818") ||
         m.mensaje.includes("Nequi:** 3008021701"))
    );
}

// Función para detectar contexto de conversación
function detectarContextoConversacion(historial, observaciones = "") {
    const ultimosMessages = historial.slice(-10);
  
    // 🆕 Buscar mensajes específicos del nuevo procesarImagen.js
    const hayComprobantePago = ultimosMessages.some(m =>
        m.mensaje.includes("📷 Comprobante de pago recibido") ||
        m.mensaje.includes("Comprobante de pago recibido") ||
        m.mensaje.includes("valor detectado") ||
        m.mensaje.includes("Valor detectado") ||
        m.mensaje.includes("Hemos recibido tu comprobante")
    );
  
    const hayConfirmacionCita = ultimosMessages.some(m =>
        (m.mensaje.includes("📅 Confirmación de cita recibida") ||
         m.mensaje.includes("Confirmación de cita recibida")) &&
        m.from === "sistema"
    );
  
    const hayListadoExamenes = ultimosMessages.some(m =>
        m.mensaje.includes("📋 Listado de exámenes recibido") ||
        m.mensaje.includes("Listado de exámenes recibido")
    );

    const hayDocumentoIdentidad = ultimosMessages.some(m =>
        m.mensaje.includes("🆔 Documento de identidad recibido") ||
        m.mensaje.includes("Documento de identidad recibido")
    );

    const yaSeConsultoInfo = ultimosMessages.some(m =>
        m.mensaje.includes("📄 Información registrada:") ||
        m.mensaje.includes("Información registrada:")
    );

    const yaSeEnviaronDatos = yaSeEnviaronDatosPago(historial);

    const observacionesContext = {
        tienePago: observaciones.toLowerCase().includes("pagado"),
        estaAtendido: observaciones.toLowerCase().includes("atendido"),
        tieneCita: observaciones.toLowerCase().includes("cita"),
        bloqueado: observaciones.toLowerCase().includes("stop")
    };

    return {
        hayComprobantePago,
        hayConfirmacionCita,
        hayListadoExamenes,
        hayDocumentoIdentidad, // 🆕 NUEVO
        yaSeConsultoInfo,
        yaSeEnviaronDatos,
        observacionesContext,
        contexto: hayComprobantePago ? "pago" :
                 hayConfirmacionCita ? "consulta_cita" :
                 hayListadoExamenes ? "examenes" :
                 hayDocumentoIdentidad ? "documento_enviado" : // 🆕 NUEVO
                 yaSeConsultoInfo ? "ya_consultado" :
                 yaSeEnviaronDatos ? "datos_enviados" :
                 "general"
    };
}

// Función para enviar y guardar mensaje en historial
async function enviarMensajeYGuardar({ to, userId, nombre, texto, remitente = "sistema" }) {
    try {
        if (to) {
            const resultado = await sendMessage(to, texto);
            if (!resultado.success && resultado.error) {
                console.error(`❌ Error enviando mensaje a ${to}:`, resultado.error);
                return { success: false, error: resultado.error };
            }
        }
        
        const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
        const historialLimpio = limpiarDuplicados(historial);
        const nuevoHistorial = limpiarDuplicados([
            ...historialLimpio,
            { from: remitente, mensaje: texto }
        ]);
        
        const guardado = await guardarConversacionEnWix({ userId, nombre, mensajes: nuevoHistorial });
        return { success: true, guardado };
    } catch (error) {
        console.error(`❌ Error en enviarMensajeYGuardar para ${userId}:`, error.message);
        return { success: false, error: error.message };
    }
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

// Función para marcar STOP automáticamente
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

// Funciones de detección mejoradas
function esCorreccionDeHorario(mensaje) {
    const palabrasCorreccion = [
        "equivocada", "equivocado", "mal", "error", "incorrecto", "incorrecta",
        "debe ser", "debería ser", "es a las", "son las", "no es", "no son"
    ];
    return palabrasCorreccion.some(palabra => mensaje.toLowerCase().includes(palabra));
}

function quiereAsesor(mensaje) {
    const palabrasAsesor = [
        "asesor", "persona", "humano", "ayuda", "problema", "error",
        "hablar con", "contactar", "comunicar"
    ];
    return palabrasAsesor.some(palabra => mensaje.toLowerCase().includes(palabra));
}

function eligeOpcionExamen(mensaje) {
    const mensajeLower = mensaje.toLowerCase().trim();
    const opcionesValidas = [
        "virtual", "presencial", "el virtual", "el presencial", 
        "el de 46", "el de 69", "46000", "69000", "si virtual", "si presencial"
    ];
    return opcionesValidas.some(opcion => mensajeLower.includes(opcion));
}

function quiereHacerExamen(mensaje) {
    const palabrasExamen = [
        "examen médico", "examen ocupacional", "certificado médico", 
        "necesito un examen", "quiero un examen", "hacer un examen",
        "examen", "ocupacional", "médico"
    ];
    return palabrasExamen.some(palabra => mensaje.toLowerCase().includes(palabra));
}

function esPreguntaSobrePrecios(mensaje) {
    const palabrasPrecios = [
        "cuanto vale", "cuánto vale", "cuanto cuesta", "cuánto cuesta",
        "cual es el precio", "cuál es el precio", "precio", "costo",
        "cuanto es", "cuánto es", "valor del", "costo del"
    ];
    return palabrasPrecios.some(palabra => mensaje.toLowerCase().includes(palabra));
}

function solicitaPago(mensaje) {
    const mensajeLower = mensaje.toLowerCase();
    
    if (esPreguntaSobrePrecios(mensaje)) {
        return false;
    }
    
    const palabrasPago = [
        "quiero pagar", "como pago", "donde pago", "datos para pagar",
        "información de pago", "datos de pago", "transferir", "consignar"
    ];
    
    return palabrasPago.some(palabra => mensajeLower.includes(palabra));
}

function ultimaPreguntaFueRevision(historial) {
    const ultimosMessages = historial.slice(-3);
    return ultimosMessages.some(m =>
        m.from === "sistema" && 
        m.mensaje.includes("¿Ya revisaste el certificado?")
    );
}

function ultimoMensajeFueVerificarDatos(historial) {
    const mensajesAdmin = historial.filter(m => m.from === "admin");
    if (mensajesAdmin.length === 0) return false;
   
    const ultimoMensajeAdmin = mensajesAdmin[mensajesAdmin.length - 1];
    const mensajesStop = [
        "Revisa que todo esté en orden",
        "revisa que todo esté en orden", 
        "revisa que todo este en orden"
    ];
    
    return mensajesStop.some(msg => ultimoMensajeAdmin.mensaje.toLowerCase().includes(msg.toLowerCase()));
}

// Función para detectar si el bot pidió documento recientemente
function botPidioDocumento(historial) {
    const ultimosMessages = historial.slice(-5);
    return ultimosMessages.some(m =>
        m.from === "sistema" && 
        (m.mensaje.includes("necesitaría tu número de documento") ||
         m.mensaje.includes("necesito tu número de documento") ||
         m.mensaje.includes("proporciona tu número de documento") ||
         m.mensaje.includes("indícame tu número de documento"))
    );
}

// Función simplificada para clasificar intenciones
function clasificarIntencion(mensaje, historial, contexto) {
    const mensajeLower = mensaje.toLowerCase().trim();
    
    // 1. Prioridad máxima: Respuestas de confirmación
    if (ultimaPreguntaFueRevision(historial)) {
        const confirmaciones = ["si", "sí", "ya", "claro", "por supuesto", "correcto", "exacto", "afirmativo"];
        if (confirmaciones.some(conf => mensajeLower.includes(conf))) {
            return "confirmar_revision";
        }
    }
    
    // 2. Solicitudes de asesor
    if (quiereAsesor(mensaje) || esCorreccionDeHorario(mensaje)) {
        return "solicitar_asesor";
    }
    
    // 3. Elección de opción de examen
    if (eligeOpcionExamen(mensaje)) {
        return "elegir_opcion_examen";
    }
    
    // 4. Quiere hacer examen
    if (quiereHacerExamen(mensaje)) {
        return "quiere_hacer_examen";
    }
    
    // 5. Preguntas sobre precios
    if (esPreguntaSobrePrecios(mensaje)) {
        return "pregunta_precios";
    }
    
    // 6. Solicitudes de pago
    if (solicitaPago(mensaje)) {
        return "solicitar_pago";
    }
    
    // 7. Solo cédula - 🆕 LÓGICA MEJORADA
    if (esCedula(mensaje)) {
        // 🚨 PRIORIDAD: Si el bot pidió documento, es para confirmar cita
        if (botPidioDocumento(historial)) return "confirmar_cita_solicitada";
        
        if (contexto.hayComprobantePago) return "solicitar_certificado";
        if (contexto.hayConfirmacionCita) return "confirmar_cita";
        if (contexto.hayDocumentoIdentidad) return "aclarar_necesidad";
        return "cedula_sola";
    }
    
    // 8. 🆕 NUEVO: Respuesta a documento de identidad enviado
    if (contexto.hayDocumentoIdentidad && !esCedula(mensaje)) {
        return "respuesta_documento_enviado";
    }
    
    // 9. Consulta general por defecto
    return "consulta_general";
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

    // 2. Obtener historial actualizado
    const { mensajes: mensajesHistorial = [], observaciones = "" } = await obtenerConversacionDeWix(from);
    const historialLimpio = limpiarDuplicados(mensajesHistorial);

    console.log("📝 Historial recuperado:", JSON.stringify(historialLimpio.slice(-5), null, 2));

    // 3. Verificar si el usuario está bloqueado
    if (String(observaciones).toLowerCase().includes("stop")) {
        return res.json({ success: true, mensaje: "Usuario bloqueado." });
    }

    // 4. Marcar STOP automáticamente cuando admin dice el mensaje
    if (ultimoMensajeFueVerificarDatos(historialLimpio)) {
        console.log("🛑 Detectado mensaje del ADMIN - Marcando STOP");
        await marcarStopEnWix(from);
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "Gracias por la información. Un asesor revisará tu caso y te contactará pronto.",
            remitente: "sistema"
        });
        return res.json({ success: true, mensaje: "Usuario marcado como STOP" });
    }

    // 5. Detectar contexto
    const contextoInfo = detectarContextoConversacion(historialLimpio, observaciones);
    console.log("🎯 Contexto detectado:", contextoInfo);

    // 6. Preparar contexto para clasificación
    const ultimaCedula = [...historialLimpio].reverse().find(m => esCedula(m.mensaje))?.mensaje || null;

    // 7. Clasificar intención con lógica simplificada
    const intencion = clasificarIntencion(userMessage, historialLimpio, contextoInfo);
    console.log("🎯 Intención clasificada:", intencion);

    // 8. MANEJO ESPECÍFICO POR INTENCIÓN

    // 🆕 NUEVO: Manejar cuando usuario envió documento de identidad y responde
    if (intencion === "respuesta_documento_enviado") {
        console.log("🆔 Usuario responde después de enviar documento");
        
        // Usar OpenAI para respuesta contextual
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
                    ...historialLimpio.slice(-8).map(m => ({
                        role: m.from === "usuario" ? "user" : "assistant",
                        content: m.mensaje
                    })),
                    { role: 'user', content: userMessage }
                ],
                max_tokens: 150
            })
        });

        const openaiJson = await aiRes.json();
        const respuestaBot = openaiJson.choices?.[0]?.message?.content || "¿En qué puedo ayudarte?";

        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: respuestaBot,
            remitente: "sistema"
        });

        return res.json({ success: true, respuesta: respuestaBot });
    }

    // 🆕 NUEVO: Cuando usuario envía cédula después de documento de identidad
    if (intencion === "aclarar_necesidad") {
        console.log("🆔 Usuario envió cédula después de documento - preguntando necesidad");
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "He recibido tu documento. ¿Necesitas consultar información sobre tu cita médica o realizar un examen ocupacional?",
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Pregunta sobre necesidad enviada" });
    }

    // 🆕 NUEVO: Contexto de listado de exámenes
    if (contextoInfo.contexto === "examenes") {
        console.log("📋 Usuario en contexto de listado de exámenes");
        
        // Si elige opción después de enviar listado
        if (intencion === "elegir_opcion_examen") {
            const esVirtual = userMessage.toLowerCase().includes("virtual") || userMessage.toLowerCase().includes("46");
            
            const respuesta = esVirtual 
                ? "Perfecto, para el examen virtual puedes agendar en: https://www.bsl.com.co/nuevaorden-1\n\nHorario: 7am a 7pm, todos los días."
                : "Perfecto, para el examen presencial puedes venir a:\n📍 Calle 134 No. 7-83, Bogotá\n⏰ Lunes a viernes: 7:30am-4:30pm | Sábados: 8am-11:30am";
            
            await enviarMensajeYGuardar({
                to,
                userId: from,
                nombre,
                texto: respuesta,
                remitente: "sistema"
            });
            
            return res.json({ success: true, mensaje: "Instrucciones de examen enviadas" });
        }
    }

    // Usuario quiere HACER un examen
    if (intencion === "quiere_hacer_examen") {
        console.log("🩺 Usuario quiere HACER un examen médico");
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "🩺 Nuestras opciones:\nVirtual – $46.000 COP\nPresencial – $69.000 COP",
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Opciones de examen enviadas" });
    }

    // Usuario elige opción Virtual o Presencial
    if (intencion === "elegir_opcion_examen") {
        const esVirtual = userMessage.toLowerCase().includes("virtual") || userMessage.toLowerCase().includes("46");
        
        console.log(`🎯 Usuario eligió: ${esVirtual ? "Virtual" : "Presencial"}`);
        
        if (esVirtual) {
            const detallesVirtual = `📱 **Examen Virtual - $46.000 COP**

📅 **Horario:** 7am a 7pm, todos los días
⏱️ **Duración:** 35 minutos total

📋 **Incluye:**
• Médico osteomuscular
• Audiometría 
• Optometría

🔗 **Para agendar:**
https://www.bsl.com.co/nuevaorden-1

Después pagas y descargas el certificado al instante.`;

            await enviarMensajeYGuardar({
                to,
                userId: from,
                nombre,
                texto: detallesVirtual,
                remitente: "sistema"
            });
        } else {
            const detallesPresencial = `🏥 **Examen Presencial - $69.000 COP**

📍 **Ubicación:** Calle 134 No. 7-83, Bogotá
📅 **Horario:** 
• Lunes a viernes: 7:30am-4:30pm
• Sábados: 8am-11:30am

📋 **Incluye lo mismo que el virtual**

ℹ️ **No requiere agendar** - Por orden de llegada`;

            await enviarMensajeYGuardar({
                to,
                userId: from,
                nombre,
                texto: detallesPresencial,
                remitente: "sistema"
            });
        }
        
        return res.json({ success: true, mensaje: "Detalles enviados" });
    }

    // Preguntas sobre precios
    if (intencion === "pregunta_precios") {
        console.log("💰 Usuario pregunta sobre precios");
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "🩺 Nuestras opciones:\nVirtual – $46.000 COP\nPresencial – $69.000 COP",
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Precios enviados" });
    }

    // Confirmación de revisión de certificado
    if (intencion === "confirmar_revision") {
        console.log("💳 Usuario confirmó revisión - enviando datos de pago");
        
        const datosPago = `💳 **Datos para el pago:**

**Bancolombia:** Ahorros 44291192456 (cédula 79981585)
**Daviplata:** 3014400818 (Mar Rea)  
**Nequi:** 3008021701 (Dan Tal)
**También:** Transfiya

Envía SOLO tu comprobante de pago por aquí`;

        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: datosPago,
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Datos de pago enviados" });
    }

    // Solicitudes de pago (sin datos enviados recientemente)
    if (intencion === "solicitar_pago" && !contextoInfo.yaSeEnviaronDatos) {
        console.log("💰 Usuario solicita pago");
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "¿Ya revisaste el certificado?",
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Pregunta sobre revisión enviada" });
    }

    // Solicitudes de asesor o correcciones
    if (intencion === "solicitar_asesor") {
        console.log("🔧 Transferir a asesor");
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "...transfiriendo con asesor",
            remitente: "sistema"
        });
        
        return res.json({ success: true, mensaje: "Transferido a asesor" });
    }

    // CONTEXTO: Usuario envió confirmación de cita + cédula
    if (contextoInfo.contexto === "consulta_cita" && ultimaCedula && !contextoInfo.yaSeConsultoInfo) {
        console.log("📅 Procesando consulta de cita:", ultimaCedula);
      
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
        }
        return res.json({ success: true });
    }

    // CONTEXTO: Usuario envió comprobante de pago + cédula 
    if (contextoInfo.contexto === "pago" && ultimaCedula) {
        console.log("💰 Procesando certificado con cédula:", ultimaCedula);
      
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "🔍 Un momento por favor...",
            remitente: "sistema"
        });

        try {
            const infoPaciente = await consultarInformacionPaciente(ultimaCedula);
            
            if (infoPaciente && infoPaciente.length > 0) {
                const paciente = infoPaciente[0];
                
                if (paciente.atendido === "ATENDIDO") {
                    await marcarPagado(ultimaCedula);
                    const pdfUrl = await generarPdfDesdeApi2Pdf(ultimaCedula);
                    await sendPdf(to, pdfUrl, ultimaCedula);
                    await eliminarConversacionDeWix(from);
                    return res.json({ success: true });
                } else {
                    await marcarPagado(ultimaCedula);
                    await enviarMensajeYGuardar({
                        to,
                        userId: from,
                        nombre,
                        texto: "Pago registrado. Un asesor te contactará para continuar.",
                        remitente: "sistema"
                    });
                    return res.json({ success: true });
                }
            } else {
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
            console.error("Error generando PDF:", err);
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

    // Confirmar cita cuando no hay contexto específico
    if (intencion === "confirmar_cita" && !contextoInfo.yaSeConsultoInfo) {
        if (!ultimaCedula) {
            await enviarMensajeYGuardar({
                to,
                userId: from,
                nombre,
                texto: "Por favor indícame tu número de documento para confirmar tu cita.",
                remitente: "sistema"
            });
            return res.json({ success: true });
        }

        // Resto de la lógica de confirmación de cita...
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
        }
        return res.json({ success: true });
    }

    // Solo cédula sin contexto
    if (intencion === "cedula_sola") {
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "He recibido tu número de documento. ¿Necesitas consultar información sobre tu cita o ya realizaste el pago del examen?",
            remitente: "sistema"
        });
        return res.json({ success: true });
    }

    // Chat normal con OpenAI como fallback
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
                ...historialLimpio.slice(-10).map(m => ({
                    role: m.from === "usuario" ? "user" : "assistant",
                    content: m.mensaje
                })),
                { role: 'user', content: userMessage }
            ],
            max_tokens: 150
        })
    });

    const openaiJson = await aiRes.json();
    const respuestaBot = openaiJson.choices?.[0]?.message?.content || "No se obtuvo respuesta.";

    await enviarMensajeYGuardar({
        to,
        userId: from,
        nombre,
        texto: respuestaBot,
        remitente: "sistema"
    });

    return res.json({ success: true, respuesta: respuestaBot });
}

module.exports = { procesarTexto };