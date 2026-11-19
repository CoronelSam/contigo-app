'use strict';

// Monta el router de cada módulo bajo /api/v1, en este orden fijo.
// El módulo "salud" se monta en la raíz desde app.js (/health, /openapi.json, /docs).

const { Router } = require('express');

const MODULOS = Object.freeze([
  'auth', // 03
  'familias', // 04
  'solicitudes', // 05
  'documentos', // 06
  'ocr', // 07
  'voluntario', // 08
  'coordinador', // 09
  'ruta', // 10
  'paquetes', // 11
  'comunicacion', // 12
  'admin', // 13
]);

/** Router de /api/v1 con todos los módulos montados. */
function crearRutasApi() {
  const router = Router();
  for (const modulo of MODULOS) {
    router.use(require(`./modules/${modulo}`));
  }
  return router;
}

module.exports = { crearRutasApi, MODULOS };
