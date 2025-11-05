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
 *
 * Estado en memoria (temporal) - se pierde al reiniciar servidor
 */
const estadosPagoMemoria = new Map(); // userId -> { validado: boolean, timestamp: number }

/**
 * Descargar imagen con reintentos
 */
async function descargarImagenConReintentos(urlImg, maxReintentos = 3) {
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

    for (let intento = 1; intento <= maxReintentos; intento++) {
        try {
            logInfo('pagoUltraSimple', `Intento ${intento} de descarga`, { urlImg });

            const whapiRes = await fetch(urlImg, {
                method: 'GET',
                headers: { "Authorization": `Bearer ${config.apis.whapi.key}` },
                timeout: 30000
            });

            if (!whapiRes.ok) {
                const errorBody = await whapiRes.text();
                throw new Error(`HTTP ${whapiRes.status}: ${errorBody}`);
            }

            const arrayBuffer = await whapiRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            logInfo('pagoUltraSimple', 'Imagen descargada exitosamente', {
                tamaño: buffer.length,
                intento
            });

            return buffer;

        } catch (error) {
            logError('pagoUltraSimple', `Error en intento ${intento}`, {
                error: error.message,
                urlImg
            });

            if (intento === maxReintentos) {
                throw error; // Si es el último intento, lanzar el error
            }

            // Esperar antes de reintentar (backoff exponencial)
            await new Promise(resolve => setTimeout(resolve, 1000 * intento));
        }
    }
}

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

        logInfo('pagoUltraSimple', 'Intentando descargar imagen', {
            userId,
            imageId,
            mimeType,
            urlImg,
            hasImageObject: !!message.image,
            messageType: message.type
        });

        // Descargar con reintentos automáticos
        const buffer = await descargarImagenConReintentos(urlImg);
        const base64Image = buffer.toString('base64');
        
        // 2. VALIDAR CON OPENAI QUE SEA COMPROBANTE DE PAGO
        const { getOpenAIService } = require('../services/openaiService');
        const openaiService = getOpenAIService();
        
        const clasificacion = await openaiService.clasificarImagen(base64Image, mimeType);
        
        if (clasificacion !== "comprobante_pago") {
            const mensaje = `...transfiriendo con asesor`;
            await sendMessage(from, mensaje);
            return res.json({ success: true, mensaje: "Imagen rechazada" });
        }
        
        // 3. Si SÍ es comprobante válido, guardar estado en memoria
        estadosPagoMemoria.set(userId, {
            validado: true,
            timestamp: Date.now()
        });

        logInfo('pagoUltraSimple', 'Estado guardado en memoria', { userId });

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
        
        // Verificar si hay un comprobante validado en memoria
        const estadoMemoria = estadosPagoMemoria.get(userId);

        // Limpiar estados expirados (más de 30 minutos)
        if (estadoMemoria && (Date.now() - estadoMemoria.timestamp) > 30 * 60 * 1000) {
            estadosPagoMemoria.delete(userId);
            logInfo('pagoUltraSimple', 'Estado expirado y eliminado', { userId });
        }

        const estadoActual = estadosPagoMemoria.get(userId);

        logInfo('pagoUltraSimple', 'Estado verificado en memoria', {
            userId,
            tieneEstado: !!estadoActual,
            validado: estadoActual?.validado || false
        });

        // Si NO hay comprobante previo, ignorar CUALQUIER texto (incluyendo cédulas)
        if (!estadoActual || !estadoActual.validado) {
            logInfo('pagoUltraSimple', 'Ignorando texto - sin comprobante previo o expirado', {
                userId,
                texto
            });
            return res.json({ success: true, mensaje: "Texto ignorado - esperando imagen primero" });
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
            
            // Limpiar estado de memoria después de procesar exitosamente
            estadosPagoMemoria.delete(userId);
            logInfo('pagoUltraSimple', 'Estado limpiado de memoria', { userId });
            
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
        await sendMessage(from, `✅ Ya recibí tu comprobante.\n\n📝 ¿Cual es tu cédula? *ESCRIBE SOLO números*`);
        return res.json({ success: true, mensaje: "Recordatorio enviado - esperando cédula" });
        
    } catch (error) {
        logError('pagoUltraSimple', 'Error procesando texto', { userId, error });
        return res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    procesarImagen,
    procesarTexto,
    estadosPagoMemoria  // Exportar para permitir limpieza desde app.js
};