const { marcarPagado: marcarPagadoDB } = require('./dbAPI');

async function marcarPagado(userId) {
    try {
        const resultado = await marcarPagadoDB(userId);
        console.log("✅ Respuesta de marcarPagado:", resultado);
        return resultado;
    } catch (error) {
        console.error("❌ Error marcando como pagado:", error);
        return { success: false, error: error.message };
    }
}

module.exports = { marcarPagado };
