/**
 * Configuración centralizada de variables de entorno
 * Valida y proporciona valores por defecto seguros
 */

// Variables de entorno requeridas para producción
const REQUIRED_PRODUCTION_VARS = [
    'OPENAI_KEY',
    'WHAPI_KEY',
    'DB_HOST',
    'DB_PORT', 
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
];

// Variables opcionales con valores por defecto
const OPTIONAL_VARS = {
    PORT: 3000,
    NODE_ENV: 'development',
    API2PDF_KEY: null,
    DB_POOL_MAX: 20,
    DB_IDLE_TIMEOUT: 30000,
    DB_CONNECTION_TIMEOUT: 2000
};

/**
 * Valida que las variables de entorno críticas estén configuradas
 * @param {boolean} isProduction - Si estamos en entorno de producción
 * @returns {Array} - Lista de variables faltantes
 */
function validateEnvironment(isProduction = false) {
    const missingVars = [];
    
    // Validar variables críticas siempre
    const criticalVars = ['OPENAI_KEY', 'WHAPI_KEY'];
    criticalVars.forEach(varName => {
        if (!process.env[varName]) {
            missingVars.push(varName);
        }
    });
    
    // En producción, validar base de datos (DATABASE_URL o variables individuales)
    if (isProduction) {
        const hasDatabase_URL = process.env.DATABASE_URL;
        const hasIndividualVars = process.env.DB_HOST && process.env.DB_PORT && 
                                  process.env.DB_USER && process.env.DB_PASSWORD && 
                                  process.env.DB_NAME;
        
        if (!hasDatabase_URL && !hasIndividualVars) {
            if (!hasDatabase_URL) {
                missingVars.push('DATABASE_URL o variables DB individuales');
            }
        }
    }
    
    return missingVars;
}

/**
 * Obtiene el valor de una variable de entorno con valor por defecto
 * @param {string} key - Nombre de la variable
 * @param {*} defaultValue - Valor por defecto
 * @param {string} type - Tipo de dato esperado ('string', 'number', 'boolean')
 * @returns {*} - Valor procesado
 */
function getEnvVar(key, defaultValue = null, type = 'string') {
    const value = process.env[key];
    
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    
    switch (type) {
        case 'number':
            const parsed = parseInt(value, 10);
            return isNaN(parsed) ? defaultValue : parsed;
        
        case 'boolean':
            return value.toLowerCase() === 'true';
        
        case 'string':
        default:
            return value;
    }
}

// Configuración de la aplicación
const config = {
    // Configuración del servidor
    server: {
        port: getEnvVar('PORT', OPTIONAL_VARS.PORT, 'number'),
        environment: getEnvVar('NODE_ENV', OPTIONAL_VARS.NODE_ENV)
    },
    
    // APIs externas
    apis: {
        openai: {
            key: getEnvVar('OPENAI_KEY'),
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o'
        },
        whapi: {
            key: getEnvVar('WHAPI_KEY'),
            baseUrl: 'https://gate.whapi.cloud'
        },
        api2pdf: {
            key: getEnvVar('API2PDF_KEY'),
            baseUrl: 'https://v2018.api2pdf.com/chrome/url'
        }
    },
    
    // Base de datos - soporta DATABASE_URL o variables individuales
    database: {
        url: getEnvVar('DATABASE_URL'), // Digital Ocean proporciona esta variable
        host: getEnvVar('DB_HOST', 'app-2f5bcc3a-7a70-446d-a9ae-423f916b4d92-do-user-19197755-0.f.db.ondigitalocean.com'),
        port: getEnvVar('DB_PORT', 25060, 'number'),
        user: getEnvVar('DB_USER', 'bot-bsl-db'),
        password: getEnvVar('DB_PASSWORD', '', 'string', true), // Required - no default
        name: getEnvVar('DB_NAME', 'bot-bsl-db'),
        pool: {
            max: getEnvVar('DB_POOL_MAX', OPTIONAL_VARS.DB_POOL_MAX, 'number'),
            idleTimeoutMillis: getEnvVar('DB_IDLE_TIMEOUT', OPTIONAL_VARS.DB_IDLE_TIMEOUT, 'number'),
            connectionTimeoutMillis: getEnvVar('DB_CONNECTION_TIMEOUT', OPTIONAL_VARS.DB_CONNECTION_TIMEOUT, 'number')
        },
        ssl: { rejectUnauthorized: false }
    },
    
    // Configuración del bot
    bot: {
        number: "573008021701",
        frasesDetencion: [
            "...transfiriendo con asesor",
            "...transfiriendo con asesor."
        ],
        palabrasClaveStop: ["foundever", "ttec", "evertec", "rippling", "egreso"],
        fraseReactivacion: "...te dejo con el bot 🤖"
    },
    
    // Configuración de Redis (caché)
    redis: {
        url: getEnvVar('REDIS_URL', 'redis://localhost:6379'),
        enabled: getEnvVar('REDIS_ENABLED', true, 'boolean'),
        ttl: getEnvVar('REDIS_TTL', 3600, 'number') // 1 hora por defecto
    },
    
    // Configuración de logging
    logging: {
        level: getEnvVar('LOG_LEVEL', 'info'),
        enableConsole: getEnvVar('LOG_CONSOLE', true, 'boolean'),
        enableFile: getEnvVar('LOG_FILE', false, 'boolean')
    }
};

// Validar configuración al cargar el módulo
const isProduction = config.server.environment === 'production';
const missingVars = validateEnvironment(isProduction);

if (missingVars.length > 0) {
    if (isProduction) {
        console.error(`❌ Variables de entorno críticas faltantes en producción: ${missingVars.join(', ')}`);
        process.exit(1);
    } else {
        console.warn(`⚠️ Variables de entorno faltantes: ${missingVars.join(', ')}`);
        console.warn('📝 Usando valores por defecto para desarrollo.');
    }
}

// Log de configuración (sin mostrar credenciales) - Updated for new OpenAI key
console.log('🔧 Configuración cargada:', {
    environment: config.server.environment,
    port: config.server.port,
    database: {
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        name: config.database.name
    },
    apis: {
        openai: !!config.apis.openai.key,
        whapi: !!config.apis.whapi.key,
        api2pdf: !!config.apis.api2pdf.key
    }
});

module.exports = {
    config,
    validateEnvironment,
    getEnvVar,
    REQUIRED_PRODUCTION_VARS
};