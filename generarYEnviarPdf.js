// generarYEnviarPdf.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const API2PDF_KEY = process.env.API2PDF_KEY;
const WHAPI_KEY = process.env.WHAPI_KEY;

async function generarYEnviarPdf(documento, to) {
  const apiEndpoint = 'https://v2018.api2pdf.com/chrome/url';
  const url = `https://www.bsl.com.co/descarga-whp/${documento}`;

  try {
    // Generar el PDF
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'cefeb8d4-a2e8-43a4-9a7d-f3c4e6ef1b45'
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

    // Enviar el PDF por WhatsApp
    const sendResp = await fetch("https://gate.whapi.cloud/messages/document", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHAPI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: to,
        media: {
          url: pdfUrl,
          caption: "Aquí tienes tu certificado médico en PDF."
        }
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
