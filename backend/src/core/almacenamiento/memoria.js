'use strict';

// Adaptador en memoria para pruebas. Nunca se usa en producción (lo impide config/env).

const { Readable } = require('node:stream');

function crearAdaptadorMemoria(cfg) {
  /** @type {Map<string, { cuerpo: Buffer, mime: string }>} */
  const objetos = new Map();

  return {
    objetos,

    async subirObjeto({ clave, cuerpo, mime }) {
      objetos.set(clave, { cuerpo: Buffer.from(cuerpo), mime });
      return { clave };
    },

    async urlFirmadaGet(clave, segundos = cfg.urlFirmadaSegundos) {
      const expira = Math.floor(Date.now() / 1000) + segundos;
      return `memoria://${cfg.bucket}/${encodeURIComponent(clave)}?expira=${expira}`;
    },

    async existeObjeto(clave) {
      return objetos.has(clave);
    },

    async leerObjeto(clave) {
      const objeto = objetos.get(clave);
      if (!objeto) {
        const err = new Error(`No existe el objeto ${clave}`);
        err.name = 'NoSuchKey';
        throw err;
      }
      return Readable.from(objeto.cuerpo);
    },

    async asegurarBucket() {},

    async verificar() {
      return true;
    },
  };
}

module.exports = { crearAdaptadorMemoria };
