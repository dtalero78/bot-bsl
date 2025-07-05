const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const sendMessage = async (to, body) => {
    const url = "https://gate.whapi.cloud/messages/text";
    // Agrega este log:
    console.log("[DEBUG] Enviando mensaje a WHAPI:", {
        url,
        to,
        body,
        WHAPI_KEY: process.env.WHAPI_KEY
    });
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.WHAPI_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ to, body })
    });
    const json = await resp.json();
    console.log("Respuesta envío WhatsApp:", JSON.stringify(json, null, 2));
};

module.exports = { sendMessage };
