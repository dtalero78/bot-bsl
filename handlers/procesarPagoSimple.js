const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnDB, obtenerConversacionDeDB } = require('../utils/dbAPI');
const { extraerUserId, logInfo, logError } = require('../utils/shared');
const { marcarPagado } = require('../utils/marcarPagado');
const { generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { sendPdf } = require('../utils/pdf');
const { esCedula } = require('../utils/validaciones');
const { config } = require('../config/environment');

/**
 * FLUJO SÚPER SIMPLE:
 * 1. Imagen -> Pedir documento
 * 2. Documento -> Marcar pagado + Enviar PDF
 */

// Estados simples
const ESTADO_INICIAL = 'inicial';
const ESTADO_ESPERANDO_DOCUMENTO = 'esperando_documento';

/**
 * Procesar imagen - CUALQUIER imagen
 */
async function procesarImagenSimple(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Usuario";
    const userId = extraerUserId(from);
    
    try {
        logInfo('procesarPagoSimple', 'Imagen recibida', { userId });
        
        // 1. Enviar mensaje pidiendo documento
        const mensaje = `📸 *Imagen recibida*\n\nPara procesar tu pago y generar el certificado, escribe tu *número de documento* (solo números, sin puntos).\n\nEjemplo: 1234567890`;
        
        await sendMessage(from, mensaje);
        
        // 2. Guardar estado
        const conversacion = await obtenerConversacionDeDB(userId);
        const historial = [
            ...conversacion.mensajes,
            {
                from: "usuario",
                mensaje: "📷 (imagen enviada)",
                timestamp: new Date().toISOString()
            },
            {
                from: "sistema", 
                mensaje: mensaje,
                timestamp: new Date().toISOString()
            }
        ];
        
        await guardarConversacionEnDB({
            userId,
            nombre,
            mensajes: historial,
            nivel: ESTADO_ESPERANDO_DOCUMENTO
        });
        
        logInfo('procesarPagoSimple', 'Imagen procesada - esperando documento', { userId });
        
        return res.json({ success: true, mensaje: "Imagen procesada" });
        
    } catch (error) {
        logError('procesarPagoSimple', 'Error procesando imagen', { userId, error });
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Procesar documento - Marcar pagado y enviar PDF
 */
async function procesarDocumentoSimple(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Usuario";
    const userId = extraerUserId(from);
    const documento = message.text.body.trim();
    
    try {
        logInfo('procesarPagoSimple', 'Procesando documento', { userId, documento });
        
        // 1. Validar que es una cédula
        if (!esCedula(documento)) {
            await sendMessage(from, `❌ Por favor escribe un número de documento válido (solo números).\n\nEjemplo: 1234567890`);
            return res.json({ success: true, mensaje: "Documento inválido" });
        }
        
        // 2. Enviar mensaje de procesamiento
        await sendMessage(from, `⏳ Procesando pago para documento ${documento}...`);
        
        // 3. Marcar como pagado
        const resultadoPago = await marcarPagado(documento);
        
        if (!resultadoPago.success) {
            await sendMessage(from, `❌ No encontré un registro con el documento ${documento}.\n\nVerifica que:\n• El número esté correcto\n• Ya hayas realizado tu examen médico`);
            return res.json({ success: false, mensaje: "Documento no encontrado" });
        }
        
        // 4. Generar y enviar PDF
        try {
            const pdfUrl = await generarPdfDesdeApi2Pdf(documento);
            
            if (pdfUrl) {
                await sendPdf(from, pdfUrl, documento);
                await sendMessage(from, `🎉 *¡Proceso completado exitosamente!*\n\n✅ Pago registrado\n📄 Certificado médico enviado\n✨ Sin marca de agua\n\n¡Gracias por tu pago!`);
            } else {
                await sendMessage(from, `✅ *Pago registrado exitosamente*\n\n⚠️ Hubo un problema generando el PDF. Un asesor te lo enviará pronto.`);
            }
        } catch (pdfError) {
            logError('procesarPagoSimple', 'Error generando PDF', { userId, documento, error: pdfError });
            await sendMessage(from, `✅ *Pago registrado*\n\n⚠️ Error generando certificado. Un asesor te contactará pronto.`);
        }
        
        // 5. Guardar conversación final
        const conversacion = await obtenerConversacionDeDB(userId);
        const historial = [
            ...conversacion.mensajes,
            {
                from: "usuario",
                mensaje: documento,
                timestamp: new Date().toISOString()
            },
            {
                from: "sistema",
                mensaje: "Pago procesado y certificado enviado",
                timestamp: new Date().toISOString()
            }
        ];
        
        await guardarConversacionEnDB({
            userId,
            nombre,
            mensajes: historial,
            nivel: ESTADO_INICIAL // Reset
        });
        
        logInfo('procesarPagoSimple', 'Proceso completado exitosamente', { userId, documento });
        
        return res.json({ success: true, mensaje: "Pago procesado" });
        
    } catch (error) {
        logError('procesarPagoSimple', 'Error procesando documento', { userId, documento, error });
        return res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    procesarImagenSimple,
    procesarDocumentoSimple,
    ESTADO_INICIAL,
    ESTADO_ESPERANDO_DOCUMENTO
};