const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { sendMessage } = require('../utils/sendMessage');
const BOT_NUMBER = "573008021701";

async function manejarControlBot(message) {
    // Solo filtra si viene del bot/admin (desde el mismo número)
    if (message.from_me === true || message.from === BOT_NUMBER) {
        // Toma el texto del mensaje para cualquier tipo que lo tenga
        const bodyText = message?.text?.body?.trim()?.toLowerCase() || "";
        const chatId = message.chat_id;
        const userId = chatId.split("@")[0];
        const to = `${userId}@s.whatsapp.net`;

        const frasesDeDetencion = [
            "...transfiriendo con asesor",
            "...transfiriendo con asesor.",
        ];

        const palabrasClaveStop = ["foundever", "ttec", "evertec", "rippling", "egreso"];

        // 🚫 Detención por frase exacta
        if (bodyText && frasesDeDetencion.includes(bodyText)) {
            console.log(`🛑 Bot desactivado por frase exacta para ${chatId}`);
            await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, observaciones: "stop" })
            });
            return { detuvoBot: true };
        }

        // 🚫 Detención por palabras clave
        else if (bodyText && palabrasClaveStop.some(p => bodyText.includes(p))) {
            console.log(`🛑 Bot desactivado por palabra clave para ${chatId}`);
            await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, observaciones: "stop" })
            });
            return { detuvoBot: true };
        }

        // ✅ Reactivar bot
        if (bodyText === "...te dejo con el bot 🤖") {
            console.log(`✅ Bot reactivado para ${chatId}`);
            await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, observaciones: " " })
            });
        }

        return { success: true, mensaje: "Mensaje de control procesado." };
    }
    return null;
}

module.exports = { manejarControlBot };
