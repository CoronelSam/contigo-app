'use strict';

// Páginas de un documento (25): agregar, borrar y reordenar, solo con el documento en FALTA.
// El recorte y la perspectiva se hacen en el teléfono; aquí se validan tipo y tamaño.

const { Op } = require('sequelize');
const { guardarArchivo, calcularSha256 } = require('../../core/archivos');
const { registrarBitacora } = require('../../core/auditoria');
const { validacion } = require('../../core/errores');
const { ESTADOS_DOCUMENTO: D } = require('../../core/estados/constantes');
const errores = require('./documentos.errores');
const { MAX_PAGINAS } = require('./documentos.schemas');
const { documentoEditable } = require('./documentos.service');
const { idiomaDe, paginasDe, formatearPagina, documentoCompleto } = require('./documentos.util');

const modelos = () => require('../../models');

async function documentoEnFalta(usuario, documentoId, transaction) {
  const resultado = await documentoEditable(usuario, documentoId, transaction);
  if (resultado.documento.estado !== D.FALTA) {
    throw errores.noEditable(resultado.documento.estado);
  }
  return resultado;
}

/**
 * POST /documentos/:id/paginas. Devuelve `{ creada, pagina }`. Una imagen con el mismo hash que
 * otra página del documento es un reintento: se devuelve la página existente.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} documentoId
 * @param {Buffer | undefined} buffer
 * @param {{ orden?: number }} cuerpo
 */
async function agregarPagina(usuario, documentoId, buffer, { orden }) {
  if (!buffer?.length) throw validacion({ archivo: 'REQUERIDO' });
  const { sequelize, DocumentoPagina } = modelos();
  return sequelize.transaction(async (transaction) => {
    const { documento } = await documentoEnFalta(usuario, documentoId, transaction);
    const paginas = await paginasDe(documento.id, transaction);

    const hash = calcularSha256(buffer);
    const repetida = paginas.find((p) => p.archivo?.sha256 === hash);
    if (repetida) return { creada: false, pagina: formatearPagina(repetida) };

    if (!documento.tipoDocumento.admiteVariasPaginas && paginas.length >= 1) {
      throw errores.unaPagina();
    }
    if (paginas.length >= MAX_PAGINAS) throw errores.demasiadasPaginas(MAX_PAGINAS);
    const posicion = orden ?? paginas.length + 1;
    if (posicion > paginas.length + 1) throw errores.ordenInvalido();

    const archivo = await guardarArchivo({ buffer, prefijo: 'documentos', transaction });
    if (posicion <= paginas.length) {
      // La unicidad (documento, orden) se revisa al final de la transacción (DEFERRABLE).
      await DocumentoPagina.increment('orden', {
        by: 1,
        where: { documentoId: documento.id, orden: { [Op.gte]: posicion } },
        transaction,
      });
    }
    const pagina = await DocumentoPagina.create(
      { documentoId: documento.id, orden: posicion, archivoId: archivo.id },
      { transaction },
    );
    pagina.archivo = archivo;
    await registrarBitacora({
      accion: 'documentos.agregar_pagina',
      entidad: 'documentos',
      entidadId: documento.id,
      solicitudId: documento.solicitudId,
      despues: { paginaId: pagina.id, orden: posicion, archivoId: archivo.id },
      transaction,
    });
    return { creada: true, pagina: formatearPagina(pagina) };
  });
}

/**
 * DELETE /documentos/:id/paginas/:pid: borra la página y corre las siguientes. El archivo queda
 * guardado (sin dueño, no se puede abrir).
 * @param {{ id: string, rol: string }} usuario
 * @param {string} documentoId
 * @param {string} paginaId
 */
async function borrarPagina(usuario, documentoId, paginaId) {
  const { sequelize, DocumentoPagina } = modelos();
  await sequelize.transaction(async (transaction) => {
    const { documento } = await documentoEnFalta(usuario, documentoId, transaction);
    const pagina = await DocumentoPagina.findOne({
      where: { id: paginaId, documentoId: documento.id },
      transaction,
    });
    if (!pagina) throw errores.paginaNoEncontrada();
    await pagina.destroy({ transaction });
    await DocumentoPagina.decrement('orden', {
      by: 1,
      where: { documentoId: documento.id, orden: { [Op.gt]: pagina.orden } },
      transaction,
    });
    await registrarBitacora({
      accion: 'documentos.borrar_pagina',
      entidad: 'documentos',
      entidadId: documento.id,
      solicitudId: documento.solicitudId,
      antes: { paginaId: pagina.id, orden: pagina.orden, archivoId: pagina.archivoId },
      transaction,
    });
  });
}

/**
 * PUT /documentos/:id/paginas/orden: la lista debe tener exactamente las páginas del documento.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} documentoId
 * @param {{ paginas: string[] }} cuerpo
 */
async function reordenar(usuario, documentoId, { paginas: orden }) {
  const { sequelize, DocumentoPagina } = modelos();
  return sequelize.transaction(async (transaction) => {
    const { documento } = await documentoEnFalta(usuario, documentoId, transaction);
    const actuales = await DocumentoPagina.findAll({
      where: { documentoId: documento.id },
      transaction,
    });
    const ids = new Set(actuales.map((p) => p.id));
    const exacta =
      orden.length === actuales.length &&
      new Set(orden).size === orden.length &&
      orden.every((id) => ids.has(id));
    if (!exacta) throw errores.noEsPermutacion();

    const porId = new Map(actuales.map((p) => [p.id, p]));
    for (const [i, id] of orden.entries()) {
      const pagina = porId.get(id);
      if (pagina.orden !== i + 1) await pagina.update({ orden: i + 1 }, { transaction });
    }
    await registrarBitacora({
      accion: 'documentos.reordenar_paginas',
      entidad: 'documentos',
      entidadId: documento.id,
      solicitudId: documento.solicitudId,
      antes: { paginas: [...actuales].sort((a, b) => a.orden - b.orden).map((p) => p.id) },
      despues: { paginas: orden },
      transaction,
    });
    return documentoCompleto(documento, { idioma: idiomaDe(usuario), transaction });
  });
}

module.exports = { agregarPagina, borrarPagina, reordenar };
