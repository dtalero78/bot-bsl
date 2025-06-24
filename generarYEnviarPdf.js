// generarYEnviarPdf.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const API2PDF_KEY = process.env.API2PDF_KEY;
const WHAPI_KEY = process.env.WHAPI_KEY;

/**
 * Espera hasta que la URL del PDF esté realmente disponible (HEAD 200)
 */
async function esperarPdfDisponible(pdfUrl, maxIntentos = 6, delayMs = 1000) {
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const resp = await fetch(pdfUrl, { method: "HEAD" });
      if (resp.ok) {
        return true;
      }
    } catch (err) {
      // Puede fallar si el PDF aún no está disponible
    }
    await new Promise(res => setTimeout(res, delayMs));
  }
  return false;
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

    // 2. Esperar a que el PDF esté realmente accesible
    const pdfReady = await esperarPdfDisponible(pdfUrl);
    if (!pdfReady) throw new Error("El PDF aún no está disponible tras varios intentos.");

    // 3. Enviar el PDF por WhatsApp (Whapi)
    const sendResp = await fetch("https://gate.whapi.cloud/messages/document", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHAPI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: to,
        media: pdfUrl,
        caption: "Aquí tienes tu certificado médico en PDF."
      })
    });

    const result = await sendResp.json();
    console.log("✅ PDF enviado:", JSON.stringify(result, null, 2));
    return { success: true, pdfUrl };

  } catch (err) {
    console.error("❌ Error en generarYEnviarPdf:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generarYEnviarPdf };
