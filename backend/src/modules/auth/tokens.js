'use strict';

// Secretos opacos (refresh y tokens de un solo uso). Solo se guarda su hash SHA-256.

const crypto = require('node:crypto');
const { config } = require('../../config/env');

/** Vigencia de cada tipo de token de un solo uso. */
const DURACION_MS = Object.freeze({
  recuperar: 45 * 60 * 1000,
  verificar_correo: 24 * 60 * 60 * 1000,
  invitar: 72 * 60 * 60 * 1000,
});

/** Ruta del deep link de la app para cada tipo de token. */
const RUTA_ENLACE = Object.freeze({
  recuperar: 'restablecer-contrasena',
  verificar_correo: 'verificar-correo',
  invitar: 'aceptar-invitacion',
});

/** 32 bytes aleatorios en base64url. */
const generarSecreto = () => crypto.randomBytes(32).toString('base64url');

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Enlace que abre la app (APP_ENLACE_BASE) con el token. Nunca lleva el correo.
 * Lo usa también el agente 13 para las invitaciones.
 * @param {'recuperar' | 'verificar_correo' | 'invitar'} tipo
 * @param {string} token
 */
function enlaceDeToken(tipo, token) {
  return `${config().http.enlaceBase}${RUTA_ENLACE[tipo]}?token=${encodeURIComponent(token)}`;
}

module.exports = { DURACION_MS, RUTA_ENLACE, generarSecreto, hashToken, enlaceDeToken };
