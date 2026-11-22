'use strict';

// Utilidades del módulo documentos.

const { obtenerSolicitudConAcceso, esUuid } = require('../../core/acceso');
const { NoImplementado, noEncontrado } = require('../../core/errores');
const { emitirTrasCommit, EVENTOS } = require('../../core/eventos');
const { logger } = require('../../core/logger');
const ocr = require('../ocr/contratos');

const modelos = () => require('../../models');

const iso = (fecha) => (fecha ? new Date(fecha).toISOString() : null);
const idiomaDe = (usuario) => (usuario?.idioma === 'en' ? 'en' : 'es');
const enIdioma = (fila, campo, idioma) =>
  fila?.[`${campo}${idioma === 'en' ? 'En' : 'Es'}`] ?? null;

/**
 * Llama a un contrato del OCR (agente 07). Mientras el contrato siga como stub, el documento sigue
 * su curso sin OCR: se registra un aviso en el log en vez de fallar.
 * @param {'encolarExtraccion' | 'cancelarExtraccion'} nombre
 * @param {{ documentoId: string, transaction: import('sequelize').Transaction }} argumentos
 */
async function llamarOcr(nombre, argumentos) {
  try {
    return await ocr[nombre](argumentos);
  } catch (err) {
    if (!(err instanceof NoImplementado)) throw err;
    logger.warn({ contrato: nombre, documentoId: argumentos.documentoId }, 'OCR no implementado');
    return null;
  }
}

/**
 * Carga el documento (bloqueado si se pide) y la solicitud, si el usuario tiene relación con ella.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} documentoId
 * @param {{ transaction?: import('sequelize').Transaction, bloquear?: boolean }} [opciones]
 */
async function documentoConAcceso(usuario, documentoId, { transaction, bloquear = false } = {}) {
  if (!esUuid(documentoId)) throw noEncontrado();
  const { Documento } = modelos();
  const documento = await Documento.findByPk(documentoId, {
    include: [{ association: 'tipoDocumento' }],
    transaction,
    ...(bloquear ? { lock: { level: transaction.LOCK.UPDATE, of: Documento } } : {}),
  });
  if (!documento) throw noEncontrado();
  const solicitud = await obtenerSolicitudConAcceso(usuario, documento.solicitudId, {
    transaction,
  });
  return { documento, solicitud };
}

/** Páginas en orden, con los datos del archivo. */
async function paginasDe(documentoIds, transaction) {
  const { DocumentoPagina } = modelos();
  const ids = [].concat(documentoIds);
  if (!ids.length) return [];
  return DocumentoPagina.findAll({
    where: { documentoId: ids },
    include: [{ association: 'archivo', attributes: ['id', 'mime', 'ancho', 'alto', 'sha256'] }],
    order: [
      ['documentoId', 'ASC'],
      ['orden', 'ASC'],
    ],
    transaction,
  });
}

/** Última extracción de cada documento: Map<documentoId, Extraccion>. */
async function ultimasExtracciones(documentoIds, transaction) {
  const { Extraccion } = modelos();
  const ids = [].concat(documentoIds);
  const mapa = new Map();
  if (!ids.length) return mapa;
  const filas = await Extraccion.findAll({
    where: { documentoId: ids },
    order: [['createdAt', 'DESC']],
    transaction,
  });
  for (const e of filas) if (!mapa.has(e.documentoId)) mapa.set(e.documentoId, e);
  return mapa;
}

const formatearPagina = (p) => ({
  id: p.id,
  orden: p.orden,
  archivoId: p.archivoId,
  mime: p.archivo?.mime ?? null,
  ancho: p.archivo?.ancho ?? null,
  alto: p.archivo?.alto ?? null,
});

const formatearExtraccion = (e) =>
  e ? { id: e.id, estado: e.estado, progreso: e.progreso } : null;

/**
 * Documento con sus páginas y su última extracción.
 * @param {object} documento Instancia con `tipoDocumento` incluido.
 * @param {{ paginas?: object[], extraccion?: object | null, idioma?: string }} extras
 */
function formatearDocumento(documento, { paginas = [], extraccion = null, idioma = 'es' } = {}) {
  const tipo = documento.tipoDocumento;
  return {
    id: documento.id,
    solicitudId: documento.solicitudId,
    tipoDocumento: { id: tipo.id, codigo: tipo.codigo, nombre: enIdioma(tipo, 'nombre', idioma) },
    version: documento.version,
    vigente: documento.vigente,
    reemplazaA: documento.reemplazaA ?? null,
    estado: documento.estado,
    origen: documento.origen,
    paginasDeclaradas: documento.paginasDeclaradas ?? null,
    capturadoEn: iso(documento.capturadoEn),
    validadoEn: iso(documento.validadoEn),
    motivoRechazo: documento.motivoRechazo ?? null,
    paginas: paginas.map(formatearPagina),
    extraccion: formatearExtraccion(extraccion),
    creadoEn: iso(documento.createdAt),
  };
}

/** Documento ya formateado, leyendo sus páginas y su extracción. */
async function documentoCompleto(documento, { idioma, transaction } = {}) {
  const [paginas, extracciones] = [
    await paginasDe(documento.id, transaction),
    await ultimasExtracciones(documento.id, transaction),
  ];
  return formatearDocumento(documento, {
    paginas,
    extraccion: extracciones.get(documento.id) ?? null,
    idioma,
  });
}

/** Emite `documento.estado_cambiado` tras el commit (solo ids y códigos). */
function emitirCambio(transaction, documento, de) {
  emitirTrasCommit(transaction, EVENTOS.DOCUMENTO_ESTADO_CAMBIADO, {
    documentoId: documento.id,
    solicitudId: documento.solicitudId,
    tipoDocumentoId: documento.tipoDocumentoId,
    de,
    a: documento.estado,
  });
}

module.exports = {
  iso,
  idiomaDe,
  enIdioma,
  llamarOcr,
  documentoConAcceso,
  paginasDe,
  ultimasExtracciones,
  formatearPagina,
  formatearExtraccion,
  formatearDocumento,
  documentoCompleto,
  emitirCambio,
};
