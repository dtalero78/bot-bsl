const { sendMessage } = require('../utils/sendMessage');
const { marcarPagado } = require('../utils/marcarPagado');
const { generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { sendPdf } = require('../utils/pdf');
const { esCedula } = require('../utils/validaciones');
const { extraerUserId, logInfo, logError } = require('../utils/shared');
const { config } = require('../config/environment');
const { 
    guardarEstadoPagoTemporal, 
    verificarEstadoPagoTemporal, 
    limpiarEstadoPagoTemporal 
} = require('../utils/dbAPI');

/**
 * SÚPER ULTRA SIMPLE:
 * - Imagen -> Pedir documento 
 * - Texto que sea cédula -> Procesar pago
 * SIN NIVELES, SIN BD, SIN COMPLICACIONES
 */

/**
 * Procesar imagen - VALIDAR con OpenAI que sea comprobante
 */
async function procesarImagen(message, res) {
    const from = message.from;
    const userId = extraerUserId(from);
    
    try {
        logInfo('pagoUltraSimple', 'Imagen recibida', { userId });
        
        // 1. Descargar imagen
        const imageId = message.image?.id;
        const mimeType = message.image?.mime_type || "image/jpeg";
        const urlImg = `https://gate.whapi.cloud/media/${imageId}`;
        
        const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
        
        const whapiRes = await fetch(urlImg, {
            method: 'GET',
            headers: { "Authorization": `Bearer ${config.apis.whapi.key}` }
        });

        if (!whapiRes.ok) {
            throw new Error(`Error descargando imagen: ${whapiRes.status}`);
        }

        const arrayBuffer = await whapiRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString('base64');
        
        // 2. VALIDAR CON OPENAI QUE SEA COMPROBANTE DE PAGO
        const { getOpenAIService } = require('../services/openaiService');
        const openaiService = getOpenAIService();
        
        const clasificacion = await openaiService.clasificarImagen(base64Image, mimeType);
        
        if (clasificacion !== "comprobante_pago") {
            logInfo('pagoUltraSimple', 'Imagen no es comprobante - reenviando a flujo principal', {
                userId,
                clasificacion
            });
            
            // Reenviar imagen al procesamiento principal del bot
            const { procesarImagen: procesarImagenBot } = require('./procesarImagen');
            return await procesarImagenBot(message, res);
        }
        
        // 3. Si SÍ es comprobante válido, guardar estado temporal
        await guardarEstadoPagoTemporal(userId);
        
        // 4. Pedir documento
        const mensaje = `✅ Escribe tu número de documento *solo los números*`;
        
        await sendMessage(from, mensaje);
        
        return res.json({ success: true });
        
    } catch (error) {
        logError('pagoUltraSimple', 'Error procesando imagen', { userId, error });
        await sendMessage(from, `❌ No pude procesar la imagen. Intenta con una foto más clara.`);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Procesar texto - Si es cédula, procesar pago SOLO si ya se envió imagen
 */
async function procesarTexto(message, res) {
    const from = message.from;
    const texto = message.text?.body?.trim() || '';
    const userId = extraerUserId(from);
    
    try {
        logInfo('pagoUltraSimple', 'Texto recibido', { 
            userId, 
            texto,
            messageType: message.type,
            hasTextBody: message.text?.body ? 'yes' : 'no'
        });
        
        // Primero verificar si hay un comprobante validado previamente
        const estadoTemporal = await verificarEstadoPagoTemporal(userId);
        
        logInfo('pagoUltraSimple', 'Estado temporal verificado', {
            userId,
            estadoValidado: estadoTemporal?.validado || false,
            estadoCompleto: JSON.stringify(estadoTemporal)
        });
        
        // Si NO hay comprobante previo, reenviar al flujo principal
        if (!estadoTemporal || !estadoTemporal.validado) {
            logInfo('pagoUltraSimple', 'Sin comprobante - reenviando a flujo principal', { 
                userId,
                estadoTemporal: JSON.stringify(estadoTemporal),
                texto
            });
            
            // Reenviar al procesamiento principal del bot
            return await reenviarAFlujoPrincipal(message, res);
        }
        
        // Solo procesar si es una cédula Y ya hay comprobante validado
        if (esCedula(texto)) {
            logInfo('pagoUltraSimple', 'Cédula detectada con comprobante previo', { userId, cedula: texto });
            
            logInfo('pagoUltraSimple', 'Comprobante validado, procesando pago', { userId, cedula: texto });
            
            await sendMessage(from, `⏳ Procesando pago para documento ${texto}...`);
            
            // Marcar como pagado
            const resultadoPago = await marcarPagado(texto);
            
            if (!resultadoPago.success) {
                await sendMessage(from, `❌ No encontré un registro con el documento ${texto}.\n\nVerifica que el número esté correcto y que hayas realizado tu examen médico.`);
                // Mantener el estado temporal para que pueda reintentar con otro documento
                return res.json({ success: false });
            }
            
            // Limpiar estado temporal después de procesar exitosamente
            await limpiarEstadoPagoTemporal(userId);
            
            // Generar y enviar PDF
            try {
                const pdfUrl = await generarPdfDesdeApi2Pdf(texto);
                
                if (pdfUrl) {
                    await sendPdf(from, pdfUrl, texto);
                    await sendMessage(from, `🎉 *¡Proceso completado!*`);
                } else {
                    await sendMessage(from, `✅ Pago registrado\n\n⚠️ Error generando PDF. Un asesor te lo enviará.`);
                }
            } catch (pdfError) {
                logError('pagoUltraSimple', 'Error generando PDF', { userId, cedula: texto, error: pdfError });
                await sendMessage(from, `✅ Pago registrado\n\n⚠️ Error con certificado. Un asesor te contactará.`);
            }
            
            return res.json({ success: true });
        }
        
        // Si no es cédula pero hay comprobante validado, recordar que debe enviar la cédula
        await sendMessage(from, `✅ Ya recibí tu comprobante.\n\n📝 Por favor, escribe tu número de documento *solo los números*`);
        return res.json({ success: true, mensaje: "Recordatorio enviado - esperando cédula" });
        
    } catch (error) {
        logError('pagoUltraSimple', 'Error procesando texto', { userId, error });
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Reenviar mensaje al flujo principal del bot cuando no hay comprobante
 */
async function reenviarAFlujoPrincipal(message, res) {
    try {
        logInfo('pagoUltraSimple', 'Reenviando a procesamiento principal');
        
        // Importar y usar el procesador de texto principal del bot
        const { procesarTexto: procesarTextoBot } = require('./procesarTexto');
        return await procesarTextoBot(message, res);
        
    } catch (error) {
        logError('pagoUltraSimple', 'Error reenviando a flujo principal', { error });
        
        // Si falla el reenvío, al menos responder que no se puede procesar
        const { sendMessage } = require('../utils/sendMessage');
        await sendMessage(message.from, 'Lo siento, no pude procesar tu mensaje. Intenta de nuevo.');
        
        return res.json({ success: false, error: 'Error reenviando mensaje' });
    }
}

module.exports = {
    procesarImagen,
    procesarTexto,
    reenviarAFlujoPrincipal
};