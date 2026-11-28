'use strict';

// Bandeja de notificaciones (32): cada usuario ve y marca solo las suyas. La creación es de
// core/notificaciones (agente 02).

const { Op } = require('sequelize');
const { noEncontrado } = require('../../core/errores');
const { respuestaPaginada } = require('../../core/http/paginar');

const modelos = () => require('../../models');

const iso = (f) => (f ? new Date(f).toISOString() : null);

const FILTRO_ESTADO = Object.freeze({
  todas: {},
  no_leidas: { leidaEn: null },
  leidas: { leidaEn: { [Op.ne]: null } },
});

function formatear(n) {
  return {
    id: n.id,
    tipo: n.tipo,
    categoria: n.datos?.categoria ?? null,
    titulo: n.titulo,
    cuerpo: n.cuerpo,
    enlace: n.datos?.enlace ?? null,
    solicitudId: n.solicitudId ?? null,
    leidaEn: iso(n.leidaEn),
    creadaEn: iso(n.createdAt),
  };
}

const contarNoLeidas = (usuarioId, transaction) =>
  modelos().Notificacion.count({ where: { usuarioId, leidaEn: null }, transaction });

/**
 * Notificaciones propias, de la más reciente a la más antigua.
 * @param {{ id: string }} usuario
 * @param {{ estado: 'todas' | 'no_leidas' | 'leidas', page: number, limit: number }} filtros
 */
async function listar(usuario, { estado, page, limit }) {
  const { Notificacion } = modelos();
  const { rows, count } = await Notificacion.findAndCountAll({
    where: { usuarioId: usuario.id, ...FILTRO_ESTADO[estado] },
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit,
    offset: (page - 1) * limit,
  });
  return {
    ...respuestaPaginada({ datos: rows.map(formatear), total: count, page, limit }),
    noLeidas: await contarNoLeidas(usuario.id),
  };
}

/** Marca una notificación propia como leída (si ya lo estaba, conserva la fecha). De otro → 404. */
async function marcarLeida(usuario, id) {
  const { Notificacion } = modelos();
  const notificacion = await Notificacion.findOne({ where: { id, usuarioId: usuario.id } });
  if (!notificacion) throw noEncontrado();
  if (!notificacion.leidaEn) await notificacion.update({ leidaEn: new Date() });
  return { notificacion: formatear(notificacion), noLeidas: await contarNoLeidas(usuario.id) };
}

/** Marca como leídas todas las notificaciones propias. */
async function leerTodas(usuario) {
  const { Notificacion } = modelos();
  const [marcadas] = await Notificacion.update(
    { leidaEn: new Date() },
    { where: { usuarioId: usuario.id, leidaEn: null } },
  );
  return { marcadas, noLeidas: 0 };
}

module.exports = { listar, marcarLeida, leerTodas };
