#!/usr/bin/env node

/**
 * Bot Principal con flujo de pago ultra simple mejorado
 * - Procesa imágenes y valida que sean comprobantes de pago
 * - Solicita número de documento después de validar comprobante
 * - Genera certificado PDF cuando se completa el flujo
 * 
 * MEJORAS:
 * - Logging detallado para debugging
 * - Manejo robusto de errores
 * - Verificación de estado temporal
 * - Respuesta rápida al webhook
 */

const express = require('express');
const bodyParser = require('body-parser');
const { procesarImagen, procesarTexto } = require('./handlers/pagoUltraSimple');
const { logInfo, logError } = require('./utils/shared');
const { config } = require('./config/environment');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

const BOT_NUMBER = "573008021701";
const PORT = process.env.PORT || 3000;

// Webhook principal para procesamiento de pagos
app.post('/webhook-pago', async (req, res) => {
    try {
        const body = req.body;
        
        // Log completo de la solicitud
        logInfo('webhook-pago', 'Solicitud recibida', {
            timestamp: new Date().toISOString(),
            headers: req.headers,
            hasBody: !!body,
            hasMessages: body?.messages ? true : false,
            messageCount: body?.messages?.length || 0
        });
        
        // Validar estructura del payload
        if (!body || !body.messages || !Array.isArray(body.messages)) {
            logInfo('webhook-pago', 'Payload vacío o mal formado, ignorando');
            return res.json({ success: true });
        }
        
        // Procesar solo el primer mensaje
        const message = body.messages[0];
        
        // Log detallado del mensaje
        logInfo('webhook-pago', 'Procesando mensaje', {
            from: message.from,
            type: message.type,
            text: message.text?.body || 'N/A',
            hasImage: !!message.image,
            imageId: message.image?.id || 'N/A',
            fromName: message.from_name || 'N/A',
            timestamp: message.timestamp
        });
        
        // Ignorar mensajes del propio bot
        if (message.from === BOT_NUMBER) {
            logInfo('webhook-pago', 'Mensaje del bot ignorado');
            return res.json({ success: true });
        }
        
        // Procesar según el tipo de mensaje
        if (message.type === "image") {
            logInfo('webhook-pago', 'Delegando a procesarImagen');
            return await procesarImagen(message, res);
        }
        
        if (message.type === "text") {
            logInfo('webhook-pago', 'Delegando a procesarTexto');
            return await procesarTexto(message, res);
        }
        
        // Otros tipos de mensaje (audio, video, etc.)
        logInfo('webhook-pago', 'Tipo de mensaje no soportado', { type: message.type });
        return res.json({ success: true, mensaje: `Tipo ${message.type} no soportado` });
        
    } catch (error) {
        logError('webhook-pago', 'Error procesando webhook', { 
            error: error.message,
            stack: error.stack 
        });
        // Responder exitosamente para evitar reintentos de Whapi
        return res.json({ success: true, error: error.message });
    }
});

// Endpoint de salud
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Endpoint de información
app.get('/info', (req, res) => {
    res.json({
        name: 'Bot BSL - Flujo de Pago Simple',
        version: '1.0.0',
        webhook: '/webhook-pago',
        botNumber: BOT_NUMBER,
        features: [
            'Validación de comprobantes con IA',
            'Procesamiento de cédulas',
            'Generación de certificados PDF',
            'Estado temporal con expiración'
        ]
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║         BOT BSL - FLUJO DE PAGO           ║
╠════════════════════════════════════════════╣
║  Puerto: ${PORT}                              ║
║  Webhook: /webhook-pago                    ║
║  Bot Number: ${BOT_NUMBER}           ║
║  Ambiente: ${process.env.NODE_ENV || 'desarrollo'}               ║
╠════════════════════════════════════════════╣
║  Endpoints disponibles:                    ║
║  - POST /webhook-pago (webhook principal)  ║
║  - GET /health (estado del servicio)       ║
║  - GET /info (información del bot)         ║
╚════════════════════════════════════════════╝
    `);
    
    // Verificar configuración
    if (!config.apis.whapi.key) {
        console.warn('⚠️  WHAPI_KEY no configurado');
    }
    if (!config.apis.openai.key) {
        console.warn('⚠️  OPENAI_KEY no configurado');
    }
    
    console.log('✅ Bot iniciado y escuchando mensajes...\n');
});