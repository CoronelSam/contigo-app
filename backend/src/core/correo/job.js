'use strict';

// Trabajo "correo.enviar": envía un correo encolado con encolarCorreo().

const { enviarCorreo } = require('./index');

/**
 * @param {{ plantilla: string, para: string, idioma?: 'es' | 'en', variables?: object }} datos
 * @param {{ trabajo: object, logger: import('pino').Logger }} _contexto
 */
module.exports = async function enviarCorreoEncolado(datos, _contexto) {
  await enviarCorreo(datos);
};
