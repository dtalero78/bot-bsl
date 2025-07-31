const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');

// Función para clasificar la imagen usando OpenAI
async function clasificarImagen(base64Image, mimeType) {
    const prompt = `Clasifica esta imagen en UNA de estas categorías y responde SOLO la etiqueta:
• comprobante_pago (transferencias bancarias, recibos de pago, capturas de Nequi, Daviplata, etc.)
• listado_examenes (órdenes médicas, listas de exámenes solicitados)
• confirmacion_cita (capturas de agendamiento, confirmaciones de citas médicas)
• documento_identidad (cédula, pasaporte, documentos de identificación)
• otro (cualquier otra imagen)

Responde únicamente la etiqueta correspondiente.`;

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
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
                max_tokens: 10
            })
        });

        const result = await response.json();
        return result.choices?.[0]?.message?.content?.trim().toLowerCase() || "otro";
    } catch (error) {
        console.error("Error clasificando imagen:", error);
        return "otro";
    }
}

// Función para extraer valor de comprobante de pago
async function extraerValorPago(base64Image, mimeType) {
    const prompt = "Extrae SOLO el valor pagado (valor de la transferencia en pesos colombianos) que aparece en este comprobante bancario. Responde solo el valor exacto, sin explicaciones, ni símbolos adicionales.";

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
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

        const result = await response.json();
        return result.choices?.[0]?.message?.content?.trim() || "No detectado";
    } catch (error) {
        console.error("Error extrayendo valor:", error);
        return "Error al procesar";
    }
}

// Función para extraer información de listado de exámenes
async function analizarListadoExamenes(base64Image, mimeType) {
    const prompt = `Analiza esta imagen de una orden médica o listado de exámenes y extrae:
1. Tipo de exámenes solicitados
2. Si menciona "ocupacional" o "preocupacional"
3. Empresa o entidad que solicita
4. Cualquier información relevante

Responde de forma concisa y organizada.`;

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
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
                max_tokens: 200
            })
        });

        const result = await response.json();
        return result.choices?.[0]?.message?.content?.trim() || "No se pudo analizar el listado";
    } catch (error) {
        console.error("Error analizando listado:", error);
        return "Error al analizar el listado";
    }
}

async function procesarImagen(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;

    // ✅ Ignorar si la imagen fue enviada por el admin o el bot
    const BOT_NUMBER = "573008021701";
    if (message.from_me === true || message.from === BOT_NUMBER) {
        console.log("📷 Imagen ignorada: fue enviada por el admin o el bot.");
        return res.json({ success: true, mensaje: "Imagen del admin ignorada." });
    }

    // ✅ Verificación de observaciones para STOP
    const { observaciones = "" } = await obtenerConversacionDeWix(from);
    if (String(observaciones).toLowerCase().includes("stop")) {
        console.log(`[STOP] Usuario bloqueado por observaciones: ${from}`);
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones (silencioso)." });
    }

    const imageId = message.image?.id;
    const mimeType = message.image?.mime_type || "image/jpeg";
    const urlImg = `https://gate.whapi.cloud/media/${imageId}`;

    await sendMessage(to, "🔍 Un momento por favor...");
    await new Promise(resolve => setTimeout(resolve, 6000)); // Espera para asegurar disponibilidad

    // Descargar la imagen
    const whapiRes = await fetch(urlImg, {
        method: 'GET',
        headers: { "Authorization": `Bearer ${process.env.WHAPI_KEY}` }
    });

    if (!whapiRes.ok) {
        const errorText = await whapiRes.text();
        console.error("Error de Whapi:", errorText);
        return res.status(500).json({ success: false, error: "No se pudo descargar la imagen de Whapi" });
    }

    const arrayBuffer = await whapiRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString('base64');

    // 🆕 CLASIFICAR LA IMAGEN PRIMERO
    const tipoImagen = await clasificarImagen(base64Image, mimeType);
    console.log(`📷 Tipo de imagen detectado: ${tipoImagen}`);

    let mensajeRespuesta = "";
    let mensajeUsuario = "";

    switch (tipoImagen) {
        case "comprobante_pago":
            // Procesar como comprobante de pago (lógica original)
            const valorPago = await extraerValorPago(base64Image, mimeType);
            const valorNumerico = valorPago.replace(/[^0-9]/g, "");
            const valorEsValido = /^[0-9]{4,}$/.test(valorNumerico);

            mensajeUsuario = "📷 Comprobante de pago recibido";
            
            if (!valorEsValido) {
                mensajeRespuesta = "No pude identificar el valor del comprobante. Por favor envía una imagen clara del soporte de pago.";
            } else {
                mensajeRespuesta = `Hemos recibido tu comprobante`;
                // Continuar con lógica de solicitar documento
                await sendMessage(to, mensajeRespuesta);
                await sendMessage(to, "Escribe SOLO tu documento SIN puntos y SIN letras");
            }
            break;

        case "listado_examenes":
            const analisisExamenes = await analizarListadoExamenes(base64Image, mimeType);
            mensajeUsuario = "📋 Listado de exámenes recibido";
            mensajeRespuesta = `He revisado tu orden médica. ${analisisExamenes}\n\n🩺 Ofrecemos exámenes ocupacionales:\n• Virtual: $46.000\n• Presencial: $69.000\n\n¿Cuál opción prefieres?`;
            break;

        case "confirmacion_cita":
            mensajeUsuario = "📅 Confirmación de cita recibida";
            mensajeRespuesta = "He recibido tu confirmación de cita. Si necesitas consultar información específica sobre tu cita, por favor proporciona tu número de documento.";
            break;

        case "documento_identidad":
            mensajeUsuario = "🆔 Documento de identidad recibido";
            mensajeRespuesta = "He recibido tu documento. Si necesitas consultar información sobre tu cita o realizar un examen, por favor escríbeme qué necesitas.";
            break;

        default: // "otro"
            mensajeUsuario = "📷 Imagen recibida";
            mensajeRespuesta = "He recibido tu imagen, pero no pude identificar qué tipo de documento es. ¿Podrías decirme qué necesitas o enviar el comprobante de pago si ya realizaste el examen?";
            break;
    }

    // Guardar en historial
    const { mensajes: mensajesHistorial = [] } = await obtenerConversacionDeWix(from);
    const nuevoHistorial = [
        ...mensajesHistorial,
        { from: "usuario", mensaje: mensajeUsuario, timestamp: new Date().toISOString() },
        { from: "sistema", mensaje: mensajeRespuesta, timestamp: new Date().toISOString() }
    ];

    await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial });

    // Enviar respuesta si no se envió antes
    if (tipoImagen !== "comprobante_pago" || !valorEsValido) {
        await sendMessage(to, mensajeRespuesta);
    }

    return res.json({
        success: true,
        mensaje: "Imagen procesada correctamente.",
        tipoImagen,
        respuesta: mensajeRespuesta
    });
}

module.exports = { procesarImagen };