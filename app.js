// ✅ app.js corregido

require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json({ limit: '10mb' }));

const { manejarControlBot } = require('./handlers/controlBot');
const { procesarImagen } = require('./handlers/procesarImagen');
const { procesarTexto } = require('./handlers/procesarTexto');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('./utils/wixAPI');

function limpiarDuplicados(historial) {
    const vistos = new Set();
    return historial.filter(m => {
        const clave = `${m.from}|${m.mensaje}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
    });
}

app.post('/soporte', async (req, res) => {
    try {
        const body = req.body;
        console.log("Payload recibido:", JSON.stringify(body, null, 2));

        if (!body || !body.messages || !Array.isArray(body.messages)) {
            return res.status(400).json({ success: false, error: "No hay mensajes en el payload." });
        }

        const message = body.messages[0];

        const from = message.from;
        const chatId = message.chat_id;
        const texto = message.text?.body?.trim() || "";
        const nombre = message.from_name || "Administrador";
        const userId = (chatId || from)?.replace("@s.whatsapp.net", "");

        // 🟡 Si lo escribe el admin
        if (message.from_me === true && message.type === "text") {
            const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
            const historialLimpio = limpiarDuplicados(historial);

            // ✅ IGNORAR si el mensaje ya fue enviado por el sistema justo antes
            const ultimoSistema = [...historialLimpio].reverse().find(m => m.from === "sistema");
            if (ultimoSistema && ultimoSistema.mensaje === texto) {
                console.log("🟡 Ignorando mensaje duplicado del bot:", texto);
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

            // Si el mensaje contiene "transfiriendo con asesor", activa stop
            if (texto.toLowerCase().includes("transfiriendo con asesor")) {
                await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, observaciones: "stop" })
                });
                console.log(`[ADMIN] Activado STOP para ${userId}`);
            }

            return res.json({ success: true, mensaje: "Mensaje de admin procesado." });
        }


        const resultControl = await manejarControlBot(message);
        if (resultControl?.detuvoBot) {
            return res.json(resultControl);
        }

        if (message.type === "image") {
            return await procesarImagen(message, res);
        }

        if (message.type === "text") {
            return await procesarTexto(message, res);
        }

        return res.json({ success: true, mensaje: "Mensaje ignorado." });

    } catch (error) {
        console.error("Error general en /soporte:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor escuchando en puerto", PORT);
});
