'use strict';

// Almacenamiento de objetos privado. Nunca se sirve un archivo público:
// todo se entrega con URL firmadas de vida corta.
//
// Proveedores (ALMACENAMIENTO_PROVEEDOR):
//   - disco: carpeta local, para desarrollo sin servicios externos (por defecto).
//   - s3: Cloudflare R2 por su API S3, para servidores (obligatorio en producción).
//   - memoria: pruebas automáticas.
// El registro en la tabla `archivos` y el registro de accesos los hace core/archivos (agente 02).

const { config } = require('../../config/env');
const { crearAdaptadorS3 } = require('./s3');
const { crearAdaptadorDisco, RUTA_DESCARGA } = require('./disco');
const { crearAdaptadorMemoria } = require('./memoria');

let adaptador;

function obtener() {
  if (!adaptador) {
    const cfg = config();
    const a = cfg.almacenamiento;
    if (a.proveedor === 'memoria') adaptador = crearAdaptadorMemoria(a);
    else if (a.proveedor === 'disco') {
      adaptador = crearAdaptadorDisco({
        ...a,
        secreto: cfg.jwt.secreto,
        urlBase: cfg.http.apiUrlPublica,
      });
    } else adaptador = crearAdaptadorS3(a);
  }
  return adaptador;
}

module.exports = {
  RUTA_DESCARGA,
  /** Proveedor activo: 'disco', 's3' o 'memoria'. */
  proveedor: () => config().almacenamiento.proveedor,
  /**
   * Sube un objeto. R2 lo cifra en reposo (AES-256) sin configuración.
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
  /** Crea el bucket o la carpeta si no existe. Solo en desarrollo y pruebas. */
  asegurarBucket: () => obtener().asegurarBucket(),
  /** Comprueba que el almacenamiento responde (para /health). */
  verificar: () => obtener().verificar(),
  /** Solo con proveedor "disco": handler de GET /archivos-locales/*clave. */
  manejarDescarga: (req, res, next) => obtener().manejarDescarga(req, res, next),
  /** Solo pruebas: reinicia el adaptador (por ejemplo, tras cambiar la configuración). */
  _reiniciar: () => {
    adaptador = undefined;
  },
};
