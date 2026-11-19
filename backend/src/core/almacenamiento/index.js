'use strict';

// Almacenamiento de objetos privado. Nunca se sirve un archivo público:
// todo se entrega con URL firmadas de vida corta.
//
// Proveedores: `s3` (cualquier S3 compatible) y `memoria` (pruebas).
// El registro en la tabla `archivos` y el registro de accesos los hace core/archivos (agente 02).

const { config } = require('../../config/env');
const { crearAdaptadorS3 } = require('./s3');
const { crearAdaptadorMemoria } = require('./memoria');

let adaptador;

function obtener() {
  if (!adaptador) {
    const cfg = config().almacenamiento;
    adaptador = cfg.proveedor === 'memoria' ? crearAdaptadorMemoria(cfg) : crearAdaptadorS3(cfg);
  }
  return adaptador;
}

module.exports = {
  /**
   * Sube un objeto con cifrado del lado del servidor.
   * @param {{ clave: string, cuerpo: Buffer | Uint8Array | string, mime: string }} p
   */
  subirObjeto: (p) => obtener().subirObjeto(p),
  /**
   * URL firmada de lectura. Por defecto vence en URL_FIRMADA_SEGUNDOS (300).
   * @param {string} clave
   * @param {number} [segundos]
   * @returns {Promise<string>}
   */
  urlFirmadaGet: (clave, segundos) => obtener().urlFirmadaGet(clave, segundos),
  /** @param {string} clave @returns {Promise<boolean>} */
  existeObjeto: (clave) => obtener().existeObjeto(clave),
  /** @param {string} clave @returns {Promise<import('node:stream').Readable>} */
  leerObjeto: (clave) => obtener().leerObjeto(clave),
  /** Crea el bucket si no existe. Solo en desarrollo y pruebas. */
  asegurarBucket: () => obtener().asegurarBucket(),
  /** Comprueba que el bucket responde (para /health). */
  verificar: () => obtener().verificar(),
  /** Solo pruebas: reinicia el adaptador (por ejemplo, tras cambiar la configuración). */
  _reiniciar: () => {
    adaptador = undefined;
  },
};
