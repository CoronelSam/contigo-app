'use strict';

// Creación de notificaciones de la bandeja. El envío push lo hace el trabajo
// notificacion.push (agente 12), que se encola después del commit.

const cola = require('../cola');
const T = require('../cola/trabajos');
const { PLANTILLAS, TIPOS, CATEGORIAS, renderizar } = require('./plantillas');

/**
 * Crea una notificación por destinatario, en su idioma, y encola su push tras el commit.
 * Destinatarios: `usuarioIds` o todos los usuarios activos de un `rol`. Solo usuarios activos.
 *
 * @param {{ usuarioIds?: string[], rol?: string, tipo: string, variables?: Record<string, unknown>,
 *   solicitudId?: string | null, transaction?: import('sequelize').Transaction }} p
 * @returns {Promise<object[]>} Notificaciones creadas.
 */
async function notificar({ usuarioIds, rol, tipo, variables = {}, solicitudId, transaction }) {
  if (!PLANTILLAS[tipo]) throw new Error(`Tipo de notificación desconocido: ${tipo}`);
  const { Usuario, Notificacion } = require('../../models');

  let usuarios = [];
  if (usuarioIds?.length) {
    usuarios = await Usuario.findAll({
      where: { id: [...new Set(usuarioIds)], estado: 'activo' },
      attributes: ['id', 'idioma'],
      transaction,
    });
  } else if (rol) {
    usuarios = await Usuario.findAll({
      where: { estado: 'activo' },
      attributes: ['id', 'idioma'],
      include: [{ association: 'rol', where: { codigo: rol }, attributes: [] }],
      transaction,
    });
  }
  if (!usuarios.length) return [];

  const idSolicitud = solicitudId ?? variables.solicitudId ?? null;
  const datosVariables = { ...variables, solicitudId: idSolicitud };
  const filas = usuarios.map((u) => {
    const r = renderizar(tipo, u.idioma, datosVariables);
    return {
      usuarioId: u.id,
      tipo,
      titulo: r.titulo,
      cuerpo: r.cuerpo,
      idioma: u.idioma,
      datos: { enlace: r.enlace, categoria: r.categoria, solicitudId: idSolicitud },
      solicitudId: idSolicitud,
    };
  });
  const creadas = await Notificacion.bulkCreate(filas, { transaction, returning: true });
  for (const n of creadas) {
    await cola.encolarTrasCommit(transaction, T.NOTIFICACION_PUSH, { notificacionId: n.id });
  }
  return creadas;
}

module.exports = { notificar, renderizar, TIPOS, CATEGORIAS, PLANTILLAS };
