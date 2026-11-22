'use strict';

// Documentos versionados con varias páginas (22–27, 37 y la validación de la 44).
// Recorrido del anexo B: FALTA → páginas → CAPTURADO → (OCR confirmado) → VALIDADO, o RECHAZADO
// con una corrección, y una versión nueva que vuelve a empezar. Capturar no es validar.

const { Op } = require('sequelize');
const { obtenerSolicitudConAcceso, exigirEdicion, esUuid } = require('../../core/acceso');
const { registrarBitacora } = require('../../core/auditoria');
const { estadoExpediente, rutasActivas } = require('../../core/expediente');
const { emitirTrasCommit, EVENTOS } = require('../../core/eventos');
const { ESTADOS_DOCUMENTO: D, ROLES } = require('../../core/estados/constantes');
const errores = require('./documentos.errores');
const {
  idiomaDe,
  enIdioma,
  llamarOcr,
  documentoConAcceso,
  paginasDe,
  ultimasExtracciones,
  formatearPagina,
  formatearExtraccion,
  documentoCompleto,
  emitirCambio,
} = require('./documentos.util');
const {
  formatearCorreccion,
  cerrarPorDocumento,
  reabrirPorDocumento,
} = require('./correcciones.service');

/** Estados de extracción que significan "el OCR todavía no está revisado" (igual que el núcleo). */
const OCR_PENDIENTE = new Set(['en_cola', 'procesando', 'por_confirmar', 'fallida']);
/** Mientras el OCR no terminó, cancelar devuelve el documento a FALTA. */
const OCR_EN_CURSO = new Set(['en_cola', 'procesando']);

const modelos = () => require('../../models');

const nombreCompleto = (p) =>
  [p.nombres, p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' ');

function formatearTipo(tipo, idioma) {
  return {
    id: tipo.id,
    codigo: tipo.codigo,
    nombre: enIdioma(tipo, 'nombre', idioma),
    categoria: tipo.categoria,
    paraQueSirve: enIdioma(tipo, 'paraQueSirve', idioma),
    comoFotografiar: enIdioma(tipo, 'comoFotografiar', idioma),
    admiteVariasPaginas: tipo.admiteVariasPaginas,
    paginasEsperadas: tipo.paginasEsperadas ?? null,
  };
}

/**
 * GET /solicitudes/:id/documentos: requisitos activos del caso, en orden, con el documento vigente
 * y la corrección abierta de cada uno.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 */
async function listarRequisitos(usuario, solicitudId) {
  const { TipoDocumento, SolicitudCorreccion } = modelos();
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const idioma = idiomaDe(usuario);
  const expediente = await estadoExpediente(solicitud.id);

  const documentoIds = expediente.documentos.map((d) => d.documentoId).filter(Boolean);
  const [tipos, paginas, extracciones, correcciones] = [
    await TipoDocumento.findAll({
      where: { id: expediente.documentos.map((d) => d.tipoDocumentoId) },
    }),
    await paginasDe(documentoIds),
    await ultimasExtracciones(documentoIds),
    await SolicitudCorreccion.findAll({
      where: { solicitudId: solicitud.id, estado: 'abierta', documentoId: { [Op.ne]: null } },
      include: [{ association: 'documento', include: [{ association: 'tipoDocumento' }] }],
      order: [['createdAt', 'DESC']],
    }),
  ];
  const tipoPorId = new Map(tipos.map((t) => [t.id, t]));
  const correccionPorTipo = new Map();
  for (const c of correcciones) {
    const tipoId = c.documento.tipoDocumentoId;
    if (!correccionPorTipo.has(tipoId)) correccionPorTipo.set(tipoId, c);
  }

  return {
    solicitudId: solicitud.id,
    etapa: expediente.etapa,
    rutas: expediente.rutasRequisitos,
    requisitos: expediente.documentos.map((r) => {
      const correccion = correccionPorTipo.get(r.tipoDocumentoId);
      return {
        requisitoId: r.requisitoId,
        ruta: r.ruta,
        tipoDocumento: formatearTipo(tipoPorId.get(r.tipoDocumentoId), idioma),
        obligatorio: r.obligatorio,
        orden: r.orden,
        cubiertoPorFormulario: r.cubiertoPorFormulario,
        cumplido: r.cumplido,
        estado: r.estado,
        documento: r.documentoId
          ? {
              id: r.documentoId,
              estado: r.estado,
              version: r.version,
              paginas: paginas.filter((p) => p.documentoId === r.documentoId).map(formatearPagina),
              extraccion: formatearExtraccion(extracciones.get(r.documentoId)),
            }
          : null,
        correccion: correccion ? formatearCorreccion(correccion, idioma) : null,
      };
    }),
  };
}

/**
 * GET /tipos-documento/:id: textos de ayuda (23) en el idioma del usuario.
 * @param {{ idioma?: string }} usuario
 * @param {string} tipoId
 */
async function obtenerTipo(usuario, tipoId) {
  const { TipoDocumento } = modelos();
  const tipo = esUuid(tipoId) ? await TipoDocumento.findByPk(tipoId) : null;
  if (!tipo) throw errores.tipoNoEncontrado();
  return formatearTipo(tipo, idiomaDe(usuario));
}

/** ¿El tipo está entre los requisitos activos de la solicitud (evaluación + paquete u Honduras)? */
async function esRequerido(solicitud, tipoDocumentoId, transaction) {
  const { RequisitoRuta } = modelos();
  return Boolean(
    await RequisitoRuta.findOne({
      where: { ruta: rutasActivas(solicitud), tipoDocumentoId, activo: true },
      attributes: ['id'],
      transaction,
    }),
  );
}

async function respuestaCreacion(documento, usuario, transaction) {
  const { Paciente, Solicitud } = modelos();
  const solicitud = await Solicitud.findByPk(documento.solicitudId, { transaction });
  const paciente = await Paciente.findByPk(solicitud.pacienteId, { transaction });
  return {
    ...(await documentoCompleto(documento, { idioma: idiomaDe(usuario), transaction })),
    paciente: {
      nombreCompleto: nombreCompleto(paciente),
      fotoArchivoId: paciente.fotoArchivoId ?? null,
    },
  };
}

/**
 * POST /solicitudes/:id/documentos. Devuelve `{ creado, documento }`.
 *
 * - Con `id` del teléfono ya existente (del mismo usuario y caso) → el mismo documento.
 * - Vigente en FALTA → ese mismo. CAPTURADO o RECHAZADO → versión nueva. VALIDADO → versión
 *   nueva solo para el coordinador.
 *
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 * @param {{ id?: string, tipoDocumentoId: string, origen?: 'app' | 'jornada' }} cuerpo
 */
async function crearDocumento(usuario, solicitudId, { id, tipoDocumentoId, origen = 'app' }) {
  const { sequelize, Documento, TipoDocumento } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, { transaction });

    if (id) {
      const existente = await Documento.findByPk(id, {
        include: [{ association: 'tipoDocumento' }],
        transaction,
      });
      if (existente) {
        if (existente.solicitudId !== solicitud.id || existente.capturadoPor !== usuario.id) {
          throw errores.idEnUso();
        }
        return {
          creado: false,
          documento: await respuestaCreacion(existente, usuario, transaction),
        };
      }
    }

    if (origen === 'jornada' && ![ROLES.VOLUNTARIO, ROLES.COORDINADOR].includes(usuario.rol)) {
      throw errores.origenNoPermitido();
    }
    const tipo = await TipoDocumento.findByPk(tipoDocumentoId, { transaction });
    if (!tipo) throw errores.tipoNoExiste();
    if (!(await esRequerido(solicitud, tipo.id, transaction))) throw errores.noRequerido();
    await exigirEdicion(usuario, solicitud, { tipoDocumentoId: tipo.id, transaction });

    // Una sola creación a la vez por caso y tipo (el índice parcial admite un vigente).
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:clave, 0))', {
      replacements: { clave: `documentos:${solicitud.id}:${tipo.id}` },
      transaction,
    });
    const vigente = await Documento.findOne({
      where: { solicitudId: solicitud.id, tipoDocumentoId: tipo.id, vigente: true },
      include: [{ association: 'tipoDocumento' }],
      transaction,
    });
    if (vigente?.estado === D.FALTA) {
      return { creado: false, documento: await respuestaCreacion(vigente, usuario, transaction) };
    }
    if (vigente?.estado === D.VALIDADO && usuario.rol !== ROLES.COORDINADOR) {
      throw errores.validadoSoloCoordinador();
    }
    if (vigente) {
      await llamarOcr('cancelarExtraccion', { documentoId: vigente.id, transaction });
      await vigente.update({ vigente: false }, { transaction });
    }

    const documento = await Documento.create(
      {
        ...(id ? { id } : {}),
        solicitudId: solicitud.id,
        tipoDocumentoId: tipo.id,
        version: vigente ? vigente.version + 1 : 1,
        reemplazaA: vigente?.id ?? null,
        vigente: true,
        estado: D.FALTA,
        origen,
        capturadoPor: usuario.id,
      },
      { transaction },
    );
    documento.tipoDocumento = tipo;
    await registrarBitacora({
      accion: vigente ? 'documentos.nueva_version' : 'documentos.crear',
      entidad: 'documentos',
      entidadId: documento.id,
      solicitudId: solicitud.id,
      antes: vigente
        ? { documentoId: vigente.id, version: vigente.version, estado: vigente.estado }
        : null,
      despues: { documentoId: documento.id, tipo: tipo.codigo, version: documento.version, origen },
      transaction,
    });
    return { creado: true, documento: await respuestaCreacion(documento, usuario, transaction) };
  });
}

/**
 * GET /documentos/:id: también las versiones anteriores, para quien tenga relación con el caso.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} documentoId
 */
async function obtenerDocumento(usuario, documentoId) {
  const { Documento } = modelos();
  const { documento } = await documentoConAcceso(usuario, documentoId);
  const anterior = documento.reemplazaA ? await Documento.findByPk(documento.reemplazaA) : null;
  return {
    ...(await documentoCompleto(documento, { idioma: idiomaDe(usuario) })),
    versionAnterior: anterior
      ? {
          id: anterior.id,
          version: anterior.version,
          estado: anterior.estado,
          motivoRechazo: anterior.motivoRechazo ?? null,
        }
      : null,
  };
}

/** Documento vigente y editable por el usuario (ventanas de core/acceso). */
async function documentoEditable(usuario, documentoId, transaction) {
  const { documento, solicitud } = await documentoConAcceso(usuario, documentoId, {
    transaction,
    bloquear: true,
  });
  if (!documento.vigente) throw errores.noVigente();
  await exigirEdicion(usuario, solicitud, {
    tipoDocumentoId: documento.tipoDocumentoId,
    transaction,
  });
  return { documento, solicitud };
}

/**
 * POST /documentos/:id/finalizar (anexo B, paso 2): FALTA → CAPTURADO, encola el OCR, cierra las
 * correcciones abiertas de ese tipo y emite `documento.capturado`.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} documentoId
 * @param {{ paginasDeclaradas: number }} cuerpo
 */
async function finalizar(usuario, documentoId, { paginasDeclaradas }) {
  const { sequelize, DocumentoPagina } = modelos();
  return sequelize.transaction(async (transaction) => {
    const { documento } = await documentoEditable(usuario, documentoId, transaction);
    if (documento.estado !== D.FALTA) throw errores.estadoInvalido(documento.estado, D.FALTA);
    const subidas = await DocumentoPagina.count({
      where: { documentoId: documento.id },
      transaction,
    });
    if (subidas === 0) throw errores.sinPaginas();
    if (paginasDeclaradas > subidas) throw errores.paginasFaltantes(paginasDeclaradas, subidas);
    if (paginasDeclaradas < subidas) throw errores.paginasSobrantes(paginasDeclaradas, subidas);

    // `capturado_por` sigue siendo quien creó el documento (la familia o el voluntario en jornada).
    await documento.update(
      { estado: D.CAPTURADO, paginasDeclaradas, capturadoEn: new Date() },
      { transaction },
    );
    await llamarOcr('encolarExtraccion', { documentoId: documento.id, transaction });
    const cerradas = await cerrarPorDocumento(documento, transaction);
    await registrarBitacora({
      accion: 'documentos.finalizar',
      entidad: 'documentos',
      entidadId: documento.id,
      solicitudId: documento.solicitudId,
      antes: { estado: D.FALTA },
      despues: { estado: D.CAPTURADO, paginasDeclaradas, correccionesResueltas: cerradas },
      transaction,
    });
    emitirTrasCommit(transaction, EVENTOS.DOCUMENTO_CAPTURADO, {
      documentoId: documento.id,
      solicitudId: documento.solicitudId,
      tipoDocumentoId: documento.tipoDocumentoId,
      version: documento.version,
      origen: documento.origen,
      capturadoPor: usuario.id,
    });
    return documentoCompleto(documento, { idioma: idiomaDe(usuario), transaction });
  });
}

/**
 * POST /documentos/:id/cancelar: cancela el OCR en curso y devuelve el documento a FALTA para
 * repetir páginas. Si el OCR ya terminó, hace falta una versión nueva.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} documentoId
 */
async function cancelar(usuario, documentoId) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const { documento } = await documentoEditable(usuario, documentoId, transaction);
    if (documento.estado !== D.CAPTURADO)
      throw errores.estadoInvalido(documento.estado, D.CAPTURADO);
    const extraccion = (await ultimasExtracciones(documento.id, transaction)).get(documento.id);
    if (extraccion && !OCR_EN_CURSO.has(extraccion.estado) && extraccion.estado !== 'cancelada') {
      throw errores.ocrEnRevision();
    }
    await llamarOcr('cancelarExtraccion', { documentoId: documento.id, transaction });
    await documento.update(
      { estado: D.FALTA, paginasDeclaradas: null, capturadoEn: null },
      { transaction },
    );
    const reabiertas = await reabrirPorDocumento(documento, transaction);
    await registrarBitacora({
      accion: 'documentos.cancelar',
      entidad: 'documentos',
      entidadId: documento.id,
      solicitudId: documento.solicitudId,
      antes: { estado: D.CAPTURADO },
      despues: { estado: D.FALTA, correccionesReabiertas: reabiertas },
      transaction,
    });
    emitirCambio(transaction, documento, D.CAPTURADO);
    return documentoCompleto(documento, { idioma: idiomaDe(usuario), transaction });
  });
}

/**
 * POST /documentos/:id/validar (anexo B, paso 6): CAPTURADO → VALIDADO. Si hubo OCR, la extracción
 * debe estar confirmada.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} documentoId
 */
async function validar(usuario, documentoId) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const { documento } = await documentoEditable(usuario, documentoId, transaction);
    if (documento.estado !== D.CAPTURADO)
      throw errores.estadoInvalido(documento.estado, D.CAPTURADO);
    const extraccion = (await ultimasExtracciones(documento.id, transaction)).get(documento.id);
    if (extraccion && OCR_PENDIENTE.has(extraccion.estado)) throw errores.ocrSinRevisar();

    await documento.update(
      { estado: D.VALIDADO, validadoPor: usuario.id, validadoEn: new Date() },
      { transaction },
    );
    await registrarBitacora({
      accion: 'documentos.validar',
      entidad: 'documentos',
      entidadId: documento.id,
      solicitudId: documento.solicitudId,
      antes: { estado: D.CAPTURADO },
      despues: { estado: D.VALIDADO },
      transaction,
    });
    emitirCambio(transaction, documento, D.CAPTURADO);
    return documentoCompleto(documento, { idioma: idiomaDe(usuario), transaction });
  });
}

module.exports = {
  OCR_PENDIENTE,
  listarRequisitos,
  obtenerTipo,
  crearDocumento,
  obtenerDocumento,
  documentoEditable,
  finalizar,
  cancelar,
  validar,
};
