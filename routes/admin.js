const express = require('express');
const router = express.Router();
const { pool, obtenerConversacionDeDB, guardarConversacionEnDB, actualizarObservaciones } = require('../utils/dbAPI');
const { getCacheService } = require('../services/cacheService');
const { getQueueService } = require('../services/queueService');
const logger = require('../utils/logger');
const { extraerUserId } = require('../utils/shared');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/**
 * Middleware de autenticación básica para administración
 * TODO: Implementar autenticación real con JWT o similar
 */
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.ADMIN_TOKEN || 'admin-secret-token';
    
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized. Provide valid admin token.'
        });
    }
    
    next();
}

// Aplicar autenticación a todas las rutas de admin
router.use(requireAuth);

/**
 * Database inspection - para verificar qué hay en la DB
 */
router.get('/database/inspect', async (req, res) => {
    try {
        const inspection = {
            timestamp: new Date().toISOString(),
            tables: {},
            info: 'Database inspection results'
        };
        
        // Verificar qué tablas existen
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `);
        
        inspection.availableTables = tablesResult.rows.map(row => row.table_name);
        
        // Si existe la tabla conversaciones, obtener algunos datos
        if (tablesResult.rows.some(row => row.table_name === 'conversaciones')) {
            const convCount = await pool.query('SELECT COUNT(*) as count FROM conversaciones');
            const sampleConv = await pool.query('SELECT user_id, nombre, fase, created_at FROM conversaciones LIMIT 5');
            
            inspection.tables.conversaciones = {
                count: convCount.rows[0].count,
                samples: sampleConv.rows
            };
        }
        
        // Si existe la tabla pacientes
        if (tablesResult.rows.some(row => row.table_name === 'pacientes')) {
            const pacCount = await pool.query('SELECT COUNT(*) as count FROM pacientes');
            const samplePac = await pool.query('SELECT cedula, nombre, telefono, pagado, created_at FROM pacientes LIMIT 5');
            
            inspection.tables.pacientes = {
                count: pacCount.rows[0].count,
                samples: samplePac.rows
            };
        }
        
        res.json({ success: true, inspection });
        
    } catch (error) {
        logger.error('AdminRoute', 'Database inspection failed', { error: error.message });
        res.json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Endpoint alternativo de conversaciones sin SSL issues
 */
router.get('/conversations-simple', async (req, res) => {
    try {
        logger.info('AdminRoute', 'Simple conversations request');
        
        res.json({
            success: true,
            conversations: [],
            pagination: {
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 10,
                total: 0,
                pages: 0
            },
            message: 'Conversaciones temporalmente no disponibles debido a problemas SSL con la base de datos'
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error in simple conversations', { error: error.message });
        res.json({
            success: false,
            error: 'Error temporal'
        });
    }
});

/**
 * Verificar configuración de variables de entorno
 */
router.get('/env/check', async (req, res) => {
    res.json({
        success: true,
        environment: {
            NODE_ENV: process.env.NODE_ENV,
            PORT: process.env.PORT,
            DB_HOST: process.env.DB_HOST ? '***configured***' : 'missing',
            DB_PORT: process.env.DB_PORT,
            DB_USER: process.env.DB_USER ? '***configured***' : 'missing',
            DB_PASSWORD: process.env.DB_PASSWORD ? '***configured***' : 'missing',
            DB_NAME: process.env.DB_NAME ? '***configured***' : 'missing',
            OPENAI_KEY: process.env.OPENAI_KEY ? '***configured***' : 'missing',
            WHAPI_KEY: process.env.WHAPI_KEY ? '***configured***' : 'missing'
        },
        timestamp: new Date().toISOString()
    });
});

/**
 * Cargar números masivamente para marcar como stopBot
 */
router.post('/bulk/stopbot', async (req, res) => {
    try {
        const { numbers, reason } = req.body;
        
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Debe proporcionar un array de números'
            });
        }
        
        const results = {
            processed: 0,
            created: 0,
            updated: 0,
            errors: []
        };
        
        for (const number of numbers) {
            try {
                const cleanNumber = number.toString().trim();
                if (!cleanNumber) continue;
                
                // Intentar actualizar si existe
                const updateResult = await pool.query(`
                    UPDATE conversaciones 
                    SET observaciones = $1, updated_at = CURRENT_TIMESTAMP 
                    WHERE user_id = $2
                `, ['stop', cleanNumber]);  // Solo 'stop' para consistencia
                
                if (updateResult.rowCount > 0) {
                    results.updated++;
                } else {
                    // Crear nuevo registro si no existe
                    await pool.query(`
                        INSERT INTO conversaciones (user_id, nombre, mensajes, observaciones, fase, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (user_id) 
                        DO UPDATE SET 
                            observaciones = EXCLUDED.observaciones,
                            updated_at = CURRENT_TIMESTAMP
                    `, [
                        cleanNumber,
                        'Usuario bloqueado',
                        JSON.stringify([]),
                        'stop',  // Solo 'stop' para que coincida con las búsquedas
                        'inicial'
                    ]);
                    results.created++;
                }
                
                results.processed++;
                
            } catch (error) {
                results.errors.push({ number, error: error.message });
            }
        }
        
        logger.info('AdminRoute', `Bulk stopBot upload completed`, {
            processed: results.processed,
            created: results.created,
            updated: results.updated,
            errors: results.errors.length
        });
        
        res.json({ 
            success: true, 
            results,
            message: `Procesados: ${results.processed}, Creados: ${results.created}, Actualizados: ${results.updated}` 
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error in bulk stopBot upload', { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: 'Error procesando la carga masiva' 
        });
    }
});

/**
 * Ultra simple database test - solo verificar conexión
 */
router.get('/db/ping', async (req, res) => {
    try {
        // Timeout muy corto para test rápido
        const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 1000)
        );
        
        const pingQuery = pool.query('SELECT 1 as ping');
        
        const result = await Promise.race([pingQuery, timeout]);
        
        res.json({ 
            success: true, 
            message: 'Database connection working',
            ping: result.rows[0].ping,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message,
            message: 'Database connection failed',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Dashboard simple test - para verificar conectividad
 */
router.get('/dashboard/test', async (req, res) => {
    res.json({ 
        success: true, 
        message: 'Dashboard test endpoint working',
        timestamp: new Date().toISOString()
    });
});

/**
 * Dashboard - Estadísticas generales del bot
 */
router.get('/dashboard', async (req, res) => {
    try {
        // Respuesta inmediata con datos básicos mientras la DB está lenta
        logger.info('AdminRoute', 'Dashboard request received');
        
        // Por ahora retornar datos mock para evitar timeout
        // TODO: Optimizar queries cuando la DB responda mejor
        const dashboard = {
            conversaciones: {
                total: 0,
                activas24h: 0,
                bloqueadas: 0
            },
            fases: [],
            timestamp: new Date().toISOString(),
            status: 'simplified',
            message: 'Using simplified dashboard due to database performance'
        };
        
        // Intentar queries simples con timeout corto
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve(null), 2000);
        });
        
        // Query para total y bloqueadas
        const queries = pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN observaciones = 'stop' THEN 1 END) as bloqueadas,
                COUNT(CASE WHEN updated_at > NOW() - INTERVAL '24 hours' THEN 1 END) as activas24h
            FROM conversaciones
        `);
        
        const result = await Promise.race([queries, timeoutPromise]).catch(err => {
            logger.error('AdminRoute', 'Simple query failed', { error: err.message });
            return null;
        });
        
        if (result && result.rows && result.rows[0]) {
            dashboard.conversaciones.total = parseInt(result.rows[0].total) || 0;
            dashboard.conversaciones.bloqueadas = parseInt(result.rows[0].bloqueadas) || 0;
            dashboard.conversaciones.activas24h = parseInt(result.rows[0].activas24h) || 0;
            dashboard.status = 'complete';
        }
        
        res.json({ success: true, dashboard });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error getting dashboard', { error: error.message });
        // Siempre retornar algo para evitar 504
        res.json({ 
            success: true, 
            dashboard: {
                conversaciones: { total: 0, activas24h: 0, bloqueadas: 0 },
                fases: [],
                timestamp: new Date().toISOString(),
                status: 'error',
                message: 'Database unavailable'
            }
        });
    }
});

/**
 * Listar conversaciones con filtros y paginación (version simplificada para evitar SSL)
 */
router.get('/conversations', async (req, res) => {
    try {
        logger.info('AdminRoute', 'Conversations request received');
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        
        // Obtener total de conversaciones
        const totalCount = await pool.query('SELECT COUNT(*) as total FROM conversaciones');
        
        // Obtener conversaciones con paginación
        const conversations = await pool.query(`
            SELECT 
                user_id, 
                nombre, 
                fase, 
                observaciones,
                updated_at,
                created_at,
                jsonb_array_length(mensajes) as message_count
            FROM conversaciones 
            ORDER BY updated_at DESC 
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        res.json({
            success: true,
            conversations: conversations.rows,
            pagination: {
                page,
                limit,
                total: parseInt(totalCount.rows[0].total),
                totalPages: Math.ceil(totalCount.rows[0].total / limit)
            }
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error listing conversations', { error });
        res.status(500).json({ success: false, error: 'Error retrieving conversations' });
    }
});

/**
 * Ver conversación específica con historial completo
 */
router.get('/conversations/:userId', async (req, res) => {
    try {
        const userId = extraerUserId(req.params.userId);
        const conversation = await obtenerConversacionDeDB(userId);
        
        if (!conversation || conversation.mensajes.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Conversation not found'
            });
        }
        
        res.json({
            success: true,
            conversation: {
                userId,
                ...conversation
            }
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error getting conversation', { error, userId: req.params.userId });
        res.status(500).json({ success: false, error: 'Error retrieving conversation' });
    }
});

/**
 * Corregir observaciones de usuarios bloqueados (migración)
 */
router.post('/fix-blocked-users', async (req, res) => {
    try {
        logger.info('AdminRoute', 'Starting fix for blocked users observations');
        
        // Actualizar todos los registros que tienen 'stop' en observaciones pero no exactamente 'stop'
        const result = await pool.query(`
            UPDATE conversaciones 
            SET observaciones = 'stop',
                updated_at = CURRENT_TIMESTAMP
            WHERE observaciones LIKE 'stop%' 
            AND observaciones != 'stop'
            RETURNING user_id
        `);
        
        const fixedCount = result.rowCount;
        
        logger.info('AdminRoute', `Fixed ${fixedCount} blocked users`);
        
        // También obtener el total de usuarios bloqueados después del fix
        const totalResult = await pool.query(`
            SELECT COUNT(*) as total 
            FROM conversaciones 
            WHERE observaciones = 'stop'
        `);
        
        res.json({
            success: true,
            message: `Corregidos ${fixedCount} usuarios bloqueados`,
            fixed: fixedCount,
            totalBlocked: parseInt(totalResult.rows[0].total),
            fixedUsers: result.rows.map(r => r.user_id)
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error fixing blocked users', { error });
        res.status(500).json({ 
            success: false, 
            error: 'Error corrigiendo usuarios bloqueados' 
        });
    }
});

/**
 * Test WhatsApp message sending
 */
router.post('/test-whatsapp', async (req, res) => {
    try {
        const { to, message } = req.body;
        
        if (!to || !message) {
            return res.status(400).json({ 
                success: false, 
                error: 'Número (to) y mensaje son requeridos' 
            });
        }
        
        // Intentar enviar mensaje por WhatsApp
        const url = "https://gate.whapi.cloud/messages/text";
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WHAPI_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                to: to.includes('@') ? to : `${to}@s.whatsapp.net`,
                body: message 
            })
        });
        
        const result = await response.json();
        
        logger.info('AdminRoute', 'WhatsApp test message', { to, status: response.status });
        
        res.json({
            success: response.ok,
            status: response.status,
            result: result,
            message: response.ok ? 'Mensaje enviado' : 'Error al enviar',
            whapi_configured: !!process.env.WHAPI_KEY
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error testing WhatsApp', { error });
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Test OpenAI API key
 */
router.post('/test-openai', async (req, res) => {
    try {
        const { prompt = "Di 'Hola, funciono correctamente'" } = req.body;
        
        // Probar la API de OpenAI
        const openaiUrl = "https://api.openai.com/v1/chat/completions";
        const response = await fetch(openaiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: "Eres un asistente de prueba" },
                    { role: "user", content: prompt }
                ],
                max_tokens: 100,
                temperature: 0.7
            })
        });
        
        const result = await response.json();
        
        logger.info('AdminRoute', 'OpenAI test', { status: response.status });
        
        if (response.ok) {
            res.json({
                success: true,
                status: response.status,
                message: 'OpenAI funciona correctamente',
                response: result.choices?.[0]?.message?.content || 'Sin respuesta',
                model: result.model,
                usage: result.usage,
                openai_configured: !!process.env.OPENAI_KEY
            });
        } else {
            res.json({
                success: false,
                status: response.status,
                error: result.error || result,
                message: 'Error con OpenAI API',
                openai_configured: !!process.env.OPENAI_KEY,
                possible_issues: [
                    'API key inválida o expirada',
                    'Límite de cuota excedido',
                    'Modelo no disponible',
                    'Error en la configuración'
                ]
            });
        }
        
    } catch (error) {
        logger.error('AdminRoute', 'Error testing OpenAI', { error });
        res.status(500).json({ 
            success: false, 
            error: error.message,
            openai_configured: !!process.env.OPENAI_KEY
        });
    }
});

/**
 * Obtener todos los usuarios bloqueados
 */
router.get('/blocked-users', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        
        const result = await pool.query(`
            SELECT user_id, nombre, observaciones, updated_at, created_at
            FROM conversaciones
            WHERE observaciones = 'stop'
            ORDER BY updated_at DESC
            LIMIT $1
        `, [limit]);
        
        res.json({
            success: true,
            users: result.rows,
            total: result.rows.length
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error getting blocked users', { error });
        res.status(500).json({ success: false, error: 'Error retrieving blocked users' });
    }
});

/**
 * Buscar usuarios bloqueados por número o nombre
 */
router.get('/blocked-users/search', async (req, res) => {
    try {
        const searchTerm = req.query.q;
        
        if (!searchTerm) {
            return res.status(400).json({ 
                success: false, 
                error: 'Search term is required' 
            });
        }
        
        const result = await pool.query(`
            SELECT user_id, nombre, observaciones, updated_at, created_at
            FROM conversaciones
            WHERE observaciones = 'stop'
            AND (user_id ILIKE $1 OR nombre ILIKE $1)
            ORDER BY updated_at DESC
            LIMIT 50
        `, [`%${searchTerm}%`]);
        
        res.json({
            success: true,
            users: result.rows,
            searchTerm: searchTerm
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error searching blocked users', { error });
        res.status(500).json({ success: false, error: 'Error searching blocked users' });
    }
});

/**
 * Desbloquear un usuario específico
 */
router.post('/unblock/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Actualizar observaciones para quitar el bloqueo
        const result = await pool.query(`
            UPDATE conversaciones
            SET observaciones = '', 
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
            RETURNING user_id, nombre
        `, [userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }
        
        logger.info('AdminRoute', 'User unblocked', { userId });
        
        res.json({
            success: true,
            message: `User ${userId} unblocked successfully`,
            user: result.rows[0]
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error unblocking user', { error });
        res.status(500).json({ success: false, error: 'Error unblocking user' });
    }
});

/**
 * Actualizar observaciones de un usuario (STOP/START)
 */
router.put('/conversations/:userId/observations', async (req, res) => {
    try {
        const userId = extraerUserId(req.params.userId);
        const { observaciones } = req.body;
        
        if (!observaciones) {
            return res.status(400).json({
                success: false,
                error: 'Observaciones field is required'
            });
        }
        
        await actualizarObservaciones(userId, observaciones);
        
        // Invalidar caché si existe
        const cacheService = getCacheService();
        if (cacheService.isAvailable()) {
            await cacheService.invalidarConversacion(userId);
        }
        
        logger.info('AdminRoute', 'Observations updated', {
            userId,
            observaciones,
            updatedBy: req.ip
        });
        
        res.json({
            success: true,
            message: 'Observations updated successfully'
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error updating observations', { error, userId: req.params.userId });
        res.status(500).json({ success: false, error: 'Error updating observations' });
    }
});

/**
 * Enviar mensaje manual a un usuario
 */
router.post('/conversations/:userId/messages', async (req, res) => {
    try {
        const userId = extraerUserId(req.params.userId);
        const { mensaje, from = 'admin' } = req.body;
        
        if (!mensaje) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }
        
        // Obtener conversación actual
        const conversation = await obtenerConversacionDeDB(userId);
        
        // Agregar mensaje del admin
        const nuevoHistorial = [
            ...conversation.mensajes,
            {
                from,
                mensaje,
                timestamp: new Date().toISOString(),
                tipo: 'manual'
            }
        ];
        
        // Guardar en base de datos
        await guardarConversacionEnDB({
            userId,
            nombre: conversation.nombre || 'Usuario',
            mensajes: nuevoHistorial,
            fase: conversation.fase
        });
        
        // Invalidar caché
        const cacheService = getCacheService();
        if (cacheService.isAvailable()) {
            await cacheService.invalidarConversacion(userId);
        }
        
        logger.info('AdminRoute', 'Manual message sent', {
            userId,
            messagePreview: mensaje.substring(0, 50),
            sentBy: req.ip
        });
        
        res.json({
            success: true,
            message: 'Message sent successfully'
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error sending message', { error, userId: req.params.userId });
        res.status(500).json({ success: false, error: 'Error sending message' });
    }
});

/**
 * Eliminar conversación (cuidado!)
 */
router.delete('/conversations/:userId', async (req, res) => {
    try {
        const userId = extraerUserId(req.params.userId);
        const confirm = req.query.confirm === 'true';
        
        if (!confirm) {
            return res.status(400).json({
                success: false,
                error: 'Add ?confirm=true to confirm deletion'
            });
        }
        
        // Eliminar de base de datos
        await pool.query('DELETE FROM conversaciones WHERE user_id = $1', [userId]);
        
        // Eliminar de caché
        const cacheService = getCacheService();
        if (cacheService.isAvailable()) {
            await cacheService.invalidarConversacion(userId);
        }
        
        logger.warn('AdminRoute', 'Conversation deleted', {
            userId,
            deletedBy: req.ip
        });
        
        res.json({
            success: true,
            message: 'Conversation deleted successfully'
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error deleting conversation', { error, userId: req.params.userId });
        res.status(500).json({ success: false, error: 'Error deleting conversation' });
    }
});

/**
 * Estadísticas de cola de procesamiento
 */
router.get('/queue/stats', async (req, res) => {
    try {
        const queueService = getQueueService();
        const stats = queueService.getQueueStats();
        
        res.json({
            success: true,
            queueStats: stats
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error getting queue stats', { error });
        res.status(500).json({ success: false, error: 'Error retrieving queue stats' });
    }
});

/**
 * Limpiar caché manualmente
 */
router.post('/cache/clear', async (req, res) => {
    try {
        const cacheService = getCacheService();
        
        if (!cacheService.isAvailable()) {
            return res.status(400).json({
                success: false,
                error: 'Cache service not available'
            });
        }
        
        const pattern = req.body.pattern || 'conversacion:*';
        const keys = await cacheService.client.keys(pattern);
        
        if (keys.length > 0) {
            await cacheService.client.del(keys);
        }
        
        logger.info('AdminRoute', 'Cache cleared', {
            pattern,
            keysDeleted: keys.length,
            clearedBy: req.ip
        });
        
        res.json({
            success: true,
            message: `Cache cleared. ${keys.length} keys deleted.`
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error clearing cache', { error });
        res.status(500).json({ success: false, error: 'Error clearing cache' });
    }
});

/**
 * Exportar conversaciones (para backup/análisis)
 */
router.get('/export/conversations', async (req, res) => {
    try {
        const format = req.query.format || 'json';
        const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
        
        const result = await pool.query(`
            SELECT user_id, nombre, fase, observaciones, mensajes, created_at, updated_at
            FROM conversaciones 
            ORDER BY updated_at DESC 
            LIMIT $1
        `, [limit]);
        
        if (format === 'csv') {
            // TODO: Implementar exportación CSV si es necesario
            return res.status(400).json({
                success: false,
                error: 'CSV format not implemented yet'
            });
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=conversations-export-${new Date().toISOString().split('T')[0]}.json`);
        
        res.json({
            success: true,
            exportedAt: new Date().toISOString(),
            totalConversations: result.rows.length,
            conversations: result.rows
        });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error exporting conversations', { error });
        res.status(500).json({ success: false, error: 'Error exporting conversations' });
    }
});

module.exports = router;