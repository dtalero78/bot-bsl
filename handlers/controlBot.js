const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { sendMessage } = require('../utils/sendMessage');
const BOT_NUMBER = "573008021701";

async function manejarControlBot(message) {
    if (message.from_me === true || message.from === BOT_NUMBER) {
        const bodyText = message?.text?.body?.trim()?.toLowerCase();
        const chatId = message.chat_id;
        const userId = chatId.split("@")[0];
        const to = `${userId}@s.whatsapp.net`;

        const frasesDeDetencion = [
            "...transfiriendo con asesor",
            "...transfiriendo con asesor.",
        ];

        const palabrasClaveStop = ["foundever", "ttec", "evertec", "rippling", "egreso"];

        // 🚫 Detención por frase exacta
// 🚫 Detención por frase exacta
if (bodyText && frasesDeDetencion.includes(bodyText)) {
    console.log(`🛑 Bot desactivado por frase exacta para ${chatId}`);
    await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, observaciones: "stop" })
    });

    return { detuvoBot: true }; // 👈 esta línea FALTABA
}


        // 🚫 Detención por palabras clave
else if (bodyText && palabrasClaveStop.some(p => bodyText.includes(p))) {
    console.log(`🛑 Bot desactivado por palabra clave para ${chatId}`);
    await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, observaciones: "stop" })
    });

    return { detuvoBot: true }; // 👈 esta también
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
