function esCedula(texto) {
  return /^\d{7,10}$/.test(texto.trim());
}

function contieneTexto(texto, palabras = []) {
  const textoNormalizado = texto.toLowerCase();
  return palabras.some(p => textoNormalizado.includes(p.toLowerCase()));
}

module.exports = {
  esCedula,
  contieneTexto
};
