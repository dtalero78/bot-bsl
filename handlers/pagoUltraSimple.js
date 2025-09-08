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
 * Procesar imagen - Solo pedir documento
 */
async function procesarImagen(message, res) {
    const from = message.from;
    const userId = extraerUserId(from);
    
    try {
        logInfo('pagoUltraSimple', 'Imagen recibida', { userId });
        
        // SIMPLE: Solo pedir documento
        const mensaje = `📸 *Imagen recibida*\n\nEscribe tu *número de documento* para procesar tu pago:\n\nEjemplo: 1234567890`;
        
        await sendMessage(from, mensaje);
        
        return res.json({ success: true });
        
    } catch (error) {
        logError('pagoUltraSimple', 'Error procesando imagen', { userId, error });
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