'use strict';

// Stub del trabajo "paquete.generar". Lo implementa el agente 11 (Paquete PDF, envío y respuesta).

const { NoImplementado } = require('../../../core/errores');

/**
 * @param {object} _datos { paqueteId }
 * @param {{ trabajo: object, logger: import('pino').Logger }} _contexto
 */
module.exports = async function generarPaquete(_datos, _contexto) {
  throw new NoImplementado('El trabajo paquete.generar');
};
