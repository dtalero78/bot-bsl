const fs = require('fs');
const path = require('path');

// Función local para evitar dependencia circular
function generarTimestamp() {
    return new Date().toISOString();
}

/**
 * Sistema de logging estructurado con diferentes niveles
 * Centraliza todos los logs del sistema con formato consistente
 */
class Logger {
    constructor() {
        this.logLevels = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            DEBUG: 3
        };

        this.currentLevel = this.logLevels[process.env.LOG_LEVEL || 'INFO'];
        this.logToFile = process.env.LOG_TO_FILE === 'true';
        this.logDirectory = process.env.LOG_DIR || './logs';
        
        this.initializeLogDirectory();
    }

    /**
     * Inicializar directorio de logs si está habilitado
     */
    initializeLogDirectory() {
        if (this.logToFile) {
            try {
                if (!fs.existsSync(this.logDirectory)) {
                    fs.mkdirSync(this.logDirectory, { recursive: true });
                }
            } catch (error) {
                console.error('Error creating log directory:', error);
                this.logToFile = false;
            }
        }
    }

    /**
     * Formatear mensaje de log con estructura consistente
     */
    formatMessage(level, component, message, metadata = {}) {
        const logEntry = {
            timestamp: generarTimestamp(),
            level: level,
            component: component,
            message: message,
            metadata: metadata,
            pid: process.pid,
            environment: process.env.NODE_ENV || 'development'
        };

        // Añadir información de error si existe
        if (metadata.error && metadata.error instanceof Error) {
            logEntry.error = {
                name: metadata.error.name,
                message: metadata.error.message,
                stack: metadata.error.stack
            };
        }

        return logEntry;
    }

    /**
     * Escribir log a archivo
     */
    writeToFile(level, logEntry) {
        if (!this.logToFile) return;

        try {
            const date = new Date().toISOString().split('T')[0];
            const filename = `${level.toLowerCase()}-${date}.log`;
            const filepath = path.join(this.logDirectory, filename);
            
            const logLine = JSON.stringify(logEntry) + '\n';
            fs.appendFileSync(filepath, logLine);
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }

    /**
     * Escribir log a consola con formato legible
     */
    writeToConsole(level, logEntry) {
        const colorCodes = {
            ERROR: '\x1b[31m', // Rojo
            WARN: '\x1b[33m',  // Amarillo
            INFO: '\x1b[36m',  // Cian
            DEBUG: '\x1b[37m'  // Blanco
        };

        const resetColor = '\x1b[0m';
        const color = colorCodes[level] || '';

        const consoleMessage = `${color}[${logEntry.timestamp}] ${level} ${logEntry.component}: ${logEntry.message}${resetColor}`;
        
        // Mostrar metadata si existe
        if (Object.keys(logEntry.metadata).length > 0) {
            console.log(consoleMessage);
            console.log('  Metadata:', JSON.stringify(logEntry.metadata, null, 2));
        } else {
            console.log(consoleMessage);
        }

        // Mostrar stack trace para errores
        if (logEntry.error && logEntry.error.stack) {
            console.log('  Stack:', logEntry.error.stack);
        }
    }

    /**
     * Método interno para procesar logs
     */
    log(level, component, message, metadata = {}) {
        const levelValue = this.logLevels[level];
        
        // Verificar si el nivel está habilitado
        if (levelValue > this.currentLevel) {
            return;
        }

        const logEntry = this.formatMessage(level, component, message, metadata);

        // Escribir a consola
        this.writeToConsole(level, logEntry);

        // Escribir a archivo
        this.writeToFile(level, logEntry);

        // Para errores críticos, también notificar por otros medios si está configurado
        if (level === 'ERROR' && process.env.ENABLE_ERROR_ALERTS === 'true') {
            this.notifyError(logEntry);
        }
    }

    /**
     * Notificación de errores críticos (placeholder para futuras integraciones)
     */
    notifyError(logEntry) {
        // Aquí se podría integrar con servicios como Slack, Discord, etc.
        // Por ahora solo logueamos que es un error crítico
        console.error('🚨 CRITICAL ERROR DETECTED:', logEntry.message);
    }

    /**
     * Log de nivel ERROR
     */
    error(component, message, metadata = {}) {
        this.log('ERROR', component, message, metadata);
    }

    /**
     * Log de nivel WARN
     */
    warn(component, message, metadata = {}) {
        this.log('WARN', component, message, metadata);
    }

    /**
     * Log de nivel INFO
     */
    info(component, message, metadata = {}) {
        this.log('INFO', component, message, metadata);
    }

    /**
     * Log de nivel DEBUG
     */
    debug(component, message, metadata = {}) {
        this.log('DEBUG', component, message, metadata);
    }

    /**
     * Log específico para requests HTTP
     */
    logRequest(req, res, duration = 0) {
        const metadata = {
            method: req.method,
            url: req.url,
            userAgent: req.get('User-Agent'),
            ip: req.ip || req.connection.remoteAddress,
            duration: `${duration}ms`,
            statusCode: res.statusCode,
            responseSize: res.get('Content-Length') || 0
        };

        const level = res.statusCode >= 400 ? 'ERROR' : 'INFO';
        this.log(level, 'HTTP', `${req.method} ${req.url} - ${res.statusCode}`, metadata);
    }

    /**
     * Log específico para operaciones de base de datos
     */
    logDatabase(operation, duration, metadata = {}) {
        this.log('DEBUG', 'Database', `${operation} completed`, {
            duration: `${duration}ms`,
            ...metadata
        });
    }

    /**
     * Log específico para operaciones de caché
     */
    logCache(operation, key, hit = false, duration = 0) {
        const level = hit ? 'DEBUG' : 'INFO';
        this.log(level, 'Cache', `${operation} ${key}`, {
            hit: hit,
            duration: `${duration}ms`
        });
    }

    /**
     * Log específico para procesamiento de imágenes
     */
    logImageProcessing(userId, type, duration, result = null) {
        this.log('INFO', 'ImageProcessing', `Processed ${type} image`, {
            userId: userId,
            duration: `${duration}ms`,
            result: result
        });
    }

    /**
     * Log específico para mensajes de WhatsApp
     */
    logWhatsApp(direction, userId, messageType, metadata = {}) {
        this.log('INFO', 'WhatsApp', `${direction} ${messageType} message`, {
            userId: userId,
            ...metadata
        });
    }

    /**
     * Obtener estadísticas de logging
     */
    getStats() {
        // Implementar contadores de logs si es necesario
        return {
            logLevel: Object.keys(this.logLevels).find(key => this.logLevels[key] === this.currentLevel),
            logToFile: this.logToFile,
            logDirectory: this.logDirectory,
            uptime: process.uptime()
        };
    }

    /**
     * Limpiar logs antiguos (ejecutar periódicamente)
     */
    cleanOldLogs(daysToKeep = 30) {
        if (!this.logToFile) return;

        try {
            const files = fs.readdirSync(this.logDirectory);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            files.forEach(file => {
                const filepath = path.join(this.logDirectory, file);
                const stats = fs.statSync(filepath);
                
                if (stats.mtime < cutoffDate) {
                    fs.unlinkSync(filepath);
                    this.info('Logger', `Deleted old log file: ${file}`);
                }
            });
        } catch (error) {
            this.error('Logger', 'Error cleaning old logs', { error });
        }
    }
}

// Crear instancia singleton del logger
const logger = new Logger();

module.exports = logger;