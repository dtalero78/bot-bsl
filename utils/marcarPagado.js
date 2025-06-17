const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function marcarPagado(userId) {
    const url = 'https://www.bsl.com.co/_functions/marcarPagado';

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            userId,
            observaciones: "Pagado"
        })
    });

    const json = await resp.json();
    console.log("✅ Respuesta de marcarPagado:", json);
    return json;
}

module.exports = { marcarPagado };
