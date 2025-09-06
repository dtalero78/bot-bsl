const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnDB, obtenerConversacionDeDB } = require('../utils/dbAPI');
const { limpiarDuplicados, generarTimestamp, logError, logInfo } = require('../utils/shared');
const { getCacheService } = require('./cacheService');

/**
 * Servicio unificado para manejo de mensajes
 * Consolida toda la lógica de envío y guardado de mensajes
 */
class MessageService {
    
    /**
     * Envía un mensaje por WhatsApp y lo guarda en la base de datos
     * @param {Object} params - Parámetros del mensaje
     * @param {string} params.to - Número de destino (formato WhatsApp)
     * @param {string} params.userId - ID del usuario (sin formato WhatsApp)
     * @param {string} params.nombre - Nombre del usuario
     * @param {string} params.texto - Texto del mensaje a enviar
     * @param {Array} params.historial - Historial existente de la conversación
     * @param {string} params.remitente - Remitente del mensaje ('sistema', 'admin', 'usuario')
     * @param {string} params.fase - Fase actual de la conversación
     * @returns {Object} - Resultado de la operación
     */
    static async enviarMensajeYGuardar({
        to,
        userId,
        nombre,
        texto,
        historial = [],
        remitente = "sistema",
        fase = "inicial"
    }) {
        try {
            // 1. Enviar mensaje por WhatsApp si se especifica destinatario
            if (to) {
                const resultado = await sendMessage(to, texto);
                if (!resultado.success && resultado.error) {
                    logError('MessageService.enviarMensajeYGuardar', 
                        `Error enviando mensaje a ${to}: ${resultado.error}`,
                        { userId, remitente, fase }
                    );
                    return { success: false, error: resultado.error };
                }
                
                logInfo('MessageService.enviarMensajeYGuardar', 
                    `Mensaje enviado exitosamente`,
                    { to, userId, remitente, messageLength: texto.length }
                );
            }
            
            // 2. Actualizar historial con el nuevo mensaje
            const nuevoHistorial = limpiarDuplicados([
                ...historial,
                {
                    from: remitente,
                    mensaje: texto,
                    timestamp: generarTimestamp()
                }
            ]);
            
            // 3. Guardar en base de datos
            const guardado = await guardarConversacionEnDB({
                userId,
                nombre,
                mensajes: nuevoHistorial,
                fase
            });
            
            // 4. Invalidar caché para forzar actualización en próxima consulta
            const cacheService = getCacheService();
            await cacheService.invalidarConversacion(userId);
            
            return {
                success: true,
                guardado,
                historialActualizado: nuevoHistorial
            };
            
        } catch (error) {
            logError('MessageService.enviarMensajeYGuardar', 
                error,
                { userId, remitente, fase, messageLength: texto?.length }
            );
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Guarda un mensaje en el historial sin enviarlo por WhatsApp
     * @param {Object} params - Parámetros del mensaje
     * @returns {Object} - Resultado de la operación
     */
    static async guardarMensaje({
        userId,
        nombre,
        texto,
        historial = [],
        remitente = "usuario",
        fase = "inicial"
    }) {
        return await this.enviarMensajeYGuardar({
            to: null, // No enviar por WhatsApp
            userId,
            nombre,
            texto,
            historial,
            remitente,
            fase
        });
    }
    
    /**
     * Envía un mensaje simple sin guardarlo en historial
     * @param {string} to - Número de destino
     * @param {string} texto - Mensaje a enviar
     * @returns {Object} - Resultado del envío
     */
    static async enviarMensajeSimple(to, texto) {
        try {
            const resultado = await sendMessage(to, texto);
            
            if (resultado.success) {
                logInfo('MessageService.enviarMensajeSimple', 
                    'Mensaje simple enviado exitosamente',
                    { to, messageLength: texto.length }
                );
            } else {
                logError('MessageService.enviarMensajeSimple', 
                    `Error enviando mensaje simple: ${resultado.error}`,
                    { to }
                );
            }
            
            return resultado;
        } catch (error) {
            logError('MessageService.enviarMensajeSimple', error, { to });
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Obtiene la conversación de un usuario con paginación y caché (por defecto últimos 50 mensajes)
     * @param {string} userId - ID del usuario
     * @param {number} limit - Límite de mensajes (por defecto 50)
     * @returns {Object} - Conversación con metadatos
     */
    static async obtenerConversacion(userId, limit = 50) {
        const cacheService = getCacheService();
        
        try {
            // 1. Intentar obtener del caché primero
            const conversacionCacheada = await cacheService.obtenerConversacion(userId);
            
            if (conversacionCacheada && (!limit || conversacionCacheada.mensajes.length <= limit)) {
                logInfo('MessageService.obtenerConversacion', 'Conversación obtenida del caché', { 
                    userId, 
                    mensajes: conversacionCacheada.mensajes.length 
                });
                return conversacionCacheada;
            }
            
            // 2. Si no está en caché, obtener de base de datos
            const conversacion = await obtenerConversacionDeDB(userId, limit);
            const historialLimpio = limpiarDuplicados(conversacion.mensajes || []);
            
            const conversacionProcesada = {
                ...conversacion,
                mensajes: historialLimpio,
                ultimoMensaje: historialLimpio[historialLimpio.length - 1] || null,
                fechaUltimaInteraccion: historialLimpio[historialLimpio.length - 1]?.timestamp || null
            };
            
            // 3. Guardar en caché si tiene mensajes (conversaciones activas)
            if (historialLimpio.length > 0) {
                await cacheService.guardarConversacion(userId, conversacionProcesada);
            }
            
            return conversacionProcesada;
            
        } catch (error) {
            logError('MessageService.obtenerConversacion', error, { userId });
            return {
                mensajes: [],
                observaciones: "",
                fase: "inicial",
                totalMensajes: 0,
                ultimoMensaje: null,
                fechaUltimaInteraccion: null,
                truncated: false
            };
        }
    }

    /**
     * Obtiene la conversación completa de un usuario (sin paginación)
     * @param {string} userId - ID del usuario
     * @returns {Object} - Conversación completa con metadatos
     */
    static async obtenerConversacionCompleta(userId) {
        return await this.obtenerConversacion(userId, -1); // Sin límite
    }
    
    /**
     * Verifica si un usuario está bloqueado
     * @param {string} observaciones - Campo observaciones del usuario
     * @returns {boolean} - True si está bloqueado
     */
    static estaUsuarioBloqueado(observaciones) {
        return String(observaciones || "").toLowerCase().includes("stop");
    }
    
    /**
     * Agrega un mensaje del usuario al historial
     * @param {string} userId - ID del usuario
     * @param {string} mensaje - Mensaje del usuario
     * @param {string} nombre - Nombre del usuario
     * @param {Array} historial - Historial existente
     * @param {string} fase - Fase actual
     * @returns {Array} - Historial actualizado
     */
    static agregarMensajeUsuario(userId, mensaje, nombre, historial, fase = "inicial") {
        const mensajeUsuario = {
            from: "usuario",
            mensaje: mensaje,
            timestamp: generarTimestamp()
        };
        
        const historialActualizado = limpiarDuplicados([...historial, mensajeUsuario]);
        
        // Guardar en base de datos de forma asíncrona (no bloqueante)
        guardarConversacionEnDB({
            userId,
            nombre,
            mensajes: historialActualizado,
            fase
        }).catch(error => {
            logError('MessageService.agregarMensajeUsuario', error, { userId });
        });
        
        return historialActualizado;
    }
}

module.exports = MessageService;