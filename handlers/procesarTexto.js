const { guardarConversacionEnDB, obtenerConversacionDeDB, actualizarObservaciones } = require('../utils/dbAPI');
const { determinarNuevaFase } = require('../utils/faseDetector');
const { limpiarDuplicados, extraerUserId, obtenerTextoMensaje, logInfo, logError, generarTimestamp } = require('../utils/shared');
const ValidationService = require('../utils/validation');
const MessageService = require('../services/messageService');
const { config } = require('../config/environment');
const { 
    manejarFaseInicial, 
    manejarPostAgendamiento, 
    manejarRevisionCertificado, 
    manejarPago 
} = require('./faseHandlers');

/**
 * Marca automáticamente como STOP cuando el admin envía mensaje específico
 */
async function marcarStopAutomatico(userId) {
    try {
        await actualizarObservaciones(userId, "stop");
        logInfo('procesarTexto', 'STOP marcado automáticamente por mensaje de admin', { userId });
        return { success: true };
    } catch (error) {
        logError('procesarTexto', 'Error marcando STOP automático', { userId, error });
        return { success: false, error: error.message };
    }
}

/**
 * Detecta si el último mensaje del admin fue de verificación de datos
 */
function ultimoMensajeFueVerificarDatos(historial) {
    const mensajesAdmin = historial.filter(m => m.from === "admin");
    if (mensajesAdmin.length === 0) return false;
   
    const ultimoMensajeAdmin = mensajesAdmin[mensajesAdmin.length - 1];
    const mensajesStop = [
        "Revisa que todo esté en orden",
        "revisa que todo esté en orden", 
        "revisa que todo este en orden"
    ];
    
    return mensajesStop.some(msg => 
        ultimoMensajeAdmin.mensaje.toLowerCase().includes(msg.toLowerCase())
    );
}

/**
 * FUNCIÓN PRINCIPAL - Procesar mensaje de texto con sistema de fases
 */
async function procesarTexto(message, res) {
    try {
        const from = message.from;
        const nombre = message.from_name || "Usuario";
        const chatId = message.chat_id;
        const to = from;
        const userMessage = obtenerTextoMensaje(message);
        const userId = extraerUserId(from);

        // Validar mensaje de entrada
        const validacionMensaje = ValidationService.validarMensajeTexto(userMessage, 500);
        if (!validacionMensaje.isValid) {
            logError('procesarTexto', `Mensaje inválido: ${validacionMensaje.error}`, { userId });
            
            await MessageService.enviarMensajeSimple(to,
                `❌ ${validacionMensaje.error}. Por favor envía un mensaje válido.`
            );
            
            return res.status(400).json({ 
                success: false, 
                error: validacionMensaje.error,
                context: 'message_validation'
            });
        }

        const mensajeLimpio = validacionMensaje.sanitized;

        logInfo('procesarTexto', 'Procesando mensaje de texto', {
            userId,
            nombre,
            messagePreview: mensajeLimpio.substring(0, 50) + (mensajeLimpio.length > 50 ? '...' : ''),
            originalLength: userMessage.length,
            sanitizedLength: mensajeLimpio.length
        });

        // 1. Obtener estado actual de la conversación
        const { mensajes: historial = [], observaciones = "", fase = "inicial" } = 
            await obtenerConversacionDeDB(userId);
        const historialLimpio = limpiarDuplicados(historial);

        // 2. Verificar si el usuario está bloqueado
        if (MessageService.estaUsuarioBloqueado(observaciones)) {
            logInfo('procesarTexto', 'Usuario bloqueado por observaciones STOP', { userId });
            return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones." });
        }

        // 3. Agregar mensaje del usuario al historial (usando mensaje sanitizado)
        const historialActualizado = MessageService.agregarMensajeUsuario(
            userId, 
            mensajeLimpio, 
            nombre, 
            historialLimpio, 
            fase
        );

        logInfo('procesarTexto', 'Estado de conversación', {
            userId,
            fase,
            totalMensajes: historialActualizado.length,
            observaciones: observaciones ? 'present' : 'empty'
        });

        // 4. Detectar cambio de fase automáticamente
        const nuevaFase = determinarNuevaFase(fase, mensajeLimpio, historialActualizado);
        
        if (nuevaFase !== fase) {
            logInfo('procesarTexto', 'Cambio de fase detectado', { 
                userId, 
                faseAnterior: fase, 
                nuevaFase 
            });
            
            // Actualizar fase en la base de datos
            await guardarConversacionEnDB({ 
                userId, 
                nombre, 
                mensajes: historialActualizado, 
                fase: nuevaFase 
            });
        }

        // 5. Verificar si necesita marcar STOP automático por mensaje de admin
        if (ultimoMensajeFueVerificarDatos(historialActualizado)) {
            logInfo('procesarTexto', 'Detectado mensaje de verificación del admin - Marcando STOP', { userId });
            
            await marcarStopAutomatico(userId);
            
            await MessageService.enviarMensajeYGuardar({
                to,
                userId,
                nombre,
                texto: "Gracias por la información. Un asesor revisará tu caso y te contactará pronto.",
                historial: historialActualizado,
                remitente: "sistema",
                fase: nuevaFase
            });
            
            return res.json({ success: true, mensaje: "Usuario marcado como STOP automáticamente" });
        }

        // 6. Enrutar a la fase correspondiente
        logInfo('procesarTexto', 'Enrutando a manejador de fase', { userId, fase: nuevaFase });
        
        switch (nuevaFase) {
            case "inicial":
                return await manejarFaseInicial(message, res, historialActualizado);
            
            case "post_agendamiento":
                return await manejarPostAgendamiento(message, res, historialActualizado);
            
            case "revision_certificado":
                return await manejarRevisionCertificado(message, res, historialActualizado);
            
            case "pago":
                return await manejarPago(message, res, historialActualizado);
            
            default:
                logError('procesarTexto', `Fase no reconocida: ${nuevaFase}`, { userId });
                
                // Fallback a fase inicial
                return await manejarFaseInicial(message, res, historialActualizado);
        }

    } catch (error) {
        const userId = extraerUserId(message.from);
        logError('procesarTexto', 'Error general procesando texto', { 
            userId, 
            error,
            messageType: message.type 
        });

        // Intentar enviar mensaje de error al usuario
        try {
            await MessageService.enviarMensajeSimple(message.from, 
                "❌ Hubo un problema procesando tu mensaje. Por favor intenta de nuevo."
            );
        } catch (sendError) {
            logError('procesarTexto', 'Error enviando mensaje de error', { userId, error: sendError });
        }

        return res.status(500).json({ 
            success: false, 
            error: error.message,
            context: 'procesarTexto'
        });
    }
}

module.exports = { procesarTexto };