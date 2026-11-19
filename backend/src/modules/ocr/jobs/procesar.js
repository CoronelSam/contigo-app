'use strict';

// Stub del trabajo "ocr.procesar". Lo implementa el agente 07 (OCR y revisión).

const { NoImplementado } = require('../../../core/errores');

/**
 * @param {object} _datos { extraccionId }
 * @param {{ trabajo: object, logger: import('pino').Logger }} _contexto
 */
module.exports = async function procesarOcr(_datos, _contexto) {
  throw new NoImplementado('El trabajo ocr.procesar');
};
