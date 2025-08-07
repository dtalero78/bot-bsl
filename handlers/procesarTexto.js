const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { promptInstitucional } = require('../utils/prompt');
const { sendMessage } = require('../utils/sendMessage');
const { guardarConversacionEnWix, obtenerConversacionDeWix } = require('../utils/wixAPI');
const { determinarNuevaFase } = require('../utils/faseDetector');
const { 
    manejarFaseInicial, 
    manejarPostAgendamiento, 
    manejarRevisionCertificado, 
    manejarPago 
} = require('./faseHandlers');

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

// Función para marcar STOP automáticamente
async function marcarStopEnWix(userId) {
    try {
        const resp = await fetch("https://www.bsl.com.co/_functions/actualizarObservaciones", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, observaciones: "stop" })
        });
        
        const result = await resp.json();
        console.log(`🛑 STOP marcado automáticamente para usuario: ${userId}`, result);
        return { success: true };
    } catch (err) {
        console.error("Error marcando STOP en Wix:", err);
        return { success: false, error: err.message };
    }
}

// Función para detectar mensaje de verificación del admin
function ultimoMensajeFueVerificarDatos(historial) {
    const mensajesAdmin = historial.filter(m => m.from === "admin");
    if (mensajesAdmin.length === 0) return false;
   
    const ultimoMensajeAdmin = mensajesAdmin[mensajesAdmin.length - 1];
    const mensajesStop = [
        "Revisa que todo esté en orden",
        "revisa que todo esté en orden", 
        "revisa que todo este en orden"
    ];
    
    return mensajesStop.some(msg => ultimoMensajeAdmin.mensaje.toLowerCase().includes(msg.toLowerCase()));
}

// Función para enviar y guardar mensaje en historial
async function enviarMensajeYGuardar({ to, userId, nombre, texto, remitente = "sistema", fase = "inicial" }) {
    try {
        if (to) {
            const resultado = await sendMessage(to, texto);
            if (!resultado.success && resultado.error) {
                console.error(`❌ Error enviando mensaje a ${to}:`, resultado.error);
                return { success: false, error: resultado.error };
            }
        }
        
        const { mensajes: historial = [] } = await obtenerConversacionDeWix(userId);
        const historialLimpio = limpiarDuplicados(historial);
        const nuevoHistorial = limpiarDuplicados([
            ...historialLimpio,
            { from: remitente, mensaje: texto, timestamp: new Date().toISOString() }
        ]);
        
        const guardado = await guardarConversacionEnWix({ userId, nombre, mensajes: nuevoHistorial, fase });
        return { success: true, guardado };
    } catch (error) {
        console.error(`❌ Error en enviarMensajeYGuardar para ${userId}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * FUNCIÓN PRINCIPAL - PROCESAR TEXTO CON SISTEMA DE FASES
 */
async function procesarTexto(message, res) {
    const from = message.from;
    const nombre = message.from_name || "Nombre desconocido";
    const chatId = message.chat_id;
    const to = chatId || `${from}@s.whatsapp.net`;
    const userMessage = message.text.body.trim();

    console.log(`📝 Procesando texto de ${from}: "${userMessage}"`);

    // 1. Guardar el mensaje del usuario
    {
        const { mensajes: historial = [], fase = "inicial" } = await obtenerConversacionDeWix(from);
        const historialLimpio = limpiarDuplicados(historial);
        const nuevoHistorial = limpiarDuplicados([
            ...historialLimpio,
            { from: "usuario", mensaje: userMessage, timestamp: new Date().toISOString() }
        ]);
        await guardarConversacionEnWix({ userId: from, nombre, mensajes: nuevoHistorial, fase });
    }

    // 2. Obtener estado actualizado
    const { mensajes: mensajesHistorial = [], observaciones = "", fase = "inicial" } = await obtenerConversacionDeWix(from);
    const historialLimpio = limpiarDuplicados(mensajesHistorial);

    console.log(`📊 Estado actual - Fase: ${fase}, Mensajes: ${historialLimpio.length}`);

    // 3. Verificar si el usuario está bloqueado por observaciones
    if (String(observaciones).toLowerCase().includes("stop")) {
        console.log(`🛑 Usuario ${from} bloqueado por observaciones STOP`);
        return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones." });
    }

    // 4. Detectar y actualizar fase automáticamente
    const nuevaFase = determinarNuevaFase(fase, userMessage, historialLimpio);
    
    if (nuevaFase !== fase) {
        console.log(`🔄 Cambio de fase detectado: ${fase} → ${nuevaFase}`);
        // Actualizar la fase en la base de datos
        await guardarConversacionEnWix({ 
            userId: from, 
            nombre, 
            mensajes: historialLimpio, 
            fase: nuevaFase 
        });
    }

    // 5. Marcar STOP automáticamente cuando admin dice mensaje específico
    if (ultimoMensajeFueVerificarDatos(historialLimpio)) {
        console.log("🛑 Detectado mensaje del ADMIN - Marcando STOP");
        await marcarStopEnWix(from);
        await enviarMensajeYGuardar({
            to,
            userId: from,
            nombre,
            texto: "Gracias por la información. Un asesor revisará tu caso y te contactará pronto.",
            remitente: "sistema",
            fase: nuevaFase
        });
        return res.json({ success: true, mensaje: "Usuario marcado como STOP" });
    }

    // 6. ROUTER PRINCIPAL POR FASE
    console.log(`🚀 Routing a fase: ${nuevaFase}`);
    
    switch (nuevaFase) {
        case "inicial":
            return await manejarFaseInicial(message, res, historialLimpio);
        
        case "post_agendamiento":
            return await manejarPostAgendamiento(message, res, historialLimpio);
        
        case "revision_certificado":
            return await manejarRevisionCertificado(message, res, historialLimpio);
        
        case "pago":
            return await manejarPago(message, res, historialLimpio);
        
        case "completado":
            // Proceso completado, podría reiniciar o mantener estado
            await enviarMensajeYGuardar({
                to,
                userId: from,
                nombre,
                texto: "Tu proceso ha sido completado exitosamente. Si necesitas realizar otro examen, te ayudo con gusto.",
                remitente: "sistema",
                fase: "inicial" // Reiniciar para nueva consulta
            });
            return res.json({ success: true, mensaje: "Proceso completado, reiniciando", fase: "inicial" });
        
        default:
            console.log(`❌ Fase desconocida: ${nuevaFase}, defaulting a inicial`);
            return await manejarFaseInicial(message, res, historialLimpio);
    }
}

module.exports = { procesarTexto };