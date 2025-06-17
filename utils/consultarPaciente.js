const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function consultarInformacionPaciente(numeroId) {
    if (!numeroId) {
        throw new Error("Falta el número de documento");
    }

    const url = `https://www.bsl.com.co/_functions/informacionPaciente?numeroId=${encodeURIComponent(numeroId)}`;

    const resp = await fetch(url);

    if (!resp.ok) {
        const errorText = await resp.text();
        console.error("❌ Error consultando información del paciente:", errorText);
        throw new Error("No se pudo consultar la información del paciente");
    }

    const json = await resp.json();

    // Devuelve el array directamente, o null si no hay resultados
    return json.informacion || [];
}

module.exports = { consultarInformacionPaciente };
