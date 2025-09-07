const { guardarConversacionEnDB, obtenerConversacionDeDB, actualizarObservaciones } = require('../utils/dbAPI');
const { limpiarDuplicados, extraerUserId, obtenerTextoMensaje, logInfo, logError } = require('../utils/shared');
const ValidationService = require('../utils/validation');
const MessageService = require('../services/messageService');
const { getOpenAIService } = require('../services/openaiService');
const { promptInstitucional } = require('../utils/prompt');

/**
 * Marca automáticamente como STOP cuando el admin envía mensaje específico
 */
async function marcarStopAutomatico(userId) {
    try {
        await actualizarObservaciones(userId, "stop");
        logInfo('procesarTextoSimple', 'STOP marcado automáticamente por mensaje de admin', { userId });
        return { success: true };
    } catch (error) {
        logError('procesarTextoSimple', 'Error marcando STOP automático', { userId, error });
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
 * FUNCIÓN PRINCIPAL SIMPLIFICADA - Solo usa GPT-4 con un prompt
 */
async function procesarTextoSimple(message, res) {
    try {
        const from = message.from;
        const nombre = message.from_name || "Usuario";
        const to = from;
        const userMessage = obtenerTextoMensaje(message);
        const userId = extraerUserId(from);

        // Validar mensaje de entrada
        const validacionMensaje = ValidationService.validarMensajeTexto(userMessage, 500);
        if (!validacionMensaje.isValid) {
            logError('procesarTextoSimple', `Mensaje inválido: ${validacionMensaje.error}`, { userId });
            
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

        logInfo('procesarTextoSimple', 'Procesando mensaje con approach simplificado', {
            userId,
            nombre,
            messagePreview: mensajeLimpio.substring(0, 50) + (mensajeLimpio.length > 50 ? '...' : ''),
            originalLength: userMessage.length,
            sanitizedLength: mensajeLimpio.length
        });

        // 1. Obtener historial de conversación
        const { mensajes: historial = [], observaciones = "" } = 
            await obtenerConversacionDeDB(userId);
        const historialLimpio = limpiarDuplicados(historial);

        // 2. Verificar si el usuario está bloqueado
        if (MessageService.estaUsuarioBloqueado(observaciones)) {
            logInfo('procesarTextoSimple', 'Usuario bloqueado por observaciones STOP', { userId });
            return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones." });
        }

        // 3. Agregar mensaje del usuario al historial
        const historialActualizado = MessageService.agregarMensajeUsuario(
            userId, 
            mensajeLimpio, 
            nombre, 
            historialLimpio
        );

        // 4. Verificar si necesita marcar STOP automático por mensaje de admin
        if (ultimoMensajeFueVerificarDatos(historialActualizado)) {
            logInfo('procesarTextoSimple', 'Detectado mensaje de verificación del admin - Marcando STOP', { userId });
            
            await marcarStopAutomatico(userId);
            
            const mensajeStop = "Gracias por la información. Un asesor revisará tu caso y te contactará pronto.";
            await MessageService.enviarMensajeYGuardar({
                to,
                userId,
                nombre,
                texto: mensajeStop,
                historial: historialActualizado,
                remitente: "sistema"
            });
            
            return res.json({ success: true, mensaje: "Usuario marcado como STOP automáticamente" });
        }

        // 5. RESPUESTA SIMPLE: Solo GPT-4 con el prompt institucional
        logInfo('procesarTextoSimple', 'Generando respuesta con GPT-4', { userId });
        
        try {
            const openaiService = getOpenAIService();
            
            // Preparar mensajes para OpenAI
            const mensajesParaOpenAI = [
                { role: 'system', content: promptInstitucional },
                // Incluir últimos 10 mensajes para contexto
                ...historialActualizado.slice(-10).map(m => ({
                    role: m.from === "usuario" ? "user" : "assistant",
                    content: m.mensaje
                })),
                { role: 'user', content: mensajeLimpio }
            ];

            const respuestaBot = await openaiService.generateResponse(mensajesParaOpenAI, {
                maxTokens: 300,
                temperature: 0.7
            });

            // 6. Enviar respuesta y guardar
            await MessageService.enviarMensajeYGuardar({
                to,
                userId,
                nombre,
                texto: respuestaBot,
                historial: historialActualizado,
                remitente: "sistema"
            });

            logInfo('procesarTextoSimple', 'Respuesta enviada exitosamente', { 
                userId, 
                responseLength: respuestaBot.length 
            });

            return res.json({ 
                success: true, 
                respuesta: respuestaBot,
                approach: "single-prompt"
            });

        } catch (openaiError) {
            logError('procesarTextoSimple', 'Error en OpenAI', { userId, error: openaiError });
            
            // Fallback simple
            const respuestaFallback = "🩺 Nuestras opciones de exámenes ocupacionales:\n• Virtual: $46.000\n• Presencial: $69.000\n\n¿Cuál te interesa más?";
            
            await MessageService.enviarMensajeYGuardar({
                to,
                userId,
                nombre,
                texto: respuestaFallback,
                historial: historialActualizado,
                remitente: "sistema"
            });

            return res.json({ 
                success: true, 
                respuesta: respuestaFallback,
                approach: "single-prompt-fallback"
            });
        }

    } catch (error) {
        const userId = extraerUserId(message.from);
        logError('procesarTextoSimple', 'Error general procesando texto', { 
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
            logError('procesarTextoSimple', 'Error enviando mensaje de error', { userId, error: sendError });
        }

        return res.status(500).json({ 
            success: false, 
            error: error.message,
            context: 'procesarTextoSimple'
        });
    }
}

module.exports = { procesarTextoSimple };