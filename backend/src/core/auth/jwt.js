'use strict';

const jwt = require('jsonwebtoken');
const { config } = require('../../config/env');
const { noAutenticado } = require('../errores');

const EMISOR = 'vanguardia-api';
const AUDIENCIA = 'vanguardia-app';
const ALGORITMO = 'HS256';

/**
 * Firma un token de acceso de corta duración.
 * @param {{ sub: string, rol: string, sid: string }} datos Usuario, rol y sesión.
 * @returns {{ token: string, expiraEn: string }}
 */
function firmarAcceso({ sub, rol, sid }) {
  const { secreto, accesoTtl } = config().jwt;
  const token = jwt.sign({ rol, sid }, secreto, {
    subject: String(sub),
    algorithm: ALGORITMO,
    expiresIn: accesoTtl,
    issuer: EMISOR,
    audience: AUDIENCIA,
  });
  const { exp } = jwt.decode(token);
  return { token, expiraEn: new Date(exp * 1000).toISOString() };
}

/**
 * Verifica un token de acceso. Lanza 401 si es inválido o venció.
 * El middleware `requiereAuth` (agente 02) además revisa la sesión y el estado del usuario.
 * @param {string} token
 * @returns {{ sub: string, rol: string, sid: string, exp: number }}
 */
function verificarAcceso(token) {
  try {
    return jwt.verify(token, config().jwt.secreto, {
      algorithms: [ALGORITMO],
      issuer: EMISOR,
      audience: AUDIENCIA,
    });
  } catch (err) {
    if (err?.name === 'TokenExpiredError') throw noAutenticado('El token venció', 'TOKEN_VENCIDO');
    throw noAutenticado('Token inválido');
  }
}

module.exports = { firmarAcceso, verificarAcceso };
