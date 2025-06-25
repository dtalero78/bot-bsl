// utils/validaciones.js
function esCedula(texto) {
  return /^\d{7,10}$/.test(texto.trim());
}

function contieneTexto(texto, palabras = []) {
  const t = texto.toLowerCase();
  return palabras.some(p => t.includes(p));
}

module.exports = { esCedula, contieneTexto };
