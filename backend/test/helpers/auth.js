'use strict';

const crypto = require('node:crypto');
const { Sesion } = require('../../src/models');
const { firmarAcceso } = require('../../src/core/auth/jwt');

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Crea una sesión vigente para el usuario y devuelve un JWT de acceso válido.
 * Uso: api().get('/x').set('Authorization', `Bearer ${await tokenPara(usuario)}`)
 *
 * @param {import('sequelize').Model & { id: string, rolCodigo?: string }} usuario
 * @returns {Promise<string>}
 */
async function tokenPara(usuario) {
  const rol = usuario.rolCodigo ?? (await usuario.getRol()).codigo;
  const sesion = await Sesion.create({
    usuarioId: usuario.id,
    hashRefresh: crypto.randomBytes(32).toString('hex'),
    cadenaId: crypto.randomUUID(),
    dispositivo: 'pruebas',
    expiraEn: new Date(Date.now() + 30 * DIA_MS),
  });
  return firmarAcceso({ sub: usuario.id, rol, sid: sesion.id }).token;
}

/** Cabecera Authorization lista para supertest. */
async function cabeceraPara(usuario) {
  return { Authorization: `Bearer ${await tokenPara(usuario)}` };
}

module.exports = { tokenPara, cabeceraPara };
