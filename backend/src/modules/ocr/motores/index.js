'use strict';

// Motor de OCR activo según OCR_PROVEEDOR. Interfaz de cada adaptador:
//
//   procesar({ paginas: [{ numero, buffer, mime }], zonas, alProgresar })
//     → { motor, campos: [{ campo, valor, confianza, pagina, coordenadas }], crudo }
//   verificar() → lanza si el motor no está disponible (para /health)

const { config } = require('../../../config/env');

const MOTORES = Object.freeze({
  simulado: () => require('./simulado'),
  tesseract: () => require('./tesseract'),
  nube: () => require('./nube'),
});

/** @returns {{ nombre: string, procesar: Function, verificar: Function }} */
function obtenerMotor() {
  return MOTORES[config().ocr.proveedor]();
}

module.exports = { obtenerMotor, MOTORES };
