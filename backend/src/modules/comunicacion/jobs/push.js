'use strict';

// Stub del trabajo "notificacion.push". Lo implementa el agente 12 (Mensajes y notificaciones).

const { NoImplementado } = require('../../../core/errores');

/**
 * @param {object} _datos { notificacionId }
 * @param {{ trabajo: object, logger: import('pino').Logger }} _contexto
 */
module.exports = async function enviarPush(_datos, _contexto) {
  throw new NoImplementado('El trabajo notificacion.push');
};
