'use strict';

// Estado de la asignación del voluntario (pantalla 36). Es de la asignación, no del caso, y se
// RECALCULA siempre desde los datos: al recibir eventos de documentos, OCR y estado del caso, y al
// listar casos. Así se corrige solo si se perdió un evento.
//
// Si la regla no encaja con el manual, se ajusta solo en `estadoSegun`.

const { Op } = require('sequelize');
const { estadoExpediente } = require('../../core/expediente');
const { ESTADOS_DOCUMENTO: D } = require('../../core/estados/constantes');
const { logger } = require('../../core/logger');

const ESTADOS = Object.freeze({
  ASIGNADO: 'asignado',
  PENDIENTE_CAPTURA: 'pendiente_captura',
  CAPTURA_EN_PROCESO: 'captura_en_proceso',
  EN_REVISION: 'en_revision',
  REVISADO: 'revisado',
});

const modelos = () => require('../../models');

/**
 * Hechos del caso que deciden el estado, más los pendientes que ve el voluntario.
 * @param {string} solicitudId
 * @param {{ transaction?: import('sequelize').Transaction }} [opciones]
 */
async function analizarCaso(solicitudId, { transaction } = {}) {
  const { Documento, DocumentoPagina, Extraccion, sequelize } = modelos();
  const expediente = await estadoExpediente(solicitudId, { transaction });
  const documentos = await Documento.findAll({
    where: { solicitudId, vigente: true },
    attributes: ['id', 'estado'],
    transaction,
  });
  const ids = documentos.map((d) => d.id);

  const conteos = ids.length
    ? await DocumentoPagina.findAll({
        where: { documentoId: ids },
        attributes: ['documentoId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
        group: ['documentoId'],
        raw: true,
        transaction,
      })
    : [];
  const paginas = new Map(conteos.map((c) => [c.documentoId, Number(c.n)]));

  const extracciones = ids.length
    ? await Extraccion.findAll({
        where: { documentoId: ids },
        attributes: ['documentoId', 'estado', 'createdAt'],
        order: [['createdAt', 'DESC']],
        transaction,
      })
    : [];
  const ultima = new Map();
  for (const e of extracciones) if (!ultima.has(e.documentoId)) ultima.set(e.documentoId, e.estado);
  const estadosOcr = [...ultima.values()];

  const sinPaginas = (d) => d.estado === D.FALTA && !(paginas.get(d.documentoId) > 0);
  const pendientesDocumentos = expediente.documentos.filter(
    (r) =>
      r.obligatorio &&
      !r.cubiertoPorFormulario &&
      (!r.documentoId || r.estado === D.RECHAZADO || sinPaginas(r)),
  ).length;

  return {
    revisionesOcr: estadosOcr.filter((e) => e === 'por_confirmar').length,
    ocrEnCurso: estadosOcr.some((e) => e === 'en_cola' || e === 'procesando'),
    capturaAbierta: documentos.some((d) => d.estado === D.FALTA && paginas.get(d.id) > 0),
    huboCaptura:
      documentos.some((d) => d.estado !== D.FALTA) || [...paginas.values()].some((n) => n > 0),
    pendientesDocumentos,
    extracciones: estadosOcr.length,
    todasConfirmadas: estadosOcr.length > 0 && estadosOcr.every((e) => e === 'confirmada'),
  };
}

/**
 * Regla del estado (gana la primera que se cumple):
 * 1. en_revision: hay una extracción por confirmar en un documento vigente.
 * 2. captura_en_proceso: un documento vigente en FALTA ya tiene páginas, o hay OCR en cola o en
 *    proceso.
 * 3. pendiente_captura: falta un requisito obligatorio (sin documento, rechazado o en FALTA sin
 *    páginas) y ya hubo alguna captura en el caso.
 * 4. revisado: todas las extracciones de los documentos vigentes están confirmadas (y hay alguna).
 * 5. asignado: ninguna de las anteriores.
 */
function estadoSegun(h) {
  if (h.revisionesOcr > 0) return ESTADOS.EN_REVISION;
  if (h.capturaAbierta || h.ocrEnCurso) return ESTADOS.CAPTURA_EN_PROCESO;
  if (h.pendientesDocumentos > 0 && h.huboCaptura) return ESTADOS.PENDIENTE_CAPTURA;
  if (h.todasConfirmadas) return ESTADOS.REVISADO;
  return ESTADOS.ASIGNADO;
}

/**
 * Recalcula y guarda el estado de las asignaciones activas del caso. Idempotente: si nada
 * cambió, no escribe.
 * @param {string} solicitudId
 * @param {{ transaction?: import('sequelize').Transaction }} [opciones]
 * @returns {Promise<{ estado: string, hechos: object } | null>} null si el caso no tiene
 *   asignaciones activas.
 */
async function recalcularEstadoAsignacion(solicitudId, { transaction } = {}) {
  const { Asignacion } = modelos();
  const activas = await Asignacion.count({ where: { solicitudId, activa: true }, transaction });
  if (!activas) return null;
  const hechos = await analizarCaso(solicitudId, { transaction });
  const estado = estadoSegun(hechos);
  await Asignacion.update(
    { estado },
    { where: { solicitudId, activa: true, estado: { [Op.ne]: estado } }, transaction },
  );
  return { estado, hechos };
}

/** Handler de los eventos que pueden cambiar el estado. Nunca lanza hacia quien emite. */
async function alCambiarCaso(datos) {
  if (!datos?.solicitudId) return;
  try {
    await recalcularEstadoAsignacion(datos.solicitudId);
  } catch (err) {
    logger.error({ err, solicitudId: datos.solicitudId }, 'No se pudo recalcular la asignación');
  }
}

module.exports = {
  ESTADOS,
  analizarCaso,
  estadoSegun,
  recalcularEstadoAsignacion,
  alCambiarCaso,
};
