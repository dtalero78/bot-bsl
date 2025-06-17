const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function guardarConversacionEnWix({ userId, nombre, mensajes }) {
    try {
        const resp = await fetch('https://www.bsl.com.co/_functions/guardarConversacion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, nombre, mensajes })
        });
        const text = await resp.text();
        try {
            const json = JSON.parse(text);
            console.log("Conversación guardada en Wix:", json);
        } catch {
            console.error("Respuesta de Wix NO es JSON:", text);
        }
    } catch (err) {
        console.error("Error guardando conversación en Wix:", err);
    }
}

async function obtenerConversacionDeWix(userId) {
    try {
        const resp = await fetch(`https://www.bsl.com.co/_functions/obtenerConversacion?userId=${encodeURIComponent(userId)}`);
        if (!resp.ok) return { mensajes: [], observaciones: "" };

        const json = await resp.json();
        return {
            mensajes: json.mensajes || [],
            observaciones: json.observaciones || ""
        };
    } catch (err) {
        console.error("Error obteniendo historial de Wix:", err);
        return { mensajes: [], observaciones: "" };
    }
}

module.exports = { guardarConversacionEnWix, obtenerConversacionDeWix };
