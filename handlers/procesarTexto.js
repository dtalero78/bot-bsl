const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { sendMessage } = require('../utils/sendMessage');
const { sendPdf, generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');
const { consultarInformacionPaciente } = require('../utils/consultarPaciente');
const { marcarPagado } = require('../utils/marcarPagado');
const { esCedula, contieneTexto } = require('../utils/validaciones');

// 🆕 Prompt mejorado actualizado
const promptInstitucional = `
Eres el asistente virtual de exámenes médicos ocupacionales para BSL en Colombia. Tu tarea es responder en frases cortas, claras y sin tecnicismos. La mayoría de los usuarios tienen baja alfabetización.

🎯 TU ROL:
- Responde solo sobre exámenes médicos de BSL.
- Si preguntan por su cita, pide número de documento si no lo tienes.
- Saluda o despide si el usuario lo hace, siempre como BSL.
- Para descargar el certificado, primero envía el soporte de pago por este medio.
- Si pide un asesor o no entiendes, responde exactamente: "...transfiriendo con asesor" (sin punto final). Eso detiene el bot.

📋 SERVICIOS:

1. **Exámenes Ocupacionales**
   - **Virtual**: $46.000 COP  
     - Agenda tu hora
     - Pruebas en línea
     - Médico te contacta
     - Pagas y descargas el certificado al instante
     - Incluye: Médico osteomuscular, audiometría, optometría
     - Link: https://www.bsl.com.co/nuevaorden-1 
     - Horario: 7am a 7pm, todos los días

   - **Presencial**: $69.000 COP  
     - Calle 134 No. 7-83, Bogotá
     - Lunes a viernes 7:30am-4:30pm | Sábados 8am-11:30am
     - No requiere agendar, es por orden de llegada
     - Incluye lo mismo que el virtual

2. **Pagos**
   - Bancolombia: Ahorros 44291192456 (cédula 79981585)
   - Daviplata: 3014400818 (Mar Rea)
   - Nequi: 3008021701 (Dan Tal)
   - También Transfiya

3. **Extras opcionales**
   - Cardiovascular, Vascular, Espirometría, Dermatológico: $5.000 c/u
   - Psicológico: $15.000
   - Perfil lipídico: $60.000
   - Glicemia: $20.000

📌 INDICACIONES IMPORTANTES:
- Si requiere perfil lipídico o glicemia, puede hacer el examen virtual y adjuntar los laboratorios después.
- Si tiene exámenes de laboratorio realizados (incluso en otro laboratorio) puede adjuntarlos
- Prueba psicosensométrica solo presencial (si es para conductores) de lo contrario es virtual
- Para descargar el certificado, primero envía el soporte de pago por este medio.
- El proceso es secuencial: agenda → pruebas virtuales → consulta médica → revisión y aprobación de certificado → pago.
- Nunca muestres medios de pago ni los solicites antes de que el usuario haya revisado y aprobado el certificado.
- Si el usuario pregunta por pago pregúntale: ¿Ya revisaste el certificado? y si responde que si envíale los datos para el pago.
- Usa respuestas cortas (máx 2 líneas) y viñetas si hay varios puntos.
- Todo el proceso dura 25 minutos las pruebas virtuales y 10 minutos la consulta médica

• Si ya enviaste el certificado, **NO vuelvas a enviarlo** a menos que el usuario lo pida explícitamente.
• Si pregunta por precios, horarios, cómo agendar u otra info general tras recibir el certificado, responde normalmente.
• Si el usuario pide el certificado explícitamente ("certificado", "pdf", "descargar"), puedes volver a enviarlo.
• Responde siempre con base en el historial de la conversación.

📌 INTENCIONES:
- Si pregunta cómo hacer un examen, quiere info general o necesita orientación, responde así:
  "🩺 Nuestras opciones:
   Virtual – $46.000 COP
   Presencial – $69.000 COP"
- Solo entrega los detalles completos si responde "virtual", "presencial", "el de 46", "el de 69", etc.
- Si pregunta por cita respóndele que en el link de agendamiento están los turnos disponibles 
- Si ya agendó la cita y necesita confirmar su horario respóndele:
  "Claro, para ayudarte necesito tu número de documento. Por favor escríbelo."

🔗 MENSAJES DEL ADMINISTRADOR:
- Si un ADMINISTRADOR dio info o instrucciones útiles, úsalas como contexto.
- Si pregunta "¿qué me falta terminar?", "¿qué hago ahora?", etc., explica lo que el ADMIN indicó.
- Solo transfiere con asesor si no tienes información suficiente o el usuario lo pide.

🔒 TEMAS NO PERMITIDOS:
- Si pregunta por otros temas ajenos a BSL, responde que solo atiendes servicios médicos de BSL.
- No uses formato tipo [texto](url); escribe los enlaces directo.
- Resume respuestas en viñetas si hay varios puntos.
`;

// 🆕 Clasificador mejorado para trabajar mejor con imágenes y contexto
const promptClasificador = `
Eres un clasificador experto de intenciones para un asistente médico. Analiza el contexto completo de la conversación para determinar qué necesita el usuario.

CONTEXTO A CONSIDERAR:
- Si el usuario envió imágenes recientemente (comprobantes, confirmaciones, etc.)
- Si ya existe una cédula en el historial
- Si hay mensajes del administrador
- El flujo natural de la conversación

OPCIONES DE CLASIFICACIÓN (responde SOLO la etiqueta):

1. **confirmar_cita** - Cuando el usuario:
   - Pregunta por fecha/hora de su cita
   - Envió confirmación de cita + quiere info
   - Dice "cuándo es mi cita", "qué día tengo cita"

2. **solicitar_certificado** - Cuando el usuario:
   - Envió comprobante de pago + quiere certificado
   - Pregunta por su certificado después de pagar
   - Dice "mi certificado", "pdf", "descargar"

3. **aprobar_certificado** - Cuando el usuario:
   - Responde "sí", "apruebo", "está bien", "correcto"
   - El admin preguntó por aprobación antes
   - Confirma que está de acuerdo con algo

4. **consulta_general** - Cuando el usuario:
   - Pregunta precios, horarios, servicios
   - Quiere información sobre exámenes
   - Saluda o se presenta

5. **sin_intencion_clara** - Cuando:
   - No puedes determinar qué necesita
   - El mensaje es ambiguo o incompleto

REGLAS ESPECIALES:
- Imágenes + cédula = infer intención del tipo de imagen
- Admin pidió algo = considerar respuesta del usuario
- Solo texto sin contexto = clasificar por palabras clave

Responde únicamente con UNA de las 5 etiquetas anteriores.
`;

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
    
    OPCIONES DE RESPUESTA (responde SOLO la etiqueta):
    - confirmar_cita: Usuario quiere consultar información de su cita médica (SOLO si no se consultó antes)
    - solicitar_certificado: Usuario quiere su certificado médico después de pagar  
    - aprobar_certificado: Usuario confirma/aprueba su certificado (respuestas como "sí", "apruebo", "está bien", "correcto")
    - correccion_datos: Usuario indica que hay un error en los datos mostrados (palabras como "equivocado", "mal", "error", "debe ser")
    - solicitar_asesor: Usuario quiere hablar con una persona o reportar un problema
    - consulta_general: Preguntas generales sobre servicios, precios, horarios
    - sin_intencion_clara: No se puede determinar la intención claramente
    
    REGLAS ESPECIALES:
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