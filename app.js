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
        const resultControl = await manejarControlBot(message);
        if (resultControl) return res.json(resultControl);

        if (message.type === "image") {
            return await procesarImagen(message, res);
        }

        if (message.type === "text") {
            return await procesarTexto(message, res);
        }

        return res.json({ success: true, mensaje: "Mensaje ignorado (no es texto ni imagen procesable)." });
    } catch (error) {
        console.error("Error general en /soporte:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/verificar-media/:id', async (req, res) => {
    const mediaId = req.params.id;
    const url = `https://gate.whapi.cloud/media/${mediaId}`;
    const token = process.env.WHAPI_KEY;

    try {
        const r = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!r.ok) {
            const error = await r.text();
            return res.status(r.status).send("❌ No disponible aún: " + error);
        }

        return res.status(200).send("✅ ¡La imagen está disponible y lista para descargar!");
    } catch (e) {
        res.status(500).send("🛑 Error al consultar la imagen: " + e.message);
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor escuchando en puerto", PORT);
});
