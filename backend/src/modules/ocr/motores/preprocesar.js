'use strict';

// Preprocesado con sharp antes de recortar zonas: orientación por EXIF, escala de grises,
// normalización del contraste y un ancho objetivo. El recorte y la perspectiva ya vienen hechos
// desde el teléfono.

const sharp = require('sharp');

const ANCHO_OBJETIVO = 2000;
/** Margen que se ignora dentro de una casilla, para no contar el borde impreso. */
const MARGEN_CASILLA = 0.15;
/** Proporción de píxeles oscuros a partir de la cual una casilla está marcada. */
const UMBRAL_MARCA = 0.15;

class ImagenNoSoportada extends Error {
  constructor() {
    super('La página no es una imagen que el OCR pueda leer');
    this.name = 'ImagenNoSoportada';
    this.codigo = 'PAGINA_NO_SOPORTADA';
  }
}

/**
 * Imagen lista para recortar zonas.
 * @param {Buffer} buffer
 * @param {string} mime
 * @returns {Promise<{ buffer: Buffer, ancho: number, alto: number }>}
 */
async function preprocesar(buffer, mime) {
  if (!mime?.startsWith('image/')) throw new ImagenNoSoportada();
  const { data, info } = await sharp(buffer)
    .rotate()
    .grayscale()
    .normalise()
    .resize({ width: ANCHO_OBJETIVO })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, ancho: info.width, alto: info.height };
}

/**
 * Recorta una zona (caja normalizada de 0 a 1). Con `margen`, recorta además ese tanto por lado.
 * @param {{ buffer: Buffer, ancho: number, alto: number }} imagen
 * @param {{ x: number, y: number, ancho: number, alto: number }} caja
 */
async function recortar(imagen, caja, margen = 0) {
  const x = caja.x + caja.ancho * margen;
  const y = caja.y + caja.alto * margen;
  const ancho = caja.ancho * (1 - 2 * margen);
  const alto = caja.alto * (1 - 2 * margen);
  const left = Math.min(imagen.ancho - 1, Math.max(0, Math.floor(x * imagen.ancho)));
  const top = Math.min(imagen.alto - 1, Math.max(0, Math.floor(y * imagen.alto)));
  const width = Math.max(1, Math.min(imagen.ancho - left, Math.round(ancho * imagen.ancho)));
  const height = Math.max(1, Math.min(imagen.alto - top, Math.round(alto * imagen.alto)));
  return sharp(imagen.buffer).extract({ left, top, width, height }).png().toBuffer();
}

/**
 * ¿Está marcada la casilla? Densidad de píxeles oscuros dentro de la zona (sin el borde).
 * La confianza crece a medida que la densidad se aleja del umbral.
 * @param {{ buffer: Buffer, ancho: number, alto: number }} imagen
 * @param {{ x: number, y: number, ancho: number, alto: number }} caja
 * @returns {Promise<{ marcada: boolean, confianza: number, densidad: number }>}
 */
async function leerCasilla(imagen, caja) {
  const recorte = await recortar(imagen, caja, MARGEN_CASILLA);
  const { data } = await sharp(recorte).threshold(128).raw().toBuffer({ resolveWithObject: true });
  let oscuros = 0;
  for (const px of data) if (px === 0) oscuros += 1;
  const densidad = data.length ? oscuros / data.length : 0;
  const distancia = Math.abs(densidad - UMBRAL_MARCA) / (2 * UMBRAL_MARCA);
  return {
    marcada: densidad >= UMBRAL_MARCA,
    confianza: Math.min(0.99, 0.5 + distancia),
    densidad,
  };
}

module.exports = { preprocesar, recortar, leerCasilla, ImagenNoSoportada, UMBRAL_MARCA };
