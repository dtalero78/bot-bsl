const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const API2PDF_KEY = process.env.API2PDF_KEY;
const WHAPI_KEY = process.env.WHAPI_KEY;

// Debes importar sendMessage de tu código (ajusta la ruta según tu estructura)
const { sendMessage } = require('./sendMessage'); // o '../utils/sendMessage'

// Espera hasta que la URL del PDF esté disponible (HEAD 200)
async function esperarPdfDisponible(pdfUrl, maxIntentos = 6, delayMs = 1000, to) {
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const resp = await fetch(pdfUrl, { method: "HEAD" });
      if (resp.ok) {
        return true;
      }
    } catch (err) {}
    if (to) await sendMessage(to, "🔍 Un momento por favor..."); // Nuevo: informa cada reintento
    await new Promise(res => setTimeout(res, delayMs));
  }
  return false;
}

// Envía el PDF por Whapi. Si recibe 404, reintenta tras una nueva espera
async function enviarPdfPorWhapiConReintento(to, pdfUrl, caption) {
  // Primer intento
  let sendResp = await fetch("https://gate.whapi.cloud/messages/document", {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHAPI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ to, media: pdfUrl, caption })
  });
  let result = await sendResp.json();

  if (result.sent) return result;

  // Si error 404, esperar más y reintentar UNA sola vez
  if (result.error && result.error.code === 404) {
    console.warn("Whapi 404, esperando extra y reintentando envío PDF...", pdfUrl);
    // Nuevo: notifica al usuario antes de reintentar
    await sendMessage(to, "🔍 Un momento por favor...");
    // Esperar 5 intentos de 1.5s con mensaje de espera cada uno
    await esperarPdfDisponible(pdfUrl, 5, 1500, to);

    sendResp = await fetch("https://gate.whapi.cloud/messages/document", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHAPI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to, media: pdfUrl, caption })
    });
    result = await sendResp.json();
    if (result.sent) return result;
  }

  // Si sigue fallando, lanza el error
  throw new Error(result.error ? result.error.message : "Error desconocido en Whapi");
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

    // 2. Esperar a que el PDF esté disponible (6 intentos, con mensajes)
    const pdfReady = await esperarPdfDisponible(pdfUrl, 6, 1000, to);
    if (!pdfReady) throw new Error("El PDF aún no está disponible tras varios intentos.");

    // 3. Enviar PDF por Whapi con reintento inteligente (también con mensaje)
    const result = await enviarPdfPorWhapiConReintento(to, pdfUrl, "Aquí tienes tu certificado médico en PDF.");

    console.log("✅ PDF enviado:", JSON.stringify(result, null, 2));
    return { success: true, pdfUrl };

  } catch (err) {
    console.error("❌ Error en generarYEnviarPdf:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generarYEnviarPdf };
