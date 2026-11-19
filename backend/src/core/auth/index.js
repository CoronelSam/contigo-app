'use strict';

// Autenticación por petición y permisos por rol.
//
//   router.get('/x', requiereAuth, requierePermiso('solicitud.leer'), handler)
//
// requiereAuth deja `req.usuario = { id, rol, permisos: Set, idioma, nombres }`.

const { verificarAcceso } = require('./jwt');
const contexto = require('../contexto');
const { noAutenticado, sinPermiso } = require('../errores');

/** Caché de permisos por rol: los roles y permisos son de solo lectura en v1. */
let permisosPorRol;

async function cargarPermisos() {
  const { Rol } = require('../../models');
  const roles = await Rol.findAll({
    include: [{ association: 'permisos', attributes: ['codigo'] }],
  });
  return new Map(roles.map((r) => [r.codigo, new Set(r.permisos.map((p) => p.codigo))]));
}

/**
 * Permisos de un rol (con caché en memoria).
 * @param {string} rol
 * @returns {Promise<Set<string>>}
 */
async function permisosDe(rol) {
  permisosPorRol ??= await cargarPermisos();
  return permisosPorRol.get(rol) ?? new Set();
}

/** Solo pruebas o tras cambiar permisos por seeder. */
function invalidarCachePermisos() {
  permisosPorRol = undefined;
}

/**
 * Exige un JWT de acceso válido, una sesión vigente y un usuario activo.
 * El rol se toma de la base (un cambio de rol aplica de inmediato).
 * @type {import('express').RequestHandler}
 */
async function requiereAuth(req, res, next) {
  const encabezado = req.get('authorization') ?? '';
  const [tipo, token] = encabezado.split(' ');
  if (tipo !== 'Bearer' || !token) throw noAutenticado();

  const datos = verificarAcceso(token);
  const { Sesion } = require('../../models');
  const sesion = await Sesion.findByPk(datos.sid, {
    attributes: ['id', 'usuarioId', 'expiraEn', 'revocadaEn'],
    include: [
      {
        association: 'usuario',
        attributes: ['id', 'estado', 'idioma', 'nombres'],
        include: [{ association: 'rol', attributes: ['codigo'] }],
      },
    ],
  });
  const vigente =
    sesion &&
    !sesion.revocadaEn &&
    sesion.expiraEn > new Date() &&
    sesion.usuarioId === datos.sub &&
    sesion.usuario?.estado === 'activo';
  if (!vigente) throw noAutenticado('La sesión no es válida', 'SESION_INVALIDA');

  const rol = sesion.usuario.rol.codigo;
  req.usuario = {
    id: sesion.usuario.id,
    rol,
    permisos: await permisosDe(rol),
    idioma: sesion.usuario.idioma,
    nombres: sesion.usuario.nombres,
    sesionId: sesion.id,
  };
  contexto.asignarUsuario(req.usuario);
  next();
}

/**
 * Exige que el rol del usuario tenga todos los permisos indicados.
 * @param {...string} codigos
 * @returns {import('express').RequestHandler}
 */
function requierePermiso(...codigos) {
  return (req, res, next) => {
    if (!req.usuario) throw noAutenticado();
    const faltan = codigos.filter((c) => !req.usuario.permisos.has(c));
    if (faltan.length) throw sinPermiso();
    next();
  };
}

/** ¿El usuario tiene el permiso? (para decisiones dentro de un servicio). */
const tienePermiso = (usuario, codigo) => Boolean(usuario?.permisos?.has(codigo));

module.exports = {
  requiereAuth,
  requierePermiso,
  tienePermiso,
  permisosDe,
  invalidarCachePermisos,
};
