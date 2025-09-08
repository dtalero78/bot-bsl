async function marcarPagado(cedula) {
    try {
        console.log("🔄 Marcando como pagado en Wix:", cedula);
        
        const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
        
        // Llamar a la función HTTP de Wix
        const response = await fetch('https://www.bsl.com.co/_functions/marcarPagado', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: cedula,
                observaciones: "pagado"
            })
        });
        
        const resultado = await response.json();
        
        if (response.ok && resultado.success) {
            console.log("✅ Marcado como pagado en Wix exitosamente:", cedula);
            return { success: true };
        } else {
            console.log("❌ Error marcando en Wix:", resultado);
            return { success: false, error: resultado.error || "Error desconocido" };
        }
        
    } catch (error) {
        console.error("❌ Error conectando con Wix:", error);
        return { success: false, error: error.message };
    }
}

module.exports = { marcarPagado };
