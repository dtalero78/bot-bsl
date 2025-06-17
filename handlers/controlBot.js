const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const BOT_NUMBER = "573008021701";

async function manejarControlBot(message) {
    if (message.from_me === true || message.from === BOT_NUMBER) {
        const bodyText = message?.text?.body?.trim()?.toLowerCase();

        const frasesDeDetencion = [
            "...transfiriendo con asesor",
            "...transfiriendo con asesor.",
            "ya terminé mis las pruebas",
            "ya termine mis las pruebas"
        ];

        if (bodyText && frasesDeDetencion.includes(bodyText)) {
            console.log(`🛑 Bot desactivado para ${message.chat_id}`);
            await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: message.chat_id.split("@")[0],
                    observaciones: "stop"
                })
            });
        }

        if (bodyText === "...te dejo con el bot 🤖") {
            console.log(`✅ Bot reactivado para ${message.chat_id}`);
            await fetch(`https://www.bsl.com.co/_functions/actualizarObservaciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: message.chat_id.split("@")[0],
                    observaciones: ""
                })
            });
        }

        return { success: true, mensaje: "Mensaje de control procesado." };
    }

    return null;
}

module.exports = { manejarControlBot };
