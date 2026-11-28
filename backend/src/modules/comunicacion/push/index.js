'use strict';

// Proveedor de push según PUSH_PROVEEDOR: `fcm` (Firebase) o `simulado` (por defecto).
// Interfaz: enviar({ tokens, titulo, cuerpo, datos }) → [{ token, ok, error }], con `error` en
// los códigos de FCM sin el prefijo `messaging/`.

const { config } = require('../../../config/env');
const simulado = require('./simulado');
const { crearProveedorFcm } = require('./fcm');

/** Errores que significan que el token ya no sirve: el dispositivo se borra. */
const TOKEN_INVALIDO = Object.freeze(
  new Set(['registration-token-not-registered', 'invalid-registration-token']),
);

let actual;

function obtenerProveedor() {
  if (!actual) {
    const cfg = config().push;
    actual = cfg.proveedor === 'fcm' ? crearProveedorFcm(cfg) : simulado.proveedor;
  }
  return actual;
}

module.exports = { obtenerProveedor, TOKEN_INVALIDO, simulado };
