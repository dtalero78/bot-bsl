const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const WHAPI_KEY = process.env.WHAPI_KEY;
const API2PDF_KEY = process.env.API2PDF_KEY;

const { marcarPagado } = require('./marcarPagado');

/**
 * Envía un PDF a través de WhatsApp usando Whapi y marca como pagado
 * @param {string} to - Número de teléfono del usuario en formato internacional
 * @param {string} pdfUrl - URL directa del PDF generado
 * @param {string} userId - ID del usuario (por ejemplo, número de WhatsApp)
 */
async function sendPdf(to, pdfUrl, userId) {
  // 🟢 Primero marcar como pagado
  try {
    await marcarPagado(userId);
  } catch (err) {
    console.error("❌ Error marcando como pagado:", err.message);
  }

  const url = "https://gate.whapi.cloud/messages/document";
  const body = {
    to: to,
    media: pdfUrl,
    caption: "Aquí tienes tu certificado médico en PDF."
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHAPI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const json = await resp.json();
  console.log("📤 Respuesta Whapi (PDF):", JSON.stringify(json, null, 2));
}


/**
 * Genera un PDF a partir de una URL usando API2PDF
 * @param {string} documento - Nombre o ID del documento que se incluirá en la URL
 * @returns {Promise<string>} - URL del PDF generado
 */
async function generarPdfDesdeApi2Pdf(documento) {
  const apiEndpoint = 'https://v2018.api2pdf.com/chrome/url';
  const url = `https://www.bsl.com.co/descarga-whp/${documento}`;

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
  if (!json.success) {
    throw new Error(json.error);
  }

  return json.pdf;
}

module.exports = {
  sendPdf,
  generarPdfDesdeApi2Pdf
};
