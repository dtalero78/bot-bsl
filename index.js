


require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json({ limit: '10mb' }));

const OPENAI_KEY = process.env.OPENAI_KEY;
const WHAPI_KEY = process.env.WHAPI_KEY;
const BOT_NUMBER = "573008021701";
const API2PDF_KEY = process.env.API2PDF_KEY;

const promptInstitucional = `
Eres un asistente virtual para exámenes médicos ocupacionales de la empresa BSL en Colombia...
- Si el usuario saluda o se despide puedes saludar o despedirte de parte de BSL.


INFORMACIÓN INSTITUCIONAL:

1. Exámenes Ocupacionales:
  - Virtual: $46.000 COP
    - Pasos:
        - Escoge la hora
        - Realiza las pruebas en línea
        - El médico te contactará
        - Paga y descarga tu certificado al instante.

    ¿Que incluye?: Médico Osteomuscular, Audiometría, Optometría.

    - Extras disponibles (pueden tener costo adicional):
      - Cardiovascular ($5.000), Vascular ($5.000), Espirometría ($5.000), Psicológico ($15.000), Dermatológico ($5.000), Perfil lipídico y otros laboratorios.
   - Para crear la orden hay que diligenciar el siguiente link: https://www.bsl.com.co/nuevaorden-1

  - Presencial: $69.000 COP
    - Lugar: Calle 134 No. 7-83, Bogotá.
    - Horario: Lunes a Viernes 7:30 AM - 4:30 PM, Sábados 8:00 AM - 11:30 AM.
    - No necesita agendar, es por orden de llegada.
    - Incluye lo mismo que el virtual.

2. Pagos y descarga de certificados:
  - Bancolombia: Cta Ahorros 44291192456, cédula 79981585
  - Daviplata: 3014400818
  - Nequi: 3008021701
  - Se recibe Transfiya

3. Incluido en el certificado básico:
  - Médico Osteomuscular
  - Audiometría
  - Optometría o Visiometría

5. Extras opcionales:
  - Cardiovascular ($5.000)
  - Vascular ($5.000)
  - Espirometría ($5.000)
  - Psicológico ($15.000)
  - Dermatológico ($5.000)
  - Perfil lipídico (60.000)
  - Glicemia (20.000)

INDICACIONES ADICIONALES:

- Si el usuario pregunta temas que no están relacionados con nuestro servicio, di que eres un asistente de BSL y no puedes responder otras cosas.
- No uses formato tipo [texto](url). Escribe solo la URL como texto.
- Resume las respuestas lo más que puedas y cuando vayas a responder varios puntos sepáralo con viñetas lo más simplificado posible.
- La mayoría de los usuarios son personas que saben leer muy poco. Debes simplificar tus respuestas.
- Si el usuario pide perfil lipídico, glicemia u otros laboratorios, dile que puede hacer el osteomuscular, visual y auditivo virtual y los laboratorios presenciales para adjuntarlos después. También sirve si ya tiene unos laboratorios hechos. Se pueden agregar.
- Si necesita prueba psicosensométrica, es obligatorio presencial.
- Si el usuario necesita descargar un certificado lo puede hacer desde: www.bsl.com.co/descargar

📅 CONSULTA DE CITA:


"Claro, para ayudarte necesito tu número de documento. Por favor escríbelo."

- Si el número ya fue enviado antes en la conversación, úsalo directamente para consultar en la base de datos y entrega la respuesta con los datos encontrados.


🔴 DETENCIÓN DEL BOT:

- Si el usuario dice que quiere hablar con un asesor, o pide ayuda de una persona, **escribe internamente la frase especial exacta: "...transfiriendo con asesor"** SIN NINGUN PUNTO AL FINAL. Eso hará que el sistema detenga el bot.
- Después de analizar una imagen enviada por el usuario, **responde normalmente con el análisis** y luego **escribe también la frase: "...transfiriendo con asesor"** para detener el bot tras la respuesta.

📌 DETECCIÓN AUTOMÁTICA DE CONSULTAS:

- Si el usuario pregunta por la fecha de su consulta médica, debes responder con: 
  ConsultaCita(numeroId)
  donde "numeroId" es el número de documento del paciente si ya lo tienes, o la palabra "pendiente" si necesitas que lo escriba.

Ejemplos:
- Si el usuario pregunta "¿cuándo es mi cita?" y ya sabes su documento: escribe exactamente → ConsultaCita(12345678)
- Si no tienes el número de documento, escribe exactamente → ConsultaCita(pendiente)

`;

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

async function sendMessage(to, body) {
    const url = "https://gate.whapi.cloud/messages/text";
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WHAPI_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ to, body })
    });
    const json = await resp.json();
    console.log("Respuesta envío WhatsApp:", JSON.stringify(json, null, 2));
}

async function sendPdf(to, pdfUrl) {
    const url = "https://gate.whapi.cloud/messages/document";
    const body = {
        to: to,
        media: {
            url: pdfUrl,
            caption: "Aquí tienes tu certificado médico en PDF."
        }
    };
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WHAPI_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const json = await resp.json();
    console.log("Respuesta Whapi (PDF):", JSON.stringify(json, null, 2));
}

async function generarPdfDesdeApi2Pdf(documento) {
    const apiEndpoint = 'https://v2018.api2pdf.com/chrome/url';
    const url = `https://www.bsl.com.co/descarga-whp/${documento}`;

    const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': API2PDF_KEY
        },
        body: JSON.stringify({
            url,
            inlinePdf: false,
            fileName: `${documento}.pdf`
        })
    });

    const json = await response.json();
    if (!json.success) {
        throw new Error(json.error);
    }

    return json.pdf;
}

app.post('/soporte', async (req, res) => {
    try {
        const body = req.body;
        const message = body?.messages?.[0];
        if (!message) return res.status(400).json({ success: false, error: "No hay mensajes." });

        if (message.from_me || message.from === BOT_NUMBER) {
            return res.json({ success: true, mensaje: "Mensaje del bot ignorado." });
        }

        const from = message.from;
        const nombre = message.from_name || "Desconocido";
        const tipo = message.type;
        const chatId = message.chat_id;
        const to = chatId || `${from}@s.whatsapp.net`;

        const { mensajes: historial = [], observaciones = "" } = await obtenerConversacionDeWix(from);
        if (String(observaciones).toLowerCase().includes("stop")) {
            return res.json({ success: true, mensaje: "Bot detenido para este usuario." });
        }

        if (tipo === "image" && message.image?.id) {
            const imageId = message.image.id;
            const mimeType = message.image.mime_type || "image/jpeg";
            const urlImg = `https://gate.whapi.cloud/media/${imageId}`;
            const whapiRes = await fetch(urlImg, {
                method: 'GET',
                headers: { "Authorization": `Bearer ${WHAPI_KEY}` }
            });
            const buffer = await whapiRes.buffer();
            const base64Image = buffer.toString('base64');

            const prompt = "Extrae SOLO el valor pagado (valor de la transferencia en pesos colombianos)...";
            const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                        ]
                    }],
                    max_tokens: 50
                })
            });

            const openaiJson = await aiRes.json();
            let resultado = openaiJson.choices?.[0]?.message?.content || "No se detectó valor.";
            const pagoValido = resultado.replace(/[^0-9]/g, '') === "46000";

            const nuevoHistorial = [
                ...historial,
                { from: "usuario", mensaje: "(comprobante)", timestamp: new Date().toISOString() },
                { from: "sistema", mensaje: `Valor detectado: $${resultado}`, timestamp: new Date().toISOString() }
            ];
            await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });

            if (pagoValido) {
                await sendMessage(to, "✅ Pago recibido por $46.000. Por favor responde con tu número de documento.");
            } else {
                await sendMessage(to, `⚠️ Detectamos un valor diferente: $${resultado}. Por favor revisa y vuelve a enviar el comprobante.`);
            }

            return res.json({ success: true, valorDetectado: resultado });
        }

        if (tipo === "text" && message.text?.body) {
            const userMessage = message.text.body.trim();
            const esNumeroId = /^\d{7,10}$/.test(userMessage);
            const pagoRegistrado = historial.some(m => m.mensaje.includes("Valor detectado: $46.000"));

            if (esNumeroId && pagoRegistrado) {
                try {
                    const pdfUrl = await generarPdfDesdeApi2Pdf(userMessage);
                    await sendPdf(to, pdfUrl);
                    const nuevoHistorial = [
                        ...historial,
                        { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() },
                        { from: "sistema", mensaje: `Certificado enviado: ${pdfUrl}`, timestamp: new Date().toISOString() }
                    ];
                    await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });
                    return res.json({ success: true, mensaje: "Certificado enviado correctamente." });
                } catch (err) {
                    await sendMessage(to, "❌ No pudimos generar tu certificado. Intenta más tarde.");
                    return res.status(500).json({ success: false, error: err.message });
                }
            }

            await sendMessage(to, "🧠 Mensaje recibido. Estoy procesando tu solicitud.");
            return res.json({ success: true, mensaje: "Texto procesado (sin acción PDF)." });
        }

        return res.json({ success: true, mensaje: "Mensaje no procesable." });
    } catch (error) {
        console.error("Error en /soporte:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor escuchando en puerto", PORT);
});
