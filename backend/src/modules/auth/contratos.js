'use strict';

// Contratos del módulo auth (dueño: agente 03). Stub creado por el agente 02:
// el agente 03 implementa el cuerpo SIN cambiar la firma. Los usa el agente 13.

const { NoImplementado } = require('../../core/errores');

/**
 * Emite un token de un solo uso (solo se guarda su hash) e invalida los anteriores del mismo
 * tipo. Devuelve el token en claro SOLO a quien llama, para armar el enlace del correo.
 *
 * @param {{ usuarioId: string, tipo: 'recuperar' | 'invitar' | 'verificar_correo',
 *   transaction?: import('sequelize').Transaction }} p
 * @returns {Promise<{ token: string, expiraEn: Date }>}
 */
// eslint-disable-next-line no-unused-vars
async function emitirToken({ usuarioId, tipo, transaction }) {
  throw new NoImplementado('emitirToken (agente 03)');
}

/**
 * Revoca todas las sesiones del usuario (desactivación, cambio de contraseña).
 *
 * @param {{ usuarioId: string, transaction?: import('sequelize').Transaction }} p
 * @returns {Promise<number>} Cuántas sesiones se revocaron.
 */
// eslint-disable-next-line no-unused-vars
async function revocarSesiones({ usuarioId, transaction }) {
  throw new NoImplementado('revocarSesiones (agente 03)');
}

module.exports = { emitirToken, revocarSesiones };
