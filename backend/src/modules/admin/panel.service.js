'use strict';

// Panel del administrador (51). Solo cifras y actividad administrativa: ningún dato de niños ni
// de solicitudes individuales.

const { QueryTypes } = require('sequelize');
const { ejecutarChequeos } = require('../../core/salud');
const { LISTA_ESTADOS_SOLICITUD, LISTA_ROLES, ROLES } = require('../../core/estados/constantes');
const { ESTADOS } = require('./usuarios.service');

const modelos = () => require('../../models');

const ACTIVIDAD_RECIENTE = 10;

async function usuariosPorRol() {
  const { sequelize } = modelos();
  const filas = await sequelize.query(
    `SELECT r.codigo AS rol, u.estado, count(*)::int AS n
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      GROUP BY r.codigo, u.estado`,
    { type: QueryTypes.SELECT },
  );
  const porRol = Object.fromEntries(
    LISTA_ROLES.map((rol) => [
      rol,
      { ...Object.fromEntries(ESTADOS.map((e) => [e, 0])), total: 0 },
    ]),
  );
  for (const f of filas) {
    porRol[f.rol][f.estado] = f.n;
    porRol[f.rol].total += f.n;
  }
  return { total: filas.reduce((s, f) => s + f.n, 0), porRol };
}

async function solicitudesPorEstado() {
  const { sequelize } = modelos();
  const filas = await sequelize.query(
    'SELECT estado, count(*)::int AS n FROM solicitudes GROUP BY estado',
    { type: QueryTypes.SELECT },
  );
  const porEstado = Object.fromEntries(LISTA_ESTADOS_SOLICITUD.map((e) => [e, 0]));
  for (const f of filas) porEstado[f.estado] = f.n;
  return { total: filas.reduce((s, f) => s + f.n, 0), porEstado };
}

/** Lo que hicieron los administradores fuera de los expedientes (sin el antes ni el después). */
async function actividadAdministrativa() {
  const { sequelize } = modelos();
  const filas = await sequelize.query(
    `SELECT b.id, b.accion, b.entidad, b.entidad_id, b.created_at,
            u.id AS usuario_id, concat_ws(' ', u.nombres, u.apellidos) AS usuario_nombre
       FROM bitacora b
       JOIN usuarios u ON u.id = b.usuario_id
       JOIN roles r ON r.id = u.rol_id
      WHERE b.solicitud_id IS NULL AND r.codigo = :rol
      ORDER BY b.created_at DESC, b.id
      LIMIT :limite`,
    {
      replacements: { rol: ROLES.ADMINISTRADOR, limite: ACTIVIDAD_RECIENTE },
      type: QueryTypes.SELECT,
    },
  );
  return filas.map((f) => ({
    id: f.id,
    accion: f.accion,
    entidad: f.entidad,
    entidadId: f.entidad_id ?? null,
    usuario: { id: f.usuario_id, nombre: f.usuario_nombre },
    fecha: new Date(f.created_at).toISOString(),
  }));
}

/**
 * GET /admin/resumen
 * @param {{ logger?: import('pino').Logger }} [opciones]
 */
async function resumen({ logger } = {}) {
  const { Extraccion } = modelos();
  const [usuarios, solicitudes, documentosProcesados, sistema, actividad] = await Promise.all([
    usuariosPorRol(),
    solicitudesPorEstado(),
    Extraccion.count({ where: { estado: 'confirmada' } }),
    ejecutarChequeos({ logger }),
    actividadAdministrativa(),
  ]);
  return { usuarios, solicitudes, documentosProcesados, sistema, actividad };
}

module.exports = { resumen };
