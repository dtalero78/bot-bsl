const { sendMessage } = require('../utils/sendMessage');
const { marcarPagado } = require('../utils/marcarPagado');
const { generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { sendPdf } = require('../utils/pdf');
const { esCedula } = require('../utils/validaciones');
const { extraerUserId, logInfo, logError } = require('../utils/shared');
const { config } = require('../config/environment');

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
            const mensaje = `❌ La imagen no es un comprobante de pago válido.\n\nPor favor envía:\n• Comprobante bancario\n• Transferencia\n• Recibo de pago`;
            await sendMessage(from, mensaje);
            return res.json({ success: true, mensaje: "Imagen rechazada" });
        }
        
        // 3. Si SÍ es comprobante válido, pedir documento
        const mensaje = `✅ *Comprobante de pago válido*\n\nEscribe tu *número de documento* para completar:\n\nEjemplo: 1234567890`;
        
        await sendMessage(from, mensaje);
        
        return res.json({ success: true });
        
    } catch (error) {
        logError('pagoUltraSimple', 'Error procesando imagen', { userId, error });
        await sendMessage(from, `❌ No pude procesar la imagen. Intenta con una foto más clara.`);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Procesar texto - Si es cédula, procesar pago
 */
async function procesarTexto(message, res) {
    const from = message.from;
    const texto = message.text.body.trim();
    const userId = extraerUserId(from);
    
    try {
        logInfo('pagoUltraSimple', 'Texto recibido', { userId, texto });
        
        // Si es una cédula, procesar pago inmediatamente
        if (esCedula(texto)) {
            logInfo('pagoUltraSimple', 'Procesando cédula como pago', { userId, cedula: texto });
            
            await sendMessage(from, `⏳ Procesando pago para documento ${texto}...`);
            
            // Marcar como pagado
            const resultadoPago = await marcarPagado(texto);
            
            if (!resultadoPago.success) {
                await sendMessage(from, `❌ No encontré un registro con el documento ${texto}.\n\nVerifica que el número esté correcto y que hayas realizado tu examen médico.`);
                return res.json({ success: false });
            }
            
            // Generar y enviar PDF
            try {
                const pdfUrl = await generarPdfDesdeApi2Pdf(texto);
                
                if (pdfUrl) {
                    await sendPdf(from, pdfUrl, texto);
                    await sendMessage(from, `🎉 *¡Proceso completado!*\n\n✅ Pago registrado\n📄 Certificado enviado\n✨ Sin marca de agua`);
                } else {
                    await sendMessage(from, `✅ Pago registrado\n\n⚠️ Error generando PDF. Un asesor te lo enviará.`);
                }
            } catch (pdfError) {
                logError('pagoUltraSimple', 'Error generando PDF', { userId, cedula: texto, error: pdfError });
                await sendMessage(from, `✅ Pago registrado\n\n⚠️ Error con certificado. Un asesor te contactará.`);
            }
            
            return res.json({ success: true });
        }
        
        // Si no es cédula, ignorar
        return res.json({ success: true, mensaje: "Texto ignorado - no es cédula" });
        
    } catch (error) {
        logError('pagoUltraSimple', 'Error procesando texto', { userId, error });
        return res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    procesarImagen,
    procesarTexto
};