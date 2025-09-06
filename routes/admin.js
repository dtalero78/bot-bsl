const express = require('express');
const router = express.Router();
const { pool, obtenerConversacionDeDB, guardarConversacionEnDB, actualizarObservaciones } = require('../utils/dbAPI');
const { getCacheService } = require('../services/cacheService');
const { getQueueService } = require('../services/queueService');
const logger = require('../utils/logger');
const { extraerUserId } = require('../utils/shared');

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
 * Dashboard - Estadísticas generales del bot
 */
router.get('/dashboard', async (req, res) => {
    try {
        // Configurar timeout de 8 segundos para evitar 504
        const queryTimeout = 8000;
        
        const statsPromises = [
            // Total de conversaciones
            pool.query('SELECT COUNT(*) as total FROM conversaciones'),
            
            // Conversaciones activas (últimas 24h)
            pool.query(`
                SELECT COUNT(*) as activas 
                FROM conversaciones 
                WHERE updated_at > NOW() - INTERVAL '24 hours'
            `),
            
            // Distribución por fases
            pool.query(`
                SELECT fase, COUNT(*) as count 
                FROM conversaciones 
                GROUP BY fase
            `),
            
            // Usuarios bloqueados
            pool.query(`
                SELECT COUNT(*) as bloqueados 
                FROM conversaciones 
                WHERE observaciones ILIKE '%stop%'
            `)
        ];
        
        // Agregar timeout a cada query
        const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), queryTimeout)
        );
        
        const stats = await Promise.race([
            Promise.allSettled(statsPromises),
            timeout
        ]).catch(err => {
            logger.error('AdminRoute', 'Database query timeout', { error: err.message });
            // Retornar valores por defecto si hay timeout
            return [
                { status: 'fulfilled', value: { rows: [{ total: 0 }] } },
                { status: 'fulfilled', value: { rows: [{ activas: 0 }] } },
                { status: 'fulfilled', value: { rows: [] } },
                { status: 'fulfilled', value: { rows: [{ bloqueados: 0 }] } }
            ];
        });
        
        const dashboard = {
            conversaciones: {
                total: stats[0]?.value?.rows[0]?.total || 0,
                activas24h: stats[1]?.value?.rows[0]?.activas || 0,
                bloqueadas: stats[3]?.value?.rows[0]?.bloqueados || 0
            },
            fases: stats[2]?.value?.rows || [],
            timestamp: new Date().toISOString()
        };
        
        res.json({ success: true, dashboard });
        
    } catch (error) {
        logger.error('AdminRoute', 'Error getting dashboard', { error });
        // Retornar respuesta básica en caso de error
        res.json({ 
            success: true, 
            dashboard: {
                conversaciones: { total: 0, activas24h: 0, bloqueadas: 0 },
                fases: [],
                timestamp: new Date().toISOString()
            }
        });
    }
});

/**
 * Listar conversaciones con filtros y paginación
 */
router.get('/conversations', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;
        
        const fase = req.query.fase;
        const bloqueados = req.query.bloqueados === 'true';
        const search = req.query.search;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (fase) {
            whereClause += ` AND fase = $${params.length + 1}`;
            params.push(fase);
        }
        
        if (bloqueados) {
            whereClause += ` AND observaciones ILIKE $${params.length + 1}`;
            params.push('%stop%');
        }
        
        if (search) {
            whereClause += ` AND (user_id ILIKE $${params.length + 1} OR nombre ILIKE $${params.length + 1})`;
            params.push(`%${search}%`);
        }
        
        // Query principal
        const query = `
            SELECT user_id, nombre, fase, observaciones, 
                   jsonb_array_length(mensajes) as total_mensajes,
                   created_at, updated_at
            FROM conversaciones 
            ${whereClause}
            ORDER BY updated_at DESC 
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        
        // Query para contar total
        const countQuery = `SELECT COUNT(*) as total FROM conversaciones ${whereClause}`;
        
        const [conversations, totalCount] = await Promise.all([
            pool.query(query, [...params, limit, offset]),
            pool.query(countQuery, params)
        ]);
        
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