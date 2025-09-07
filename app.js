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


// Nuevo endpoint dedicado para imágenes
app.post('/webhook-imagenes', async (req, res) => {
    try {
        const body = req.body;
        if (!body || !body.messages || !Array.isArray(body.messages)) {
            return res.status(400).json({ success: false, error: "No hay mensajes en el payload." });
        }
        
        const message = body.messages[0];
        
        // Solo procesar si es una imagen
        if (message.type === "image") {
            const actor = identificarActor(message);
            
            // Solo procesar imágenes de usuarios
            if (actor === "usuario") {
                return await procesarImagen(message, res);
            }
        }
        
        return res.json({ success: true, mensaje: "No es una imagen o no es de usuario." });
    } catch (error) {
        logError('app.js', error, { endpoint: '/webhook-imagenes' });
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
                // Opción 1: Ignorar completamente (si tienes webhook dedicado en Whapi)
                return res.json({ success: true, mensaje: "Imagen será procesada por webhook dedicado." });
                
                // Opción 2: Procesar aquí también (descomentar si quieres procesar en ambos)
                // return await procesarImagen(message, res);
            }
            // Texto recibido
            if (message.type === "text") {
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
