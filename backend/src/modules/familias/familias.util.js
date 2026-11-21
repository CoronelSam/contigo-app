'use strict';

// Cálculos compartidos del módulo familias.

const { ESTADOS_SOLICITUD: E } = require('../../core/estados/constantes');

/**
 * Edad cumplida a hoy (no se guarda: se calcula en cada respuesta).
 * @param {string} fechaNacimiento YYYY-MM-DD
 * @param {Date} [hoy]
 * @returns {{ anios: number, meses: number }}
 */
function edadDe(fechaNacimiento, hoy = new Date()) {
  const [a, m, d] = fechaNacimiento.split('-').map(Number);
  let meses = (hoy.getFullYear() - a) * 12 + (hoy.getMonth() + 1 - m);
  if (hoy.getDate() < d) meses -= 1;
  meses = Math.max(meses, 0);
  return { anios: Math.floor(meses / 12), meses: meses % 12 };
}

/** Hoy como YYYY-MM-DD en la hora de Honduras. */
function hoyIso(ahora = new Date()) {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' });
}

const nombreCompleto = (p) =>
  [p.nombres, p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' ');

/** Etiqueta de estado para la familia (pantalla 08). La app la traduce. */
function estadoFamilia(estado) {
  if (estado === E.CAPTURA || estado === E.INFO_ADICIONAL) return 'DOCUMENTOS_PENDIENTES';
  return estado;
}

/** Estados en los que la solicitud ya no está abierta. */
const ESTADOS_CERRADOS = Object.freeze([E.ACEPTADA, E.ATENDIDA_HN, E.DENEGADA]);

/** Estados en los que la familia todavía puede editar los datos del niño. */
const ESTADOS_EDITABLES = Object.freeze([E.BORRADOR, E.CAPTURA]);

/**
 * Elige el texto del idioma en objetos { es, en }, en cualquier nivel.
 * @param {unknown} valor
 * @param {'es' | 'en'} idioma
 */
function localizar(valor, idioma) {
  if (Array.isArray(valor)) return valor.map((v) => localizar(v, idioma));
  if (valor && typeof valor === 'object') {
    const claves = Object.keys(valor);
    if (claves.length && claves.every((k) => k === 'es' || k === 'en')) {
      return valor[idioma] ?? valor.es;
    }
    return Object.fromEntries(claves.map((k) => [k, localizar(valor[k], idioma)]));
  }
  return valor;
}

module.exports = {
  edadDe,
  hoyIso,
  nombreCompleto,
  estadoFamilia,
  localizar,
  ESTADOS_CERRADOS,
  ESTADOS_EDITABLES,
};
