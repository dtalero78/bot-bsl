const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnDB, obtenerConversacionDeDB } = require('../utils/dbAPI');
const { limpiarDuplicados, extraerUserId, formatearParaWhatsApp, logInfo, logError } = require('../utils/shared');
const { getOpenAIService } = require('../services/openaiService');
const MessageService = require('../services/messageService');
const { getQueueService } = require('../services/queueService');
const { config } = require('../config/environment');
const logger = require('../utils/logger');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function procesarImagen(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Usuario";
    const chatId = message.chat_id;
    const to = from;
    const userId = extraerUserId(from);

    logInfo('procesarImagen', 'Procesando imagen', { 
        userId, 
        nombre,
        mimeType: message.image?.mime_type 
    });

    // Ignorar imágenes del bot/admin
    if (message.from_me === true || message.from === config.bot.number) {
        logInfo('procesarImagen', 'Imagen ignorada - enviada por admin/bot', { userId });
        return res.json({ success: true, mensaje: "Imagen del admin ignorada." });
    }

    // Verificar si el usuario está bloqueado
    const { mensajes: historial = [], observaciones = "" } = await obtenerConversacionDeDB(userId);
    if (MessageService.estaUsuarioBloqueado(observaciones)) {
        logInfo('procesarImagen', 'Usuario bloqueado por observaciones STOP', { userId });
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones." });
    }

    try {
        const imageId = message.image?.id;
        const mimeType = message.image?.mime_type || "image/jpeg";
        const urlImg = `https://gate.whapi.cloud/media/${imageId}`;

        // 1. Registrar que el usuario envió una imagen
        const historialConImagen = await MessageService.agregarMensajeUsuario(
            userId, 
            "📷 (imagen enviada)", 
            nombre, 
            historial
        );

        // 2. Enviar mensaje de procesamiento inmediato
        await MessageService.enviarMensajeYGuardar({
            to,
            userId,
            nombre,
            texto: "🔍 He recibido tu imagen. La estoy procesando, te respondo en un momento...",
            historial: historialConImagen,
            remitente: "sistema"
        });

        // 3. Descargar imagen de forma asíncrona
        const downloadImageAsync = async () => {
            // Esperar disponibilidad de imagen
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const whapiRes = await fetch(urlImg, {
                method: 'GET',
                headers: { "Authorization": `Bearer ${config.apis.whapi.key}` }
            });

            if (!whapiRes.ok) {
                throw new Error(`Error descargando imagen: ${whapiRes.status} ${whapiRes.statusText}`);
            }

            const arrayBuffer = await whapiRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            return buffer.toString('base64');
        };

        // 4. Encolar procesamiento asíncrono de imagen
        const queueService = getQueueService();
        const openaiService = getOpenAIService();
        
        try {
            const base64Image = await downloadImageAsync();
            
            const taskId = await queueService.enqueueImageProcessing({
                base64Image,
                mimeType,
                to,
                userId,
                nombre,
                historial: historialConImagen,
                openaiService
            });
            
            logInfo('procesarImagen', 'Imagen encolada para procesamiento asíncrono', { 
                userId, 
                taskId,
                imageId 
            });

            // 5. Responder inmediatamente al webhook
            return res.json({ 
                success: true, 
                mensaje: "Imagen recibida y en procesamiento",
                taskId,
                async: true
            });

        } catch (downloadError) {
            logError('procesarImagen', 'Error descargando imagen para procesamiento', { 
                userId, 
                imageId, 
                error: downloadError 
            });
            
            // Enviar mensaje de error al usuario
            await MessageService.enviarMensajeYGuardar({
                to,
                userId,
                nombre,
                texto: "❌ No pude descargar tu imagen. Por favor intenta enviándola de nuevo.",
                historial: historialConImagen,
                remitente: "sistema"
            });
            
            return res.status(500).json({ 
                success: false, 
                error: "Error descargando imagen",
                details: downloadError.message
            });
        }

    } catch (error) {
        logError('procesarImagen', error, { userId });
        
        // Intentar enviar mensaje de error al usuario
        try {
            await MessageService.enviarMensajeSimple(to, 
                "❌ Hubo un problema procesando tu imagen. Por favor intenta de nuevo o contacta con soporte."
            );
        } catch (sendError) {
            logError('procesarImagen', 'Error enviando mensaje de error', { userId, error: sendError });
        }
        
        return res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = { procesarImagen };