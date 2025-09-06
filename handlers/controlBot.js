const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { sendMessage } = require('../utils/sendMessage');
const { actualizarObservaciones } = require('../utils/dbAPI');
const { logInfo, logError } = require('../utils/shared');
const { config } = require('../config/environment');

const BOT_NUMBER = config.bot.number;

async function manejarControlBot(message) {
    // Solo filtra si viene del bot/admin (desde el mismo número)
    if (message.from_me === true || message.from === BOT_NUMBER) {
        // Toma el texto del mensaje para cualquier tipo que lo tenga
        const bodyText = message?.text?.body?.trim()?.toLowerCase() || "";
        const chatId = message.chat_id;
        const userId = chatId.split("@")[0];
        const to = `${userId}@s.whatsapp.net`;

        const frasesDeDetencion = config.bot.frasesDetencion;
        const palabrasClaveStop = config.bot.palabrasClaveStop;

        // 🚫 Detención por frase exacta
        if (bodyText && frasesDeDetencion.includes(bodyText)) {
            logInfo('controlBot', `Bot desactivado por frase exacta`, { chatId, frase: bodyText });
            await actualizarObservaciones(userId, "stop");
            return { detuvoBot: true };
        }

        // 🚫 Detención por palabras clave
        else if (bodyText && palabrasClaveStop.some(p => bodyText.includes(p))) {
            logInfo('controlBot', `Bot desactivado por palabra clave`, { chatId, palabra: palabrasClaveStop.find(p => bodyText.includes(p)) });
            await actualizarObservaciones(userId, "stop");
            return { detuvoBot: true };
        }

        // ✅ Reactivar bot
        if (bodyText === config.bot.fraseReactivacion) {
            logInfo('controlBot', `Bot reactivado`, { chatId });
            await actualizarObservaciones(userId, " ");
        }

        return { success: true, mensaje: "Mensaje de control procesado." };
    }
    return null;
}

module.exports = { manejarControlBot };
