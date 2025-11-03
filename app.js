require('dotenv').config();

// Forzar deshabilitación de verificación SSL para todas las conexiones
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json({ limit: '10mb' }));

// Servir archivos estáticos para el dashboard
app.use(express.static('public'));

// Servir React frontend desde /dashboard
app.use('/dashboard', express.static('frontend/dist'));

// Middleware de logging, métricas y rate limiting
const requestLogger = require('./middleware/requestLogger');
const { requestMetricsMiddleware } = require('./middleware/performanceMetrics');
const { createRateLimiter } = require('./middleware/rateLimiter');

app.use(requestLogger);
app.use(requestMetricsMiddleware);

// Rate limiting global con configuraciones específicas por endpoint
const globalRateLimiter = createRateLimiter('normal', {
    endpointConfigs: {
        'POST /soporte': {
            windowMs: 1 * 60 * 1000, // 1 minuto para webhooks
            maxRequests: 60,
            skipFailedRequests: true
        },
        'POST /api/guardarMensaje': {
            windowMs: 5 * 60 * 1000, // 5 minutos
            maxRequests: 20
        },
        '/health': {
            windowMs: 1 * 60 * 1000, // 1 minuto para health checks
            maxRequests: 30
        },
        '/metrics': {
            windowMs: 1 * 60 * 1000,
            maxRequests: 20
        }
    },
    userTypeConfigs: {
        'authenticated': {
            maxRequests: 200 // Más requests para usuarios autenticados
        }
    }
});

app.use(globalRateLimiter.middleware());

const { manejarControlBot } = require('./handlers/controlBot');
const { procesarImagen } = require('./handlers/procesarImagen');
// Importar versión simplificada (solo un prompt)
const { procesarTextoMenu } = require('./handlers/procesarTextoMenu');
// const { procesarTextoSimple } = require('./handlers/procesarTextoSimple'); // Versión IA pura comentada
// const { procesarTexto } = require('./handlers/procesarTexto'); // Versión compleja comentada
const { guardarConversacionEnDB, obtenerConversacionDeDB } = require('./utils/dbAPI');
const { obtenerTextoMensaje, extraerUserId, limpiarDuplicados, logInfo, logError } = require('./utils/shared');
const { sendMessage } = require('./utils/sendMessage');
const logger = require('./utils/logger');
const { config } = require('./config/environment');
const HealthCheckService = require('./middleware/healthCheck');


const BOT_NUMBER = config.bot.number;

function identificarActor(message) {
    if (message.from !== BOT_NUMBER) return "usuario";
    // Aquí ambos bot y admin son from_me===true y from==BOT_NUMBER
    // Pero el bot tiene source: "api"
    // El admin tiene source: "web" o "mobile"
    if (message.from_me === true) {
        if (message.source === "api") return "sistema"; // Respuesta automática del bot
        if (message.source === "web" || message.source === "mobile") return "admin"; // Manual desde WhatsApp
    }
    return "usuario"; // fallback
}


// UN SOLO WEBHOOK PARA TODO - ULTRA SIMPLE
app.post('/webhook-pago', async (req, res) => {
    try {
        const body = req.body;
        
        // Log de TODOS los mensajes que llegan
        logInfo('webhook-pago', 'Mensaje recibido', { 
            body: JSON.stringify(body),
            hasMessages: body?.messages ? 'yes' : 'no',
            messageCount: body?.messages?.length || 0
        });
        
        if (!body || !body.messages || !Array.isArray(body.messages)) {
            // Simplemente ignorar requests vacíos o mal formados
            return res.json({ success: true });
        }
        
        const message = body.messages[0];
        
        // Log detallado del mensaje
        logInfo('webhook-pago', 'Procesando mensaje', {
            from: message.from,
            type: message.type,
            text: message.text?.body || 'N/A',
            hasImage: message.image ? 'yes' : 'no',
            hasDocument: message.document ? 'yes' : 'no',
            hasSticker: message.sticker ? 'yes' : 'no',
            mimeType: message.image?.mime_type || message.document?.mime_type || 'N/A'
        });
        
        // Identificar actor (usuario/admin/sistema)
        const actor = identificarActor(message);

        // Añadir emoji según el actor para identificación visual
        const actorEmoji = actor === "admin" ? "👨‍💼" : actor === "usuario" ? "👤" : "🤖";

        logInfo('webhook-pago', `${actorEmoji} Actor identificado`, {
            actor,
            from: message.from,
            from_me: message.from_me,
            source: message.source || 'N/A',
            BOT_NUMBER
        });

        // Si es del bot/sistema, ignorar
        if (message.from === BOT_NUMBER && actor === "sistema") {
            logInfo('webhook-pago', 'Mensaje del bot ignorado');
            return res.json({ success: true });
        }

        const { procesarImagen, procesarTexto, estadosPagoMemoria } = require('./handlers/pagoUltraSimple');

        // ⭐ LOG ESPECIAL: Ver TODOS los mensajes de texto antes de filtrar
        if (message.type === "text") {
            logInfo('webhook-pago', '📝 Mensaje de TEXTO detectado (cualquier actor)', {
                actor,
                texto: message.text?.body?.trim() || '',
                from: message.from,
                from_me: message.from_me,
                source: message.source,
                chat_id: message.chat_id
            });
        }

        // ⭐ COMANDO ADMIN: "...detener pago" - Cancela el flujo de pago
        if (actor === "admin" && message.type === "text") {
            const texto = message.text?.body?.trim() || '';

            if (texto.includes('...detener pago')) {
                // Para mensajes de admin, el userId está en chat_id (el usuario con quien habla)
                const userId = extraerUserId(message.chat_id || message.from);

                logInfo('webhook-pago', 'Comando admin "...detener pago" detectado', {
                    userId,
                    chatId: message.chat_id,
                    from: message.from
                });

                // Limpiar estado de memoria
                const tienEstado = estadosPagoMemoria.has(userId);
                if (tienEstado) {
                    estadosPagoMemoria.delete(userId);
                    logInfo('webhook-pago', 'Estado de pago eliminado por admin', { userId });
                } else {
                    logInfo('webhook-pago', 'No había estado de pago para eliminar', { userId });
                }

                return res.json({
                    success: true,
                    mensaje: "Flujo de pago cancelado por admin",
                    estadoEliminado: tienEstado
                });
            }

            // Otros mensajes de admin se ignoran
            return res.json({ success: true, mensaje: "Mensaje de admin ignorado" });
        }

        // Solo procesar mensajes de USUARIOS
        if (actor === "usuario") {
            // Ignorar silenciosamente documentos, stickers y otros tipos no soportados
            if (message.type === "document" || message.type === "sticker" || message.type === "audio" || message.type === "video") {
                logInfo('webhook-pago', 'Tipo de archivo no soportado - ignorado silenciosamente', {
                    type: message.type,
                    from: message.from
                });
                return res.json({ success: true, mensaje: "Tipo de archivo ignorado" });
            }

            // IMAGEN -> Validar con OpenAI y pedir documento
            if (message.type === "image") {
                return await procesarImagen(message, res);
            }

            // TEXTO -> Si es cédula, procesar pago inmediatamente
            if (message.type === "text") {
                return await procesarTexto(message, res);
            }
        }

        return res.json({ success: true });
        
    } catch (error) {
        logError('app.js', error, { endpoint: '/webhook-pago' });
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/soporte', async (req, res) => {
    try {
        const body = req.body;
        if (!body || !body.messages || !Array.isArray(body.messages)) {
            return res.status(400).json({ success: false, error: "No hay mensajes en el payload." });
        }
        const message = body.messages[0];
        const from = message.from;
        const chatId = message.chat_id;
        const texto = obtenerTextoMensaje(message);
        const nombre = message.from_name || "Administrador";
        const userId = extraerUserId(chatId || from);
        const resultControl = await manejarControlBot(message);
        if (resultControl?.detuvoBot) {
            return res.json(resultControl); // ⬅️ DETIENE AQUÍ si aplica stop
        }

        const actor = identificarActor(message);

        // SISTEMA (bot automático)
        if (actor === "sistema") {
            const { mensajes: historial = [] } = await obtenerConversacionDeDB(userId);
            const historialLimpio = limpiarDuplicados(historial);
            const ultimoSistema = [...historialLimpio].reverse().find(m => m.from === "sistema");
            if (ultimoSistema && ultimoSistema.mensaje === texto) {
                logInfo('app.js', 'Ignorando mensaje duplicado del bot', { texto, userId });
                return res.json({ success: true, mensaje: "Mensaje duplicado ignorado." });
            }
            const nuevoHistorial = limpiarDuplicados([
                ...historialLimpio,
                {
                    from: "sistema",
                    mensaje: texto,
                    timestamp: new Date().toISOString()
                }
            ]);
            await guardarConversacionEnDB({ userId, nombre, mensajes: nuevoHistorial });
            return res.json({ success: true, mensaje: "Mensaje del sistema guardado." });
        }

        // ADMIN (respuesta manual desde WhatsApp web/mobile)
        if (actor === "admin") {
            // Permitir texto y link_preview del admin
            if (message.type === "text" || message.type === "link_preview") {
                const { mensajes: historial = [] } = await obtenerConversacionDeDB(userId);
                const historialLimpio = limpiarDuplicados(historial);
                const ultimoAdmin = [...historialLimpio].reverse().find(m => m.from === "admin");
                if (ultimoAdmin && ultimoAdmin.mensaje === texto) {
                    logInfo('app.js', 'Ignorando mensaje duplicado del admin', { texto, userId });
                    return res.json({ success: true, mensaje: "Mensaje duplicado ignorado." });
                }
                const nuevoHistorial = limpiarDuplicados([
                    ...historialLimpio,
                    {
                        from: "admin",
                        mensaje: texto,
                        timestamp: new Date().toISOString(),
                        tipo: "manual"
                    }
                ]);
                await guardarConversacionEnDB({ userId, nombre, mensajes: nuevoHistorial });
                logInfo('app.js', 'Mensaje de admin guardado', { texto, userId });
                return res.json({ success: true, mensaje: "Mensaje de admin guardado." });
            }
            // Si no es texto ni link_preview, simplemente ignorar:
            return res.json({ success: true, mensaje: "Mensaje de admin no relevante (tipo no soportado)." });
        }


        // USUARIO (otro número)
        if (actor === "usuario") {
            // Imagen recibida - IGNORAR si se usa webhook dedicado
            if (message.type === "image") {
                return res.json({ success: true, mensaje: "Imagen será procesada por webhook dedicado." });
            }
            
            // Texto recibido - Verificar si está en flujo de pago simple
            if (message.type === "text") {
                const userId = extraerUserId(chatId || from);
                const { obtenerConversacionDeDB } = require('./utils/dbAPI');
                const conversacion = await obtenerConversacionDeDB(userId);
                
                // Si está esperando documento en flujo simple, usar handler simple
                if (conversacion.nivel === 'esperando_documento') {
                    const { procesarDocumentoSimple } = require('./handlers/procesarPagoSimple');
                    return await procesarDocumentoSimple(message, res);
                }
                
                // Sino, usar el flujo normal de menús
                return await procesarTextoMenu(message, res);
            }
        }

        return res.json({ success: true, mensaje: "Mensaje ignorado." });

    } catch (error) {
        logError('app.js', error, { endpoint: '/soporte' });
        return res.status(500).json({ success: false, error: error.message });
    }
});


// Root route - redirect to admin panel
app.get('/', (req, res) => {
    res.redirect('/admin-dashboard.html');
});

// Admin panel route
app.get('/admin', (req, res) => {
    res.redirect('/admin-dashboard.html');
});

// Health check endpoints
app.get('/health', HealthCheckService.basicHealthCheck);
app.get('/health/detailed', HealthCheckService.detailedHealthCheck);
app.get('/metrics', HealthCheckService.metricsEndpoint);

// Advanced metrics routes
const metricsRouter = require('./routes/metrics');
app.use('/api/metrics', metricsRouter);

// Admin routes
const adminRouter = require('./routes/admin');
app.use('/api/admin', adminRouter);

// Flow Editor routes
const flowEditorRouter = require('./routes/flowEditor');
app.use('/', flowEditorRouter);

// API endpoint para marcar como pagado
app.post('/api/marcarPagado', async (req, res) => {
    try {
        const { cedula, userId } = req.body;
        
        if (!cedula) {
            return res.status(400).json({ success: false, error: "Cédula es requerida" });
        }
        
        // Importar la función marcarPagado
        const { marcarPagado } = require('./utils/marcarPagado');
        
        // Marcar como pagado en la base de datos
        const resultado = await marcarPagado(cedula);
        
        if (resultado.success) {
            logInfo('api/marcarPagado', 'Paciente marcado como pagado', { cedula, userId });
            
            // Generar PDF si es necesario
            const { generarPDF } = require('./utils/pdf');
            const pdfUrl = await generarPDF(cedula);
            
            return res.json({ 
                success: true, 
                mensaje: "Pago registrado exitosamente",
                pdfUrl: pdfUrl 
            });
        } else {
            return res.status(400).json({ success: false, error: resultado.error });
        }
        
    } catch (error) {
        logError('api/marcarPagado', error, { body: req.body });
        return res.status(500).json({ success: false, error: error.message });
    }
});

// API endpoint para generar certificado
app.post('/api/generarCertificado', async (req, res) => {
    try {
        const { cedula, userId } = req.body;
        
        if (!cedula) {
            return res.status(400).json({ success: false, error: "Cédula es requerida" });
        }
        
        // Importar función para generar PDF
        const { generarPDF } = require('./utils/pdf');
        
        // Generar el PDF del certificado
        const pdfUrl = await generarPDF(cedula);
        
        if (pdfUrl) {
            logInfo('api/generarCertificado', 'Certificado generado', { cedula, userId, pdfUrl });
            return res.json({ 
                success: true, 
                pdfUrl: pdfUrl,
                mensaje: "Certificado generado exitosamente" 
            });
        } else {
            return res.status(400).json({ 
                success: false, 
                error: "No se pudo generar el certificado" 
            });
        }
        
    } catch (error) {
        logError('api/generarCertificado', error, { body: req.body });
        return res.status(500).json({ success: false, error: error.message });
    }
});

// API endpoint para verificar estado de usuario
app.get('/api/usuario/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { obtenerConversacionDeDB } = require('./utils/dbAPI');
        const conversacion = await obtenerConversacionDeDB(userId);
        
        const MessageService = require('./services/messageService');
        const estaBloqueado = MessageService.estaUsuarioBloqueado(conversacion.observaciones);
        
        return res.json({
            success: true,
            userId: userId,
            observaciones: conversacion.observaciones || "",
            bloqueado: estaBloqueado,
            nivel: conversacion.nivel || 0,
            ultimoMensaje: conversacion.mensajes && conversacion.mensajes.length > 0 
                ? conversacion.mensajes[conversacion.mensajes.length - 1] 
                : null
        });
        
    } catch (error) {
        logError('api/usuario', error, { userId: req.params.userId });
        return res.status(500).json({ success: false, error: error.message });
    }
});

// API endpoint para desbloquear usuario
app.post('/api/desbloquear/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { actualizarObservaciones } = require('./utils/dbAPI');
        
        // Limpiar observaciones de STOP
        await actualizarObservaciones(userId, "");
        
        logInfo('api/desbloquear', 'Usuario desbloqueado', { userId });
        
        return res.json({
            success: true,
            mensaje: `Usuario ${userId} desbloqueado exitosamente`
        });
        
    } catch (error) {
        logError('api/desbloquear', error, { userId: req.params.userId });
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/guardarMensaje', async (req, res) => {
    try {
        const { userId, nombre, mensaje, from = "sistema", timestamp } = req.body;
        if (!userId || !mensaje) {
            return res.status(400).json({ success: false, error: "userId y mensaje son obligatorios" });
        }
        // Obtén el historial actual
        const { mensajes: historial = [] } = await obtenerConversacionDeDB(userId);
        // Agrega el nuevo mensaje
        const nuevoHistorial = [
            ...historial,
            {
                from,
                mensaje,
                timestamp: timestamp || new Date().toISOString()
            }
        ];
        await guardarConversacionEnDB({ userId, nombre, mensajes: nuevoHistorial });
        return res.json({ success: true, mensaje: "Mensaje registrado correctamente." });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// React frontend routes
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/frontend/dist/index.html');
});

// Serve React main page from root (shadcn/ui version)
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/frontend/dist/index.html');
});

const PORT = config.server.port;
app.listen(PORT, () => {
    logger.info('app.js', `🚀 Servidor iniciado correctamente en puerto ${PORT}`, { 
        environment: config.server.environment,
        port: PORT,
        nodeVersion: process.version,
        pid: process.pid
    });
});
