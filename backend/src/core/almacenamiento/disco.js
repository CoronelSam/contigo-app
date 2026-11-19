'use strict';

// Almacenamiento en una carpeta local para desarrollo sin servicios externos.
// Las URL firmadas apuntan a la propia API (GET /archivos-locales/<clave>?expira=&firma=),
// con la misma semántica que una URL prefirmada de S3: vencen y no se pueden alterar.
// No cifra en reposo: config/env lo prohíbe en producción.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AppError, noEncontrado } = require('../errores');

const RUTA_DESCARGA = '/archivos-locales';
const SUFIJO_META = '.meta.json';

/** Rechaza claves que podrían salir de la carpeta o chocar con los metadatos. */
function validarClave(clave) {
  const segmentos = typeof clave === 'string' ? clave.split('/') : [];
  const valida =
    segmentos.length > 0 &&
    !clave.includes('\\') &&
    !clave.includes('\0') &&
    !clave.endsWith(SUFIJO_META) &&
    segmentos.every((s) => s !== '' && s !== '.' && s !== '..');
  if (!valida) throw new AppError(400, 'CLAVE_INVALIDA', 'Clave de archivo inválida');
  return clave;
}

function crearAdaptadorDisco(cfg) {
  const raiz = path.resolve(cfg.directorio);
  const llave = crypto
    .createHmac('sha256', cfg.secreto)
    .update('vanguardia:almacenamiento-disco')
    .digest();

  const rutaDe = (clave) => path.join(raiz, ...validarClave(clave).split('/'));
  const firmar = (clave, expira) =>
    crypto.createHmac('sha256', llave).update(`${clave}\n${expira}`).digest('hex');

  async function existe(clave) {
    try {
      return (await fsp.stat(rutaDe(clave))).isFile();
    } catch {
      return false;
    }
  }

  async function leerMeta(ruta) {
    try {
      return JSON.parse(await fsp.readFile(`${ruta}${SUFIJO_META}`, 'utf8'));
    } catch {
      return { mime: 'application/octet-stream' };
    }
  }

  return {
    raiz,

    async subirObjeto({ clave, cuerpo, mime }) {
      const ruta = rutaDe(clave);
      await fsp.mkdir(path.dirname(ruta), { recursive: true });
      const temporal = `${ruta}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(temporal, cuerpo);
      await fsp.rename(temporal, ruta);
      await fsp.writeFile(`${ruta}${SUFIJO_META}`, JSON.stringify({ mime }));
      return { clave };
    },

    async urlFirmadaGet(clave, segundos = cfg.urlFirmadaSegundos) {
      validarClave(clave);
      const expira = Math.floor(Date.now() / 1000) + segundos;
      const rutaUrl = clave.split('/').map(encodeURIComponent).join('/');
      return `${cfg.urlBase}${RUTA_DESCARGA}/${rutaUrl}?expira=${expira}&firma=${firmar(clave, expira)}`;
    },

    existeObjeto: existe,

    async leerObjeto(clave) {
      const ruta = rutaDe(clave);
      if (!(await existe(clave))) {
        const err = new Error(`No existe el objeto ${clave}`);
        err.name = 'NoSuchKey';
        throw err;
      }
      return fs.createReadStream(ruta);
    },

    async asegurarBucket() {
      await fsp.mkdir(raiz, { recursive: true });
    },

    async verificar() {
      await fsp.mkdir(raiz, { recursive: true });
      await fsp.access(raiz, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    },

    /**
     * Handler de Express para GET /archivos-locales/*clave. Público: lo protege la firma.
     * @type {import('express').RequestHandler}
     */
    async manejarDescarga(req, res, next) {
      const segmentos = [].concat(req.params.clave ?? []);
      const clave = segmentos.join('/');
      const expira = Number(req.query.expira);
      const firma = typeof req.query.firma === 'string' ? req.query.firma : '';

      if (!Number.isInteger(expira) || expira < Math.floor(Date.now() / 1000)) {
        return next(new AppError(403, 'URL_VENCIDA', 'El enlace venció'));
      }
      let esperada;
      try {
        esperada = Buffer.from(firmar(validarClave(clave), expira), 'hex');
      } catch (err) {
        return next(err);
      }
      const recibida = Buffer.from(firma, 'hex');
      if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) {
        return next(new AppError(403, 'FIRMA_INVALIDA', 'El enlace no es válido'));
      }

      const ruta = rutaDe(clave);
      if (!(await existe(clave))) return next(noEncontrado());
      const { mime } = await leerMeta(ruta);
      res.set({
        'Content-Type': mime,
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      fs.createReadStream(ruta).on('error', next).pipe(res);
      return undefined;
    },
  };
}

module.exports = { crearAdaptadorDisco, validarClave, RUTA_DESCARGA };
