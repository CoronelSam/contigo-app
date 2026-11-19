'use strict';

const pino = require('pino');

/**
 * Rutas que pino reemplaza por "[REDACTADO]". Nunca registres cuerpos de petición completos:
 * pueden contener datos médicos de menores.
 */
const RUTAS_REDACTADAS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'authorization',
  'contrasena',
  'password',
  'token',
  'refreshToken',
  'accessToken',
  '*.authorization',
  '*.contrasena',
  '*.contrasenaActual',
  '*.nueva',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secreto',
];

/**
 * Crea un logger de pino con redacción de datos sensibles.
 * @param {{ nivel?: string, destino?: import('pino').DestinationStream }} [opciones]
 */
function crearLogger({ nivel, destino } = {}) {
  const opciones = {
    level: nivel ?? process.env.LOG_LEVEL ?? 'info',
    base: { servicio: 'vanguardia-backend' },
    redact: { paths: RUTAS_REDACTADAS, censor: '[REDACTADO]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return destino ? pino(opciones, destino) : pino(opciones);
}

/** Logger compartido por la API y el worker. */
const logger = crearLogger({
  nivel: process.env.NODE_ENV === 'test' && !process.env.LOG_LEVEL ? 'silent' : undefined,
});

module.exports = { logger, crearLogger, RUTAS_REDACTADAS };
