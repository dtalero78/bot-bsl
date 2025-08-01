const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');

// Función de utilidad para evitar mensajes duplicados
function limpiarDuplicados(historial) {
    const vistos = new Set();
    return historial.filter(m => {
        const clave = `${m.from}|${m.mensaje}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
    });
}

// Función para enviar y guardar mensaje
async function enviarMensajeYGuardar({ to, userId, nombre, texto, remitente = "sistema" }) {
    try {
        if (to) {
            const resultado = await sendMessage(to, texto);
            if (!resultado.success && resultado.error) {
                console.error(`❌ Error enviando mensaje a ${to}:`, resultado.error);
            }
        }
        
        const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
        const historialLimpio = limpiarDuplicados(historial);
        const nuevoHistorial = limpiarDuplicados([
            ...historialLimpio,
            { from: remitente, mensaje: texto }
        ]);
        
        await guardarConversacionEnWix({ userId, nombre, mensajes: nuevoHistorial });
        return { success: true };
    } catch (error) {
        console.error(`❌ Error en enviarMensajeYGuardar para ${userId}:`, error.message);
        return { success: false, error: error.message };
    }
}

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
    const prompt = "Extrae SOLO el valor pagado (valor de la transferencia en pesos colombianos) que aparece en este comprobante bancario. Ten en cuenta si tiene puntos o comas. Responde solo el valor exacto, sin explicaciones, ni símbolos adicionales.";

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

    console.log(`📷 Procesando imagen de: ${from} (${nombre})`);

    // ✅ Ignorar si la imagen fue enviada por el admin o el bot
    const BOT_NUMBER = "573008021701";
    if (message.from_me === true || message.from === BOT_NUMBER) {
        console.log("📷 Imagen ignorada: fue enviada por el admin o el bot.");
        return res.json({ success: true, mensaje: "Imagen del admin ignorada." });
    }

    // ✅ Verificación de observaciones para STOP
    const { observaciones = "" } = await obtenerConversacionDeWix(from);
    if (String(observaciones).toLowerCase().includes("stop")) {
        console.log(`🛑 Usuario bloqueado por observaciones: ${from}`);
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones (silencioso)." });
    }

    const imageId = message.image?.id;
    const mimeType = message.image?.mime_type || "image/jpeg";
    const urlImg = `https://gate.whapi.cloud/media/${imageId}`;

    // 1. Guardar que el usuario envió una imagen
    await enviarMensajeYGuardar({
        to: null, // No enviar mensaje al usuario aún
        userId: from,
        nombre,
        texto: "📷 Imagen enviada",
        remitente: "usuario"
    });

    // 2. Enviar mensaje de procesamiento
    await enviarMensajeYGuardar({
        to,
        userId: from,
        nombre,
        texto: "🔍 Un momento por favor...",
        remitente: "sistema"
    });

    // 3. Esperar para asegurar disponibilidad de la imagen
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        // 4. Descargar la imagen
        const whapiRes = await fetch(urlImg, {
            method: 'GET',
            headers: { "Authorization": `Bearer ${process.env.WHAPI_KEY}` }
        });

        if (!whapiRes.ok) {
            const errorText = await whapiRes.text();
            console.error("❌ Error descargando imagen de Whapi:", errorText);
            
            await enviarMensajeYGuardar({
                to,
                userId: from,
                nombre,
                texto: "Lo siento, no pude procesar tu imagen. Por favor intenta de nuevo.",
                remitente: "sistema"
            });
            
            return res.status(500).json({ success: false, error: "No se pudo descargar la imagen" });
        }

        const arrayBuffer = await whapiRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString('base64');

        // 5. Clasificar la imagen
        const tipoImagen = await clasificarImagen(base64Image, mimeType);
        console.log(`🎯 Tipo de imagen detectado: ${tipoImagen}`);

        let mensajeContexto = "";
        let mensajeRespuesta = "";

        // 6. Procesar según el tipo de imagen
        switch (tipoImagen) {
            case "comprobante_pago":
                console.log("💰 Procesando comprobante de pago");
                
                const valorPago = await extraerValorPago(base64Image, mimeType);
                const valorNumerico = valorPago.replace(/[^0-9]/g, "");
                const valorEsValido = /^[0-9]{4,}$/.test(valorNumerico);

                mensajeContexto = valorEsValido 
                    ? `📷 Comprobante de pago recibido - Valor detectado: $${valorNumerico}`
                    : "📷 Comprobante de pago recibido - Valor no detectado";

                if (valorEsValido) {
                    mensajeRespuesta = "Ahora escribe SOLO tu número de documento *(sin puntos ni letras)*.";
                } else {
                    mensajeRespuesta = "No pude identificar el valor en el comprobante. Por favor envía una imagen más clara del soporte de pago.";
                }
                break;

            case "listado_examenes":
                console.log("📋 Procesando listado de exámenes");
                
                const analisisExamenes = await analizarListadoExamenes(base64Image, mimeType);
                mensajeContexto = "📋 Listado de exámenes recibido";
                mensajeRespuesta = `He revisado tu orden médica.\n\n🩺 Nuestras opciones para exámenes ocupacionales:\n• Virtual: $46.000\n• Presencial: $69.000\n\n¿Cuál opción prefieres?`;
                break;

            case "confirmacion_cita":
                console.log("📅 Procesando confirmación de cita");
                
                mensajeContexto = "📅 Confirmación de cita recibida";
                mensajeRespuesta = "He recibido tu confirmación de cita. Para consultar información específica, proporciona tu número de documento.";
                break;

            case "documento_identidad":
                console.log("🆔 Procesando documento de identidad");
                
                mensajeContexto = "🆔 Documento de identidad recibido";
                mensajeRespuesta = "He recibido tu documento. ¿Necesitas consultar información sobre tu cita o realizar un examen médico?";
                break;

            default: // "otro"
                console.log("❓ Imagen no identificada");
                
                mensajeContexto = "📷 Imagen recibida - Tipo no identificado";
                mensajeRespuesta = "He recibido tu imagen, pero no pude identificar qué tipo de documento es. ¿Podrías explicarme qué necesitas?";
                break;
        }

        // 7. Guardar el contexto de la imagen procesada
        await enviarMensajeYGuardar({
            to: null, // Solo guardar, no enviar
            userId: from,
            nombre,
            texto: mensajeContexto,
            remitente: "sistema"
        });

        // 8. Enviar respuesta final al usuario
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: mensajeRespuesta,
            remitente: "sistema"
        });

        console.log(`✅ Imagen procesada exitosamente para ${from}: ${tipoImagen}`);

        return res.json({
            success: true,
            mensaje: "Imagen procesada correctamente.",
            tipoImagen,
            contexto: mensajeContexto,
            respuesta: mensajeRespuesta
        });

    } catch (error) {
        console.error("❌ Error procesando imagen:", error);
        
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "Ocurrió un error procesando tu imagen. Por favor intenta de nuevo o contacta con un asesor.",
            remitente: "sistema"
        });

        return res.status(500).json({ 
            success: false, 
            error: "Error interno procesando imagen",
            details: error.message 
        });
    }
}

module.exports = { procesarImagen };