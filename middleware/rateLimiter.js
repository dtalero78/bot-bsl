const { getCacheService } = require('../services/cacheService');
const logger = require('../utils/logger');

/**
 * Sistema de rate limiting para protección de APIs
 * Implementa múltiples estrategias de limitación de requests
 */
class RateLimiter {
    constructor(options = {}) {
        this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutos por defecto
        this.maxRequests = options.maxRequests || 100; // 100 requests por ventana
        this.keyGenerator = options.keyGenerator || this.defaultKeyGenerator;
        this.skipSuccessfulRequests = options.skipSuccessfulRequests || false;
        this.skipFailedRequests = options.skipFailedRequests || false;
        this.message = options.message || 'Too many requests, please try again later';
        this.statusCode = options.statusCode || 429;
        this.headers = options.headers !== false;
        
        // Configuraciones específicas por endpoint
        this.endpointConfigs = options.endpointConfigs || {};
        
        // Configuraciones por tipo de usuario
        this.userTypeConfigs = options.userTypeConfigs || {};
    }

    /**
     * Generador de clave por defecto
     */
    defaultKeyGenerator(req) {
        // Usar IP + User-Agent como identificador único
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const userAgent = req.get('User-Agent') || 'unknown';
        return `rate_limit:${ip}:${Buffer.from(userAgent).toString('base64').substring(0, 20)}`;
    }

    /**
     * Obtener configuración específica para un request
     */
    getConfigForRequest(req) {
        // Configuración por endpoint
        const endpoint = req.route ? req.route.path : req.path;
        const method = req.method;
        const endpointKey = `${method} ${endpoint}`;
        
        if (this.endpointConfigs[endpointKey]) {
            return { ...this, ...this.endpointConfigs[endpointKey] };
        }
        
        if (this.endpointConfigs[endpoint]) {
            return { ...this, ...this.endpointConfigs[endpoint] };
        }
        
        // Configuración por tipo de usuario (si está definido)
        const userType = this.getUserType(req);
        if (userType && this.userTypeConfigs[userType]) {
            return { ...this, ...this.userTypeConfigs[userType] };
        }
        
        return this;
    }

    /**
     * Determinar tipo de usuario (para diferentes límites)
     */
    getUserType(req) {
        // Implementar lógica para determinar tipo de usuario
        // Por ejemplo: admin, premium, free, bot
        if (req.headers.authorization) {
            return 'authenticated';
        }
        return 'anonymous';
    }

    /**
     * Middleware principal de rate limiting
     */
    middleware() {
        return async (req, res, next) => {
            try {
                const config = this.getConfigForRequest(req);
                const key = config.keyGenerator(req);
                const cacheService = getCacheService();
                
                // Si no hay cache disponible, permitir el request sin loguear
                if (!cacheService.isAvailable()) {
                    return next();
                }

                // Obtener contador actual
                const current = await this.getCurrentCount(cacheService, key, config);
                
                // Verificar límite
                if (current.count > config.maxRequests) {
                    const retryAfter = Math.ceil(config.windowMs / 1000);
                    
                    // Headers informativos
                    if (config.headers) {
                        res.set({
                            'X-RateLimit-Limit': config.maxRequests,
                            'X-RateLimit-Remaining': 0,
                            'X-RateLimit-Reset': new Date(Date.now() + config.windowMs),
                            'Retry-After': retryAfter
                        });
                    }

                    // Log del rate limit hit
                    logger.warn('RateLimiter', 'Rate limit exceeded', {
                        key: key.substring(0, 50) + '...', // Truncar key para privacidad
                        currentCount: current.count,
                        limit: config.maxRequests,
                        ip: req.ip,
                        endpoint: req.path,
                        method: req.method,
                        userAgent: req.get('User-Agent')
                    });

                    return res.status(config.statusCode).json({
                        success: false,
                        error: config.message,
                        retryAfter: retryAfter
                    });
                }

                // Incrementar contador después del request (si es exitoso)
                const originalEnd = res.end;
                res.end = async (...args) => {
                    try {
                        const shouldCount = this.shouldCountRequest(req, res, config);
                        if (shouldCount) {
                            await this.incrementCount(cacheService, key, config);
                        }
                    } catch (error) {
                        logger.error('RateLimiter', 'Error incrementing counter', { error, key });
                    }
                    originalEnd.apply(res, args);
                };

                // Headers informativos
                if (config.headers) {
                    res.set({
                        'X-RateLimit-Limit': config.maxRequests,
                        'X-RateLimit-Remaining': Math.max(0, config.maxRequests - current.count - 1),
                        'X-RateLimit-Reset': new Date(Date.now() + config.windowMs)
                    });
                }

                next();

            } catch (error) {
                logger.error('RateLimiter', 'Error in rate limiter middleware', { error });
                // En caso de error, permitir el request pero loguearlo
                next();
            }
        };
    }

    /**
     * Obtener contador actual para una clave
     */
    async getCurrentCount(cacheService, key, config) {
        try {
            const data = await cacheService.client.get(key);
            if (!data) {
                return { count: 0, resetTime: Date.now() + config.windowMs };
            }

            const parsed = JSON.parse(data);
            const now = Date.now();
            
            // Si la ventana ha expirado, resetear
            if (now >= parsed.resetTime) {
                return { count: 0, resetTime: now + config.windowMs };
            }

            return parsed;
        } catch (error) {
            logger.error('RateLimiter', 'Error getting current count', { error, key });
            return { count: 0, resetTime: Date.now() + config.windowMs };
        }
    }

    /**
     * Incrementar contador
     */
    async incrementCount(cacheService, key, config) {
        try {
            const current = await this.getCurrentCount(cacheService, key, config);
            const updated = {
                count: current.count + 1,
                resetTime: current.resetTime
            };

            const ttlSeconds = Math.ceil((updated.resetTime - Date.now()) / 1000);
            await cacheService.client.setex(key, Math.max(ttlSeconds, 1), JSON.stringify(updated));
            
            return updated;
        } catch (error) {
            logger.error('RateLimiter', 'Error incrementing count', { error, key });
        }
    }

    /**
     * Determinar si debe contar este request
     */
    shouldCountRequest(req, res, config) {
        const statusCode = res.statusCode;
        
        if (config.skipSuccessfulRequests && statusCode < 400) {
            return false;
        }
        
        if (config.skipFailedRequests && statusCode >= 400) {
            return false;
        }
        
        return true;
    }

    /**
     * Reset manual de límites para una clave específica
     */
    async resetLimit(keyOrReq) {
        try {
            const cacheService = getCacheService();
            if (!cacheService.isAvailable()) {
                throw new Error('Cache not available');
            }

            const key = typeof keyOrReq === 'string' ? keyOrReq : this.keyGenerator(keyOrReq);
            await cacheService.client.del(key);
            
            logger.info('RateLimiter', 'Rate limit reset', { key: key.substring(0, 50) + '...' });
            return true;
        } catch (error) {
            logger.error('RateLimiter', 'Error resetting rate limit', { error });
            return false;
        }
    }

    /**
     * Obtener estadísticas de rate limiting
     */
    async getStats() {
        try {
            const cacheService = getCacheService();
            if (!cacheService.isAvailable()) {
                return { available: false, message: 'Cache not available' };
            }

            // Obtener todas las claves de rate limiting
            const keys = await cacheService.client.keys('rate_limit:*');
            const stats = {
                totalActiveKeys: keys.length,
                keysByStatus: {
                    active: 0,
                    expired: 0
                },
                topLimiters: []
            };

            const now = Date.now();
            const keyData = [];

            for (const key of keys.slice(0, 100)) { // Limitar para performance
                try {
                    const data = await cacheService.client.get(key);
                    if (data) {
                        const parsed = JSON.parse(data);
                        if (now < parsed.resetTime) {
                            stats.keysByStatus.active++;
                            keyData.push({
                                key: key.substring(0, 50) + '...',
                                count: parsed.count,
                                resetTime: new Date(parsed.resetTime).toISOString()
                            });
                        } else {
                            stats.keysByStatus.expired++;
                        }
                    }
                } catch (parseError) {
                    logger.debug('RateLimiter', 'Error parsing key data', { key, error: parseError });
                }
            }

            // Top 10 keys por count
            stats.topLimiters = keyData
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

            return stats;
        } catch (error) {
            logger.error('RateLimiter', 'Error getting rate limiter stats', { error });
            return { error: error.message };
        }
    }
}

/**
 * Configuraciones predefinidas para diferentes escenarios
 */
const configurations = {
    // Rate limiting estricto para APIs sensibles
    strict: {
        windowMs: 15 * 60 * 1000, // 15 minutos
        maxRequests: 10,
        message: 'Too many requests. Please try again in 15 minutes.'
    },
    
    // Rate limiting normal para endpoints generales
    normal: {
        windowMs: 15 * 60 * 1000, // 15 minutos
        maxRequests: 100,
        message: 'Too many requests. Please slow down.'
    },
    
    // Rate limiting para webhooks (más permisivo)
    webhook: {
        windowMs: 1 * 60 * 1000, // 1 minuto
        maxRequests: 60,
        skipFailedRequests: true,
        message: 'Webhook rate limit exceeded.'
    },
    
    // Configuración para APIs de imágenes
    imageProcessing: {
        windowMs: 10 * 60 * 1000, // 10 minutos
        maxRequests: 5,
        message: 'Too many image processing requests. Please wait before uploading more images.'
    }
};

/**
 * Factory functions para crear rate limiters configurados
 */
const createRateLimiter = (configName, customOptions = {}) => {
    const baseConfig = configurations[configName] || configurations.normal;
    const finalConfig = { ...baseConfig, ...customOptions };
    return new RateLimiter(finalConfig);
};

module.exports = {
    RateLimiter,
    createRateLimiter,
    configurations
};