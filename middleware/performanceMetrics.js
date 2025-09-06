const logger = require('../utils/logger');
const { getCacheService } = require('../services/cacheService');
const { getQueueService } = require('../services/queueService');

/**
 * Sistema de métricas de performance para monitoreo en tiempo real
 * Recopila y almacena métricas clave del sistema
 */
class PerformanceMetrics {
    constructor() {
        this.metrics = {
            requests: {
                total: 0,
                success: 0,
                errors: 0,
                avgResponseTime: 0,
                byEndpoint: {},
                byStatusCode: {}
            },
            memory: {
                heapUsed: 0,
                heapTotal: 0,
                rss: 0,
                external: 0
            },
            database: {
                connections: {
                    total: 0,
                    idle: 0,
                    waiting: 0
                },
                queries: {
                    total: 0,
                    slow: 0,
                    avgTime: 0
                }
            },
            cache: {
                hits: 0,
                misses: 0,
                hitRate: 0,
                operations: 0
            },
            queue: {
                pending: 0,
                active: 0,
                completed: 0,
                failed: 0
            },
            system: {
                uptime: 0,
                cpuUsage: 0,
                loadAverage: []
            }
        };

        this.responseTimes = [];
        this.maxResponseTimesSample = 1000; // Mantener últimas 1000 muestras
        
        this.startTime = Date.now();
        this.lastMetricsUpdate = Date.now();
        
        // Iniciar recolección periódica
        this.startPeriodicCollection();
    }

    /**
     * Middleware para capturar métricas de requests HTTP
     */
    static requestMetricsMiddleware(req, res, next) {
        const startTime = Date.now();
        const instance = getInstance();

        // Interceptar el final de la respuesta
        const originalEnd = res.end;
        res.end = function(...args) {
            const duration = Date.now() - startTime;
            const endpoint = req.route ? req.route.path : req.path;
            const method = req.method;
            const statusCode = res.statusCode;

            // Registrar métricas del request
            instance.recordRequest(endpoint, method, statusCode, duration);

            // Ejecutar método original
            originalEnd.apply(res, args);
        };

        next();
    }

    /**
     * Registrar métricas de un request HTTP
     */
    recordRequest(endpoint, method, statusCode, duration) {
        const endpointKey = `${method} ${endpoint}`;
        
        // Métricas generales
        this.metrics.requests.total++;
        if (statusCode < 400) {
            this.metrics.requests.success++;
        } else {
            this.metrics.requests.errors++;
        }

        // Tiempo de respuesta
        this.responseTimes.push(duration);
        if (this.responseTimes.length > this.maxResponseTimesSample) {
            this.responseTimes.shift();
        }
        
        this.metrics.requests.avgResponseTime = this.calculateAverageResponseTime();

        // Por endpoint
        if (!this.metrics.requests.byEndpoint[endpointKey]) {
            this.metrics.requests.byEndpoint[endpointKey] = {
                count: 0,
                avgTime: 0,
                errors: 0,
                times: []
            };
        }
        
        const endpointMetrics = this.metrics.requests.byEndpoint[endpointKey];
        endpointMetrics.count++;
        endpointMetrics.times.push(duration);
        
        // Mantener solo las últimas 100 muestras por endpoint
        if (endpointMetrics.times.length > 100) {
            endpointMetrics.times.shift();
        }
        
        endpointMetrics.avgTime = endpointMetrics.times.reduce((a, b) => a + b, 0) / endpointMetrics.times.length;
        
        if (statusCode >= 400) {
            endpointMetrics.errors++;
        }

        // Por código de estado
        if (!this.metrics.requests.byStatusCode[statusCode]) {
            this.metrics.requests.byStatusCode[statusCode] = 0;
        }
        this.metrics.requests.byStatusCode[statusCode]++;

        // Log de requests lentos
        if (duration > 5000) { // > 5 segundos
            logger.warn('PerformanceMetrics', `Slow request detected: ${endpointKey}`, {
                duration: `${duration}ms`,
                statusCode
            });
        }
    }

    /**
     * Calcular tiempo promedio de respuesta
     */
    calculateAverageResponseTime() {
        if (this.responseTimes.length === 0) return 0;
        return this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
    }

    /**
     * Registrar métricas de base de datos
     */
    recordDatabaseMetrics(operation, duration, metadata = {}) {
        this.metrics.database.queries.total++;
        
        // Considerar query lenta si toma más de 1 segundo
        if (duration > 1000) {
            this.metrics.database.queries.slow++;
            logger.warn('PerformanceMetrics', `Slow database query: ${operation}`, {
                duration: `${duration}ms`,
                ...metadata
            });
        }

        // Actualizar tiempo promedio (usando moving average simple)
        const currentAvg = this.metrics.database.queries.avgTime;
        const count = this.metrics.database.queries.total;
        this.metrics.database.queries.avgTime = ((currentAvg * (count - 1)) + duration) / count;

        logger.logDatabase(operation, duration, metadata);
    }

    /**
     * Registrar métricas de caché
     */
    recordCacheOperation(operation, key, hit = false, duration = 0) {
        this.metrics.cache.operations++;
        
        if (hit) {
            this.metrics.cache.hits++;
        } else {
            this.metrics.cache.misses++;
        }

        this.metrics.cache.hitRate = this.metrics.cache.hits / this.metrics.cache.operations;

        logger.logCache(operation, key, hit, duration);
    }

    /**
     * Actualizar métricas del sistema
     */
    updateSystemMetrics() {
        try {
            // Métricas de memoria
            const memUsage = process.memoryUsage();
            this.metrics.memory = {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                rss: Math.round(memUsage.rss / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024)
            };

            // Métricas del sistema
            this.metrics.system = {
                uptime: Math.round(process.uptime()),
                cpuUsage: process.cpuUsage(),
                loadAverage: process.platform === 'linux' ? require('os').loadavg() : [0, 0, 0],
                nodeVersion: process.version,
                pid: process.pid
            };

            // Métricas de caché (si está disponible)
            try {
                const cacheService = getCacheService();
                if (cacheService.isAvailable()) {
                    // Las métricas de caché se actualizan en tiempo real
                    // Aquí podríamos obtener estadísticas adicionales si es necesario
                }
            } catch (error) {
                // Cache no disponible, ignorar
            }

            // Métricas de cola (si está disponible)
            try {
                const queueService = getQueueService();
                const queueStats = queueService.getQueueStats();
                this.metrics.queue = {
                    pending: queueStats.totalPending,
                    active: queueStats.totalActive,
                    completed: queueStats.totalCompleted || 0,
                    failed: queueStats.totalFailed || 0
                };
            } catch (error) {
                // Queue service no disponible, ignorar
            }

            this.lastMetricsUpdate = Date.now();

        } catch (error) {
            logger.error('PerformanceMetrics', 'Error updating system metrics', { error });
        }
    }

    /**
     * Obtener todas las métricas actuales
     */
    getAllMetrics() {
        this.updateSystemMetrics();
        
        return {
            ...this.metrics,
            timestamp: new Date().toISOString(),
            collectionDuration: Date.now() - this.startTime,
            lastUpdate: new Date(this.lastMetricsUpdate).toISOString()
        };
    }

    /**
     * Obtener métricas en formato Prometheus
     */
    getPrometheusMetrics() {
        this.updateSystemMetrics();
        
        const metrics = [];
        
        // Request metrics
        metrics.push(`http_requests_total ${this.metrics.requests.total}`);
        metrics.push(`http_requests_success_total ${this.metrics.requests.success}`);
        metrics.push(`http_requests_errors_total ${this.metrics.requests.errors}`);
        metrics.push(`http_request_duration_ms_avg ${this.metrics.requests.avgResponseTime.toFixed(2)}`);
        
        // Memory metrics
        metrics.push(`nodejs_memory_heap_used_mb ${this.metrics.memory.heapUsed}`);
        metrics.push(`nodejs_memory_heap_total_mb ${this.metrics.memory.heapTotal}`);
        metrics.push(`nodejs_memory_rss_mb ${this.metrics.memory.rss}`);
        
        // Database metrics
        metrics.push(`database_queries_total ${this.metrics.database.queries.total}`);
        metrics.push(`database_queries_slow_total ${this.metrics.database.queries.slow}`);
        metrics.push(`database_query_duration_ms_avg ${this.metrics.database.queries.avgTime.toFixed(2)}`);
        
        // Cache metrics
        metrics.push(`cache_operations_total ${this.metrics.cache.operations}`);
        metrics.push(`cache_hits_total ${this.metrics.cache.hits}`);
        metrics.push(`cache_misses_total ${this.metrics.cache.misses}`);
        metrics.push(`cache_hit_rate ${this.metrics.cache.hitRate.toFixed(3)}`);
        
        // Queue metrics
        metrics.push(`queue_tasks_pending ${this.metrics.queue.pending}`);
        metrics.push(`queue_tasks_active ${this.metrics.queue.active}`);
        metrics.push(`queue_tasks_completed_total ${this.metrics.queue.completed}`);
        metrics.push(`queue_tasks_failed_total ${this.metrics.queue.failed}`);
        
        // System metrics
        metrics.push(`nodejs_uptime_seconds ${this.metrics.system.uptime}`);
        
        return metrics.join('\n');
    }

    /**
     * Iniciar recolección periódica de métricas
     */
    startPeriodicCollection() {
        // Actualizar métricas cada 30 segundos
        setInterval(() => {
            this.updateSystemMetrics();
            
            // Log de métricas cada 5 minutos
            if (Date.now() - this.lastMetricsUpdate > 300000) {
                this.logMetricsSummary();
            }
        }, 30000);
    }

    /**
     * Log resumen de métricas
     */
    logMetricsSummary() {
        const summary = {
            requests: {
                total: this.metrics.requests.total,
                successRate: `${((this.metrics.requests.success / this.metrics.requests.total) * 100).toFixed(1)}%`,
                avgResponseTime: `${this.metrics.requests.avgResponseTime.toFixed(0)}ms`
            },
            memory: `${this.metrics.memory.rss}MB`,
            database: {
                queries: this.metrics.database.queries.total,
                avgTime: `${this.metrics.database.queries.avgTime.toFixed(0)}ms`,
                slowQueries: this.metrics.database.queries.slow
            },
            cache: {
                hitRate: `${(this.metrics.cache.hitRate * 100).toFixed(1)}%`,
                operations: this.metrics.cache.operations
            },
            uptime: `${Math.round(this.metrics.system.uptime / 3600)}h`
        };

        logger.info('PerformanceMetrics', 'Metrics summary', summary);
    }

    /**
     * Reset de métricas (para testing o limpieza)
     */
    reset() {
        const newMetrics = new PerformanceMetrics();
        Object.assign(this, newMetrics);
        logger.info('PerformanceMetrics', 'Metrics reset completed');
    }
}

// Singleton instance
let instance = null;

function getInstance() {
    if (!instance) {
        instance = new PerformanceMetrics();
    }
    return instance;
}

module.exports = {
    PerformanceMetrics,
    getInstance,
    requestMetricsMiddleware: PerformanceMetrics.requestMetricsMiddleware
};