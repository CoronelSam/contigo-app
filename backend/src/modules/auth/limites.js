'use strict';

// Límites de intentos. Por IP en /auth/*, por usuario en el reenvío de verificación.
// En memoria del proceso: con varias instancias de la API, cada una cuenta aparte.

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { config } = require('../../config/env');
const { demasiadosIntentos } = require('../../core/errores');

const MINUTO = 60 * 1000;

/**
 * @param {{ ventanaMs: number, maximo: number, porUsuario?: boolean }} opciones
 * @returns {import('express').RequestHandler}
 */
function crearLimitador({ ventanaMs, maximo, porUsuario = false }) {
  return rateLimit({
    windowMs: ventanaMs,
    limit: maximo,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: porUsuario
      ? (req) => req.usuario?.id ?? ipKeyGenerator(req.ip ?? '')
      : (req) => ipKeyGenerator(req.ip ?? ''),
    handler: (req, res, next) => next(demasiadosIntentos()),
  });
}

const { limites } = config().jwt;

module.exports = {
  crearLimitador,
  login: crearLimitador({ ventanaMs: 15 * MINUTO, maximo: limites.loginPor15Min }),
  registro: crearLimitador({ ventanaMs: 15 * MINUTO, maximo: limites.loginPor15Min }),
  recuperar: crearLimitador({ ventanaMs: 60 * MINUTO, maximo: limites.recuperarPorHora }),
  reenvio: crearLimitador({
    ventanaMs: 60 * MINUTO,
    maximo: limites.reenvioPorHora,
    porUsuario: true,
  }),
};
