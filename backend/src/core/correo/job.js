'use strict';

// Stub del trabajo "correo.enviar". Lo implementa el agente 02 (Núcleo de dominio).

const { NoImplementado } = require('../errores');

/**
 * @param {object} _datos { plantilla, para, idioma, variables }
 * @param {{ trabajo: object, logger: import('pino').Logger }} _contexto
 */
module.exports = async function enviarCorreo(_datos, _contexto) {
  throw new NoImplementado('El trabajo correo.enviar');
};
