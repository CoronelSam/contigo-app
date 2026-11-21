'use strict';

// Contratos del módulo auth (dueño: agente 03). Los usa el agente 13 (administración).

const servicio = require('./auth.service');

/**
 * Emite un token de un solo uso (solo se guarda su hash) e invalida los anteriores del mismo
 * tipo. Devuelve el token en claro SOLO a quien llama, para armar el enlace del correo
 * (usa `enlaceDeToken` de `modules/auth/tokens.js`).
 *
 * @param {{ usuarioId: string, tipo: 'recuperar' | 'invitar' | 'verificar_correo',
 *   transaction?: import('sequelize').Transaction }} p
 * @returns {Promise<{ token: string, expiraEn: Date }>}
 */
async function emitirToken({ usuarioId, tipo, transaction }) {
  return servicio.emitirToken({ usuarioId, tipo, transaction });
}

/**
 * Revoca todas las sesiones del usuario (desactivación, cambio de contraseña).
 *
 * @param {{ usuarioId: string, transaction?: import('sequelize').Transaction }} p
 * @returns {Promise<number>} Cuántas sesiones se revocaron.
 */
async function revocarSesiones({ usuarioId, transaction }) {
  return servicio.revocarSesiones({ usuarioId, transaction });
}

module.exports = { emitirToken, revocarSesiones };
