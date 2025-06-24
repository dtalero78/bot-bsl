const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const API2PDF_KEY = process.env.API2PDF_KEY;
const WHAPI_KEY = process.env.WHAPI_KEY;

const { sendMessage } = require('./sendMessage'); // Ajusta la ruta según tu estructura

// Espera hasta que la URL del PDF esté disponible (HEAD 200)
async function esperarPdfDisponible(pdfUrl, maxIntentos = 6, delayMs = 1000) {
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const resp = await fetch(pdfUrl, { method: "HEAD" });
      if (resp.ok) {
        return true;
      }
    } catch (err) {}
    await new Promise(res => setTimeout(res, delayMs));
  }
  return false;
}

// Envía el PDF por Whapi. Si recibe 404, reintenta hasta N veces más, enviando el mensaje de espera en cada uno
async function enviarPdfPorWhapiConReintentos(to, pdfUrl, caption, reintentos = 3, delayMs = 2500) {
  for (let i = 0; i <= reintentos; i++) {
    const sendResp = await fetch("https://gate.whapi.cloud/messages/document", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHAPI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to, media: pdfUrl, caption })
    });
    const result = await sendResp.json();

    if (result.sent) return result;

    // Solo reintentar en caso de 404
    if (result.error && result.error.code === 404 && i < reintentos) {
      console.warn(`Whapi 404 (intento ${i + 1}), esperando y reintentando...`);
      await sendMessage(to, "🔍 Un momento por favor...");
      await new Promise(res => setTimeout(res, delayMs));
      continue;
    }

    // Otro error, o ya agotó reintentos
    throw new Error(result.error ? result.error.message : "Error desconocido en Whapi");
  }
  throw new Error("Whapi: specified media not found tras reintentos.");
}

async function generarYEnviarPdf(documento, to) {
  const apiEndpoint = 'https://v2018.api2pdf.com/chrome/url';
  const url = `https://www.bsl.com.co/descarga-whp/${documento}`;

  try {
    // 1. Generar el PDF
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API2PDF_KEY
      },
      body: JSON.stringify({
        url,
        inlinePdf: false,
        fileName: `${documento}.pdf`
      })
    });

    const json = await response.json();
    if (!json.success) throw new Error(json.error);
    const pdfUrl = json.pdf;

    // 2. Esperar a que el PDF esté disponible (opcional, puede quitarse si la URL HEAD 200 sale “falsa”)
    await esperarPdfDisponible(pdfUrl, 6, 1000);

    // 3. Enviar PDF por Whapi con hasta 3 reintentos si 404, avisando al usuario en cada intento
    const result = await enviarPdfPorWhapiConReintentos(to, pdfUrl, "Aquí tienes tu certificado médico en PDF.", 3, 3000);

    console.log("✅ PDF enviado:", JSON.stringify(result, null, 2));
    return { success: true, pdfUrl };

  } catch (err) {
    console.error("❌ Error en generarYEnviarPdf:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generarYEnviarPdf };
