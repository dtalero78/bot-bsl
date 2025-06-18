require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json({ limit: '10mb' }));

const { manejarControlBot } = require('./handlers/controlBot');
const { procesarImagen } = require('./handlers/procesarImagen');
const { procesarTexto } = require('./handlers/procesarTexto');

app.post('/soporte', async (req, res) => {
    try {
        const body = req.body;
        console.log("Payload recibido:", JSON.stringify(body, null, 2));

        if (!body || !body.messages || !Array.isArray(body.messages)) {
            return res.status(400).json({ success: false, error: "No hay mensajes en el payload." });
        }

        const message = body.messages[0];

        // 🟡 Mensaje enviado por el admin
        if (message.from_me === true && message.type === "text") {
            const userId = message.chat_id.replace("@s.whatsapp.net", "");
            const texto = message.text.body.trim();
            const nombre = message.from_name || "Administrador";

            const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
            const historialLimpio = limpiarDuplicados(historial);

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
        }

        // 🔵 Control del bot: stop / start
        const resultControl = await manejarControlBot(message);
        if (resultControl?.detuvoBot) {
            console.log("[BOT] Se detuvo el bot, no se procesa texto.");
            return res.json(resultControl);
        }

        // 🟠 Procesar imagen
        if (message.type === "image") {
            return await procesarImagen(message, res);
        }

        // 🟢 Procesar texto del usuario
        if (message.type === "text") {
            return await procesarTexto(message, res);
        }

        // Otro tipo no procesado
        return res.json({ success: true, mensaje: "Mensaje ignorado (no es texto ni imagen procesable)." });

    } catch (error) {
        console.error("Error general en /soporte:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor escuchando en puerto", PORT);
});
