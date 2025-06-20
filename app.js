require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json({ limit: '10mb' }));

const { manejarControlBot } = require('./handlers/controlBot');
const { procesarImagen } = require('./handlers/procesarImagen');
const { procesarTexto } = require('./handlers/procesarTexto');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('./utils/wixAPI');

// 🔁 Evitar mensajes repetidos
function limpiarDuplicados(historial) {
    const vistos = new Set();
    return historial.filter(m => {
        const clave = `${m.from}|${m.mensaje}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
    });
}

const BOT_NUMBER = "573008021701"; // tu número de bot/admin

function identificarActor(message) {
    if (message.from !== BOT_NUMBER) return "usuario";
    // Aquí ambos bot y admin son from_me===true y from==BOT_NUMBER
    // Pero el bot tiene source: "api"
    // El admin tiene source: "web" o "mobile"
    if (message.from_me === true) {
        if (message.source === "api") return "sistema"; // Respuesta automática del bot
        if (message.source === "web" || message.source === "mobile") return "admin"; // Manual desde WhatsApp
    }
    return "usuario"; // fallback
}

app.post('/soporte', async (req, res) => {
    try {
        const body = req.body;
        if (!body || !body.messages || !Array.isArray(body.messages)) {
            return res.status(400).json({ success: false, error: "No hay mensajes en el payload." });
        }
        const message = body.messages[0];
        const from = message.from;
        const chatId = message.chat_id;
        const texto = message.text?.body?.trim() || "";
        const nombre = message.from_name || "Administrador";
        const userId = (chatId || from)?.replace("@s.whatsapp.net", "");
        const resultControl = await manejarControlBot(message);
        if (resultControl?.detuvoBot) {
            return res.json(resultControl); // ⬅️ DETIENE AQUÍ si aplica stop
        }

        const actor = identificarActor(message);

        // SISTEMA (bot automático)
        if (actor === "sistema") {
            const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
            const historialLimpio = limpiarDuplicados(historial);
            const ultimoSistema = [...historialLimpio].reverse().find(m => m.from === "sistema");
            if (ultimoSistema && ultimoSistema.mensaje === texto) {
                console.log("🟡 Ignorando mensaje duplicado del bot:", texto);
                return res.json({ success: true, mensaje: "Mensaje duplicado ignorado." });
            }
            const nuevoHistorial = limpiarDuplicados([
                ...historialLimpio,
                {
                    from: "sistema",
                    mensaje: texto,
                    timestamp: new Date().toISOString()
                }
            ]);
            await guardarConversacionEnWix({ userId, nombre, mensajes: nuevoHistorial });
            return res.json({ success: true, mensaje: "Mensaje del sistema guardado." });
        }

        // ADMIN (respuesta manual desde WhatsApp web/mobile)
        if (actor === "admin") {
            // Permitir texto y link_preview del admin
            if (message.type === "text" || message.type === "link_preview") {
                const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
                const historialLimpio = limpiarDuplicados(historial);
                const ultimoAdmin = [...historialLimpio].reverse().find(m => m.from === "admin");
                if (ultimoAdmin && ultimoAdmin.mensaje === texto) {
                    console.log("🟡 Ignorando mensaje duplicado del admin:", texto);
                    return res.json({ success: true, mensaje: "Mensaje duplicado ignorado." });
                }
                const nuevoHistorial = limpiarDuplicados([
                    ...historialLimpio,
                    {
                        from: "admin",
                        mensaje: texto,
                        timestamp: new Date().toISOString(),
                        tipo: "manual"
                    }
                ]);
                await guardarConversacionEnWix({ userId, nombre, mensajes: nuevoHistorial });
                console.log(`[ADMIN] Mensaje guardado: "${texto}" para ${userId}`);
                return res.json({ success: true, mensaje: "Mensaje de admin guardado." });
            }
            // Si no es texto ni link_preview, simplemente ignorar:
            return res.json({ success: true, mensaje: "Mensaje de admin no relevante (tipo no soportado)." });
        }


        // USUARIO (otro número)
        if (actor === "usuario") {
            // Imagen recibida
            if (message.type === "image") {
                return await procesarImagen(message, res);
            }
            // Texto recibido
            if (message.type === "text") {
                return await procesarTexto(message, res);
            }
        }

        return res.json({ success: true, mensaje: "Mensaje ignorado." });

    } catch (error) {
        console.error("Error general en /soporte:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});


app.post('/api/guardarMensaje', async (req, res) => {
    try {
        const { userId, nombre, mensaje, from = "sistema", timestamp } = req.body;
        if (!userId || !mensaje) {
            return res.status(400).json({ success: false, error: "userId y mensaje son obligatorios" });
        }
        // Obtén el historial actual
        const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
        // Agrega el nuevo mensaje
        const nuevoHistorial = [
            ...historial,
            {
                from,
                mensaje,
                timestamp: timestamp || new Date().toISOString()
            }
        ];
        await guardarConversacionEnWix({ userId, nombre, mensajes: nuevoHistorial });
        return res.json({ success: true, mensaje: "Mensaje registrado correctamente." });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor escuchando en puerto", PORT);
});
