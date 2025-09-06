const { Pool } = require('pg');

// Validar variables de entorno críticas
const requiredEnvVars = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.warn(`⚠️ Variables de entorno faltantes para DB: ${missingVars.join(', ')}`);
    console.warn('📝 Usando valores por defecto para desarrollo. Configure las variables para producción.');
}

const pool = new Pool({
    host: process.env.DB_HOST || 'app-2f5bcc3a-7a70-446d-a9ae-423f916b4d92-do-user-19197755-0.f.db.ondigitalocean.com',
    port: parseInt(process.env.DB_PORT) || 25060,
    user: process.env.DB_USER || 'bot-bsl-db',
    password: process.env.DB_PASSWORD, // Required - must be set in environment
    database: process.env.DB_NAME || 'bot-bsl-db',
    ssl: { rejectUnauthorized: false },
    // Configuración optimizada del pool
    max: parseInt(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000
});

// Crear tablas e índices optimizados
async function initializeDatabase() {
    try {
        // Crear tabla conversaciones con índices optimizados
        await pool.query(`
            CREATE TABLE IF NOT EXISTS conversaciones (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(50) UNIQUE NOT NULL,
                nombre VARCHAR(100),
                mensajes JSONB DEFAULT '[]'::jsonb,
                observaciones VARCHAR(255) DEFAULT '',
                fase VARCHAR(50) DEFAULT 'inicial',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Crear índices para optimizar consultas frecuentes
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_conversaciones_user_id ON conversaciones(user_id);
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_conversaciones_fase ON conversaciones(fase);
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_conversaciones_observaciones ON conversaciones(observaciones) 
            WHERE observaciones IS NOT NULL AND observaciones != '';
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_conversaciones_updated_at ON conversaciones(updated_at);
        `);
        
        // Crear tabla pacientes con índices
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pacientes (
                id SERIAL PRIMARY KEY,
                cedula VARCHAR(20) UNIQUE NOT NULL,
                nombre VARCHAR(100),
                telefono VARCHAR(20),
                pagado BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Índices para tabla pacientes
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_pacientes_cedula ON pacientes(cedula);
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_pacientes_pagado ON pacientes(pagado);
        `);
        
        // Función para actualizar timestamp automáticamente
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql';
        `);
        
        // Triggers para actualización automática de timestamps
        await pool.query(`
            DROP TRIGGER IF EXISTS update_conversaciones_updated_at ON conversaciones;
            CREATE TRIGGER update_conversaciones_updated_at 
                BEFORE UPDATE ON conversaciones 
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `);
        
        await pool.query(`
            DROP TRIGGER IF EXISTS update_pacientes_updated_at ON pacientes;
            CREATE TRIGGER update_pacientes_updated_at 
                BEFORE UPDATE ON pacientes 
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `);
        
        console.log('✅ Base de datos PostgreSQL inicializada correctamente con índices optimizados');
    } catch (err) {
        console.error('❌ Error inicializando base de datos:', err);
    }
}

// Guardar conversación
async function guardarConversacionEnDB({ userId, nombre, mensajes, fase = "inicial" }) {
    try {
        const query = `
            INSERT INTO conversaciones (user_id, nombre, mensajes, fase, updated_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                nombre = $2,
                mensajes = $3,
                fase = $4,
                updated_at = CURRENT_TIMESTAMP
        `;
        
        await pool.query(query, [userId, nombre, JSON.stringify(mensajes), fase]);
        console.log("✅ Conversación guardada en PostgreSQL:", { userId, fase });
    } catch (err) {
        console.error("❌ Error guardando conversación en PostgreSQL:", err);
    }
}

// Obtener conversación con paginación optimizada (usa índice user_id)
async function obtenerConversacionDeDB(userId, limit = 50) {
    try {
        // Query optimizada usando índice idx_conversaciones_user_id
        const query = `
            SELECT mensajes, observaciones, fase, updated_at 
            FROM conversaciones 
            WHERE user_id = $1
        `;
        const result = await pool.query(query, [userId]);
        
        if (result.rows.length === 0) {
            return { mensajes: [], observaciones: "", fase: "inicial", totalMensajes: 0 };
        }
        
        const row = result.rows[0];
        const mensajesCompletos = row.mensajes || [];
        
        // Aplicar paginación - tomar solo los últimos N mensajes
        const mensajesPaginados = limit > 0 && mensajesCompletos.length > limit
            ? mensajesCompletos.slice(-limit)
            : mensajesCompletos;
        
        return {
            mensajes: mensajesPaginados,
            observaciones: row.observaciones || "",
            fase: row.fase || "inicial",
            totalMensajes: mensajesCompletos.length,
            truncated: mensajesCompletos.length > limit,
            ultimaActualizacion: row.updated_at
        };
    } catch (err) {
        console.error("❌ Error obteniendo conversación de PostgreSQL:", err);
        return { mensajes: [], observaciones: "", fase: "inicial", totalMensajes: 0 };
    }
}

// Obtener conversación completa (sin paginación) para casos especiales
async function obtenerConversacionCompletaDeDB(userId) {
    return await obtenerConversacionDeDB(userId, -1); // -1 = sin límite
}

// Actualizar observaciones
async function actualizarObservaciones(userId, observaciones) {
    try {
        const query = `
            INSERT INTO conversaciones (user_id, observaciones, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                observaciones = $2,
                updated_at = CURRENT_TIMESTAMP
        `;
        
        await pool.query(query, [userId, observaciones]);
        console.log("✅ Observaciones actualizadas en PostgreSQL:", { userId, observaciones });
        return { success: true };
    } catch (err) {
        console.error("❌ Error actualizando observaciones en PostgreSQL:", err);
        return { success: false, error: err.message };
    }
}

// Consultar información del paciente
async function consultarInformacionPaciente(cedula) {
    try {
        const query = 'SELECT * FROM pacientes WHERE cedula = $1';
        const result = await pool.query(query, [cedula]);
        
        if (result.rows.length === 0) {
            return { success: false, message: "Paciente no encontrado" };
        }
        
        const paciente = result.rows[0];
        return {
            success: true,
            data: {
                cedula: paciente.cedula,
                nombre: paciente.nombre,
                telefono: paciente.telefono,
                pagado: paciente.pagado
            }
        };
    } catch (err) {
        console.error("❌ Error consultando paciente en PostgreSQL:", err);
        return { success: false, error: err.message };
    }
}

// Marcar como pagado
async function marcarPagado(cedula) {
    try {
        const query = `
            UPDATE pacientes 
            SET pagado = TRUE, updated_at = CURRENT_TIMESTAMP 
            WHERE cedula = $1
        `;
        
        const result = await pool.query(query, [cedula]);
        
        if (result.rowCount === 0) {
            // Si no existe el paciente, crearlo como pagado
            const insertQuery = `
                INSERT INTO pacientes (cedula, pagado, created_at, updated_at)
                VALUES ($1, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;
            await pool.query(insertQuery, [cedula]);
        }
        
        console.log("✅ Paciente marcado como pagado en PostgreSQL:", cedula);
        return { success: true };
    } catch (err) {
        console.error("❌ Error marcando como pagado en PostgreSQL:", err);
        return { success: false, error: err.message };
    }
}

// Inicializar la base de datos al cargar el módulo
initializeDatabase();

module.exports = {
    guardarConversacionEnDB,
    obtenerConversacionDeDB,
    obtenerConversacionCompletaDeDB,
    actualizarObservaciones,
    consultarInformacionPaciente,
    marcarPagado,
    pool
};