// Funciones para detectar y manejar las transiciones entre fases del bot

/**
 * Detectar cuando el usuario agenda una consulta (transición a post-agendamiento)
 */
function detectarAgendamiento(historial) {
    const ultimosMessages = historial.slice(-5);
    return ultimosMessages.some(m => 
        m.from === "sistema" && 
        (m.mensaje.includes("Para comenzar haz clic:") ||
         m.mensaje.includes("https://www.bsl.com.co/nuevaorden-1") ||
         m.mensaje.includes("Perfecto, para el examen virtual puedes agendar") ||
         m.mensaje.includes("Perfecto, para el examen presencial puedes venir"))
    );
}

/**
 * Detectar cuando admin dice "revisa que todo esté en orden" (transición a revisión)
 */
function detectarRevisionCertificado(historial) {
    const mensajesAdmin = historial.filter(m => m.from === "admin");
    if (mensajesAdmin.length === 0) return false;
   
    const ultimoMensajeAdmin = mensajesAdmin[mensajesAdmin.length - 1];
    const mensajesRevision = [
        "revisa que todo esté en orden",
        "revisa que todo este en orden",
        "revisa el certificado"
    ];
    
    return mensajesRevision.some(msg => 
        ultimoMensajeAdmin.mensaje.toLowerCase().includes(msg.toLowerCase())
    );
}

/**
 * Detectar confirmación de revisión de certificado (transición a pago)
 */
function detectarConfirmacionRevision(mensaje, historial) {
    const ultimosMessages = historial.slice(-3);
    const preguntaRevision = ultimosMessages.some(m => 
        m.from === "sistema" && 
        m.mensaje.includes("¿Ya revisaste el certificado?")
    );
    
    if (!preguntaRevision) return false;
    
    const mensajeLower = mensaje.toLowerCase().trim();
    const confirmaciones = ["si", "sí", "ya", "correcto", "bien", "está bien", "perfecto", "ok"];
    
    return confirmaciones.some(conf => mensajeLower.includes(conf));
}

/**
 * Detectar cuando se completa el pago (finalización)
 */
function detectarPagoCompletado(historial) {
    const ultimosMessages = historial.slice(-3);
    return ultimosMessages.some(m => 
        m.from === "sistema" && 
        (m.mensaje.includes("PDF generado y enviado correctamente") ||
         m.mensaje.includes("certificado médico en PDF"))
    );
}

/**
 * Determinar la nueva fase basada en el estado actual y el historial
 */
function determinarNuevaFase(faseActual, mensaje, historial) {
    switch (faseActual) {
        case "inicial":
            if (detectarAgendamiento(historial)) {
                return "post_agendamiento";
            }
            break;
            
        case "post_agendamiento":
            if (detectarRevisionCertificado(historial)) {
                return "revision_certificado";
            }
            break;
            
        case "revision_certificado":
            if (detectarConfirmacionRevision(mensaje, historial)) {
                return "pago";
            }
            break;
            
        case "pago":
            if (detectarPagoCompletado(historial)) {
                return "completado";
            }
            break;
            
        case "completado":
            // Después de completado, podría volver a inicial para nueva consulta
            // o mantenerse completado dependiendo de la lógica de negocio
            return "completado";
            
        default:
            return "inicial";
    }
    
    return faseActual; // Mantener fase actual si no hay cambio
}

/**
 * Obtener opciones de menú para fase post-agendamiento
 */
function getOpcionesPostAgendamiento() {
    return `Selecciona una opción escribiendo el *número*:

1️⃣ ¿A qué hora quedó mi cita?
2️⃣ Problemas con la aplicación
3️⃣ No me funciona el formulario
4️⃣ Se me cerró la aplicación
5️⃣ Hablar con un asesor`;
}

/**
 * Obtener opciones de menú para revisión de certificado
 */
function getOpcionesRevisionCertificado() {
    return `¿Ya revisaste tu certificado médico?

1️⃣ Sí, está correcto
2️⃣ Hay un error que corregir
3️⃣ No he podido revisarlo
4️⃣ Hablar con un asesor`;
}

/**
 * Validar si la respuesta es una opción numérica válida
 */
function esOpcionNumerica(mensaje, rangoMaximo) {
    const numero = parseInt(mensaje.trim());
    return !isNaN(numero) && numero >= 1 && numero <= rangoMaximo;
}

module.exports = {
    detectarAgendamiento,
    detectarRevisionCertificado,
    detectarConfirmacionRevision,
    detectarPagoCompletado,
    determinarNuevaFase,
    getOpcionesPostAgendamiento,
    getOpcionesRevisionCertificado,
    esOpcionNumerica
};