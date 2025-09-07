/**
 * Funciones compartidas para evitar duplicación de código
 */

const logger = require('./logger');

/**
 * Elimina mensajes duplicados del historial de conversación
 * @param {Array} historial - Array de mensajes con estructura {from, mensaje}
 * @returns {Array} - Historial sin duplicados
 */
function limpiarDuplicados(historial) {
    const vistos = new Set();
    return historial.filter(m => {
        const clave = `${m.from}|${m.mensaje}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
    });
}

/**
 * Extrae el texto del mensaje según su tipo
 * @param {Object} message - Objeto del mensaje de WhatsApp
 * @returns {string} - Texto extraído del mensaje
 */
function obtenerTextoMensaje(message) {
    if (message.type === "text") {
        return message.text?.body?.trim() || "";
    }
    if (message.type === "link_preview") {
        return message.link_preview?.body?.trim() || "";
    }
    return "";
}

/**
 * Genera un timestamp ISO string para mensajes
 * @returns {string} - Timestamp en formato ISO
 */
function generarTimestamp() {
    return new Date().toISOString();
}

/**
 * Valida si una cadena es un número de cédula válido
 * @param {string} str - Cadena a validar
 * @returns {boolean} - True si es una cédula válida
 */
function esCedula(str) {
    const cedula = str?.toString()?.trim() || "";
    return /^\d{6,12}$/.test(cedula);
}

/**
 * Sanitiza el userId removiendo el sufijo de WhatsApp
 * @param {string} chatId - ID del chat completo
 * @returns {string} - UserId limpio
 */
function extraerUserId(chatId) {
    return (chatId || "").replace("@s.whatsapp.net", "");
}

/**
 * Formatea el número para WhatsApp con el sufijo correcto
 * @param {string} userId - ID del usuario
 * @returns {string} - Número formateado para WhatsApp
 */
function formatearParaWhatsApp(userId) {
    return `${userId}@s.whatsapp.net`;
}

/**
 * Registra errores de manera consistente usando el sistema de logging estructurado
 * @param {string} context - Contexto del error
 * @param {Error|string} error - Error a registrar
 * @param {Object} metadata - Metadatos adicionales
 */
function logError(context, error, metadata = {}) {
    try {
        const logger = require('./logger');
        logger.error(context, error instanceof Error ? error.message : error, {
            error: error instanceof Error ? error : undefined,
            ...metadata
        });
    } catch (err) {
        // Fallback if logger is not available due to circular dependency
        console.error(`[${context}] Error:`, error instanceof Error ? error.message : error);
    }
}

/**
 * Registra información de manera consistente usando el sistema de logging estructurado
 * @param {string} context - Contexto del log
 * @param {string} message - Mensaje a registrar
 * @param {Object} metadata - Metadatos adicionales
 */
function logInfo(context, message, metadata = {}) {
    logger.info(context, message, metadata);
}

module.exports = {
    limpiarDuplicados,
    obtenerTextoMensaje,
    generarTimestamp,
    esCedula,
    extraerUserId,
    formatearParaWhatsApp,
    logError,
    logInfo
};