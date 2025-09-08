const redis = require('redis');
const { logInfo, logError } = require('../utils/shared');
const { config } = require('../config/environment');

/**
 * Servicio de caché usando Redis para mejorar performance
 * Cachea conversaciones frecuentes y reduce consultas a la base de datos
 */
class CacheService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.defaultTTL = 3600; // 1 hora en segundos
        
        this.initializeRedis();
    }
    
    async initializeRedis() {
        // Redis desactivado - operando sin caché
        this.isConnected = false;
        this.client = null;
        logInfo('CacheService', 'Redis desactivado - operando sin caché');
    }
    
    /**
     * Verifica si Redis está disponible
     */
    isAvailable() {
        return this.isConnected && this.client;
    }
    
    /**
     * Obtiene una conversación del caché
     */
    async obtenerConversacion(userId) {
        if (!this.isAvailable()) return null;
        
        try {
            const cacheKey = `conversacion:${userId}`;
            const cached = await this.client.get(cacheKey);
            
            if (cached) {
                const data = JSON.parse(cached);
                logInfo('CacheService', 'Conversación obtenida del caché', { 
                    userId, 
                    mensajes: data.mensajes?.length || 0 
                });
                return data;
            }
            
            return null;
            
        } catch (error) {
            logError('CacheService', 'Error obteniendo conversación del caché', { userId, error });
            return null;
        }
    }
    
    /**
     * Guarda una conversación en el caché
     */
    async guardarConversacion(userId, conversacion, ttl = this.defaultTTL) {
        if (!this.isAvailable()) return false;
        
        try {
            const cacheKey = `conversacion:${userId}`;
            await this.client.setEx(cacheKey, ttl, JSON.stringify(conversacion));
            
            logInfo('CacheService', 'Conversación guardada en caché', { 
                userId, 
                mensajes: conversacion.mensajes?.length || 0,
                ttl 
            });
            return true;
            
        } catch (error) {
            logError('CacheService', 'Error guardando conversación en caché', { userId, error });
            return false;
        }
    }
    
    /**
     * Invalida una conversación específica del caché
     */
    async invalidarConversacion(userId) {
        if (!this.isAvailable()) return false;
        
        try {
            const cacheKey = `conversacion:${userId}`;
            await this.client.del(cacheKey);
            
            logInfo('CacheService', 'Caché invalidado para conversación', { userId });
            return true;
            
        } catch (error) {
            logError('CacheService', 'Error invalidando caché', { userId, error });
            return false;
        }
    }
    
    /**
     * Cachea resultado de OpenAI para evitar llamadas repetidas
     */
    async obtenerRespuestaOpenAI(promptHash) {
        if (!this.isAvailable()) return null;
        
        try {
            const cacheKey = `openai:${promptHash}`;
            const cached = await this.client.get(cacheKey);
            
            if (cached) {
                logInfo('CacheService', 'Respuesta OpenAI obtenida del caché', { promptHash });
                return JSON.parse(cached);
            }
            
            return null;
            
        } catch (error) {
            logError('CacheService', 'Error obteniendo respuesta OpenAI del caché', { promptHash, error });
            return null;
        }
    }
    
    /**
     * Guarda respuesta de OpenAI en caché
     */
    async guardarRespuestaOpenAI(promptHash, respuesta, ttl = 7200) { // 2 horas
        if (!this.isAvailable()) return false;
        
        try {
            const cacheKey = `openai:${promptHash}`;
            await this.client.setEx(cacheKey, ttl, JSON.stringify(respuesta));
            
            logInfo('CacheService', 'Respuesta OpenAI guardada en caché', { promptHash, ttl });
            return true;
            
        } catch (error) {
            logError('CacheService', 'Error guardando respuesta OpenAI en caché', { promptHash, error });
            return false;
        }
    }
    
    /**
     * Genera hash simple para cachear prompts similares
     */
    generarHashPrompt(texto) {
        return require('crypto')
            .createHash('md5')
            .update(texto.toLowerCase().trim())
            .digest('hex')
            .substring(0, 16);
    }
    
    /**
     * Obtiene estadísticas del caché
     */
    async obtenerEstadisticas() {
        if (!this.isAvailable()) {
            return {
                disponible: false,
                conexion: false
            };
        }
        
        try {
            const info = await this.client.info('memory');
            const keys = await this.client.dbSize();
            
            return {
                disponible: true,
                conexion: this.isConnected,
                totalKeys: keys,
                memoria: info
            };
            
        } catch (error) {
            logError('CacheService', 'Error obteniendo estadísticas', { error });
            return {
                disponible: false,
                conexion: false,
                error: error.message
            };
        }
    }
    
    /**
     * Limpia todo el caché (usar con precaución)
     */
    async limpiarTodo() {
        if (!this.isAvailable()) return false;
        
        try {
            await this.client.flushDb();
            logInfo('CacheService', 'Caché completamente limpiado');
            return true;
            
        } catch (error) {
            logError('CacheService', 'Error limpiando caché', { error });
            return false;
        }
    }
    
    /**
     * Cierra la conexión Redis
     */
    async cerrarConexion() {
        if (this.client) {
            await this.client.quit();
            this.isConnected = false;
            logInfo('CacheService', 'Conexión Redis cerrada correctamente');
        }
    }
}

// Singleton para reutilizar la instancia
let cacheServiceInstance = null;

function getCacheService() {
    if (!cacheServiceInstance) {
        cacheServiceInstance = new CacheService();
    }
    return cacheServiceInstance;
}

module.exports = {
    CacheService,
    getCacheService
};