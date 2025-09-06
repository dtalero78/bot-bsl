const logger = require('../utils/logger');

/**
 * Middleware para logging automático de requests HTTP
 * Registra información detallada de cada request y response
 */
function requestLogger(req, res, next) {
    const startTime = Date.now();
    
    // Interceptar el método end de response para capturar el final
    const originalEnd = res.end;
    res.end = function(...args) {
        const duration = Date.now() - startTime;
        
        // Log del request completado
        logger.logRequest(req, res, duration);
        
        // Restaurar método original y ejecutar
        originalEnd.apply(res, args);
    };

    // Log del request entrante (opcional, solo para DEBUG)
    if (process.env.LOG_LEVEL === 'DEBUG') {
        logger.debug('HTTP', `Incoming ${req.method} ${req.url}`, {
            userAgent: req.get('User-Agent'),
            ip: req.ip || req.connection.remoteAddress,
            headers: req.headers,
            body: req.method !== 'GET' ? req.body : undefined
        });
    }

    next();
}

module.exports = requestLogger;