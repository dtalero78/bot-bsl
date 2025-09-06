const { getCacheService } = require('../services/cacheService');
const { getQueueService } = require('../services/queueService');
const { pool } = require('../utils/dbAPI');
const { logInfo, logError, generarTimestamp } = require('../utils/shared');
const { config } = require('../config/environment');

/**
 * Middleware para health checks y monitoreo del sistema
 * Proporciona información detallada del estado de todos los servicios
 */
class HealthCheckService {
    
    /**
     * Health check básico - respuesta rápida
     */
    static async basicHealthCheck(req, res) {
        const startTime = Date.now();
        
        try {
            const health = {
                status: 'healthy',
                timestamp: generarTimestamp(),
                uptime: process.uptime(),
                environment: config.server.environment,
                version: process.env.npm_package_version || '1.0.0',
                responseTime: Date.now() - startTime
            };
            
            res.status(200).json(health);
            
        } catch (error) {
            logError('HealthCheck', 'Error en health check básico', { error });
            
            res.status(503).json({
                status: 'unhealthy',
                timestamp: generarTimestamp(),
                error: error.message,
                responseTime: Date.now() - startTime
            });
        }
    }
    
    /**
     * Health check detallado - incluye estado de todos los servicios
     */
    static async detailedHealthCheck(req, res) {
        const startTime = Date.now();
        
        try {
            const [
                databaseHealth,
                redisHealth,
                queueHealth,
                systemHealth
            ] = await Promise.allSettled([
                HealthCheckService.checkDatabase(),
                HealthCheckService.checkRedis(),
                HealthCheckService.checkQueues(),
                HealthCheckService.checkSystemResources()
            ]);
            
            const overallStatus = [
                databaseHealth.value?.status,
                redisHealth.value?.status,
                queueHealth.value?.status,
                systemHealth.value?.status
            ].includes('unhealthy') ? 'unhealthy' : 'healthy';
            
            const healthReport = {
                status: overallStatus,
                timestamp: generarTimestamp(),
                uptime: process.uptime(),
                environment: config.server.environment,
                version: process.env.npm_package_version || '1.0.0',
                services: {
                    database: databaseHealth.status === 'fulfilled' ? databaseHealth.value : { status: 'error', error: databaseHealth.reason },
                    redis: redisHealth.status === 'fulfilled' ? redisHealth.value : { status: 'error', error: redisHealth.reason },
                    queues: queueHealth.status === 'fulfilled' ? queueHealth.value : { status: 'error', error: queueHealth.reason },
                    system: systemHealth.status === 'fulfilled' ? systemHealth.value : { status: 'error', error: systemHealth.reason }
                },
                responseTime: Date.now() - startTime
            };
            
            const statusCode = overallStatus === 'healthy' ? 200 : 503;
            res.status(statusCode).json(healthReport);
            
            // Log del health check
            logInfo('HealthCheck', 'Health check detallado completado', { 
                status: overallStatus,
                responseTime: Date.now() - startTime
            });
            
        } catch (error) {
            logError('HealthCheck', 'Error en health check detallado', { error });
            
            res.status(503).json({
                status: 'unhealthy',
                timestamp: generarTimestamp(),
                error: error.message,
                responseTime: Date.now() - startTime
            });
        }
    }
    
    /**
     * Verifica el estado de la base de datos PostgreSQL
     */
    static async checkDatabase() {
        try {
            const start = Date.now();
            
            // Test de conexión básica
            const result = await pool.query('SELECT 1 as health_check');
            const connectionTime = Date.now() - start;
            
            // Estadísticas del pool de conexiones
            const poolStats = {
                totalConnections: pool.totalCount,
                idleConnections: pool.idleCount,
                waitingClients: pool.waitingCount
            };
            
            // Test de escritura/lectura básico
            const writeTest = await pool.query('SELECT NOW() as current_time');
            
            return {
                status: 'healthy',
                responseTime: connectionTime,
                pool: poolStats,
                lastQuery: writeTest.rows[0].current_time,
                host: config.database.host,
                database: config.database.name
            };
            
        } catch (error) {
            logError('HealthCheck', 'Database health check failed', { error });
            
            return {
                status: 'unhealthy',
                error: error.message,
                host: config.database.host,
                database: config.database.name
            };
        }
    }
    
    /**
     * Verifica el estado de Redis (caché)
     */
    static async checkRedis() {
        try {
            const cacheService = getCacheService();
            const start = Date.now();
            
            if (!cacheService.isAvailable()) {
                return {
                    status: 'unhealthy',
                    error: 'Redis no está disponible',
                    url: config.redis.url
                };
            }
            
            // Test básico de escritura/lectura
            const testKey = 'health_check_' + Date.now();
            const testValue = 'test_value';
            
            await cacheService.client.set(testKey, testValue, { EX: 10 });
            const retrievedValue = await cacheService.client.get(testKey);
            await cacheService.client.del(testKey);
            
            const responseTime = Date.now() - start;
            
            if (retrievedValue !== testValue) {
                throw new Error('Redis read/write test failed');
            }
            
            // Obtener estadísticas
            const stats = await cacheService.obtenerEstadisticas();
            
            return {
                status: 'healthy',
                responseTime,
                url: config.redis.url,
                stats: stats
            };
            
        } catch (error) {
            logError('HealthCheck', 'Redis health check failed', { error });
            
            return {
                status: 'unhealthy',
                error: error.message,
                url: config.redis.url
            };
        }
    }
    
    /**
     * Verifica el estado del sistema de colas
     */
    static async checkQueues() {
        try {
            const queueService = getQueueService();
            const stats = queueService.getQueueStats();
            
            // Verificar si hay colas bloqueadas o con demasiadas tareas pendientes
            const totalPending = stats.totalPending;
            const maxPendingAllowed = 50; // Límite configurable
            
            const status = totalPending > maxPendingAllowed ? 'degraded' : 'healthy';
            
            return {
                status,
                isProcessing: stats.isProcessing,
                totalPending,
                totalActive: stats.totalActive,
                queues: stats.queues,
                maxPendingAllowed
            };
            
        } catch (error) {
            logError('HealthCheck', 'Queue health check failed', { error });
            
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }
    
    /**
     * Verifica recursos del sistema (memoria, CPU, etc.)
     */
    static async checkSystemResources() {
        try {
            const memUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            
            // Convertir bytes a MB
            const memoryStats = {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                rss: Math.round(memUsage.rss / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024)
            };
            
            // Verificar límites de memoria (alerta si supera 512MB)
            const memoryWarningThreshold = 512; // MB
            const memoryStatus = memoryStats.rss > memoryWarningThreshold ? 'degraded' : 'healthy';
            
            return {
                status: memoryStatus,
                memory: memoryStats,
                uptime: process.uptime(),
                nodeVersion: process.version,
                platform: process.platform,
                pid: process.pid,
                warnings: memoryStatus === 'degraded' ? [`Memory usage high: ${memoryStats.rss}MB`] : []
            };
            
        } catch (error) {
            logError('HealthCheck', 'System resources check failed', { error });
            
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }
    
    /**
     * Endpoint para métricas específicas (Prometheus compatible)
     */
    static async metricsEndpoint(req, res) {
        try {
            const [dbHealth, redisHealth, queueHealth, systemHealth] = await Promise.allSettled([
                HealthCheckService.checkDatabase(),
                HealthCheckService.checkRedis(),
                HealthCheckService.checkQueues(),
                HealthCheckService.checkSystemResources()
            ]);
            
            const metrics = {
                // Métricas de base de datos
                db_connections_total: dbHealth.value?.pool?.totalConnections || 0,
                db_connections_idle: dbHealth.value?.pool?.idleConnections || 0,
                db_connections_waiting: dbHealth.value?.pool?.waitingClients || 0,
                db_response_time_ms: dbHealth.value?.responseTime || 0,
                
                // Métricas de Redis
                redis_available: redisHealth.value?.status === 'healthy' ? 1 : 0,
                redis_response_time_ms: redisHealth.value?.responseTime || 0,
                
                // Métricas de colas
                queue_tasks_pending: queueHealth.value?.totalPending || 0,
                queue_tasks_active: queueHealth.value?.totalActive || 0,
                queue_processing: queueHealth.value?.isProcessing ? 1 : 0,
                
                // Métricas del sistema
                memory_heap_used_mb: systemHealth.value?.memory?.heapUsed || 0,
                memory_rss_mb: systemHealth.value?.memory?.rss || 0,
                uptime_seconds: systemHealth.value?.uptime || 0,
                
                // Métricas generales
                timestamp: Date.now(),
                status_healthy: 1 // 1 si el servicio está funcionando, 0 si no
            };
            
            res.set('Content-Type', 'text/plain');
            res.status(200).send(
                Object.entries(metrics)
                    .map(([key, value]) => `${key} ${value}`)
                    .join('\n')
            );
            
        } catch (error) {
            logError('HealthCheck', 'Metrics endpoint error', { error });
            res.status(500).send('# Error generating metrics\n');
        }
    }
}

module.exports = HealthCheckService;