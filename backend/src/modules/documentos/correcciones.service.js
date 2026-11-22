'use strict';

// Solicitudes de corrección: nueva captura del voluntario (41), rechazo del coordinador (44) y
// corrección de una sección (45). Rechazar una imagen no es rechazar la solicitud: desde aquí el
// caso solo puede pasar de EN_REVISION a INFO_ADICIONAL, nunca a DENEGADA.

const {
  obtenerSolicitudConAcceso,
  exigirEdicion,
  usuariosFamiliaDe,
} = require('../../core/acceso');
const { registrarBitacora } = require('../../core/auditoria');
const { cambiarEstado } = require('../../core/estados');
const { notificar } = require('../../core/notificaciones');
const { sinPermiso } = require('../../core/errores');
const { logger } = require('../../core/logger');
const {
  ESTADOS_SOLICITUD: E,
  ESTADOS_DOCUMENTO: D,
  ROLES,
} = require('../../core/estados/constantes');
const errores = require('./documentos.errores');
const {
  iso,
  idiomaDe,
  enIdioma,
  llamarOcr,
  documentoConAcceso,
  documentoCompleto,
  emitirCambio,
} = require('./documentos.util');

/** Estados en los que se pide una corrección: la familia puede responderla en ellos. */
const ESTADOS_CON_CORRECCION = Object.freeze([
  E.CAPTURA,
  E.EN_REVISION,
  E.INFO_ADICIONAL,
  E.PAQUETE_EXTERIOR,
]);

const modelos = () => require('../../models');

/**
 * @param {object} c Instancia de SolicitudCorreccion (con `documento.tipoDocumento` si aplica).
 * @param {'es' | 'en'} idioma
 */
function formatearCorreccion(c, idioma = 'es') {
  const tipo = c.documento?.tipoDocumento;
  return {
    id: c.id,
    tipo: c.documentoId ? 'documento' : 'seccion',
    documentoId: c.documentoId ?? null,
    tipoDocumento: tipo
      ? { id: tipo.id, codigo: tipo.codigo, nombre: enIdioma(tipo, 'nombre', idioma) }
      : null,
    seccion: c.seccion ?? null,
    motivo: c.motivo,
    observaciones: c.observaciones ?? null,
    estado: c.estado,
    creadaEn: iso(c.createdAt),
    resueltaEn: iso(c.resueltaEn),
    resueltaConDocumentoId: c.resueltaConDocumentoId ?? null,
  };
}

/** Correcciones abiertas de documentos del mismo tipo que `documento`, en su solicitud. */
async function abiertasDelTipo(documento, transaction) {
  const { SolicitudCorreccion } = modelos();
  const abiertas = await SolicitudCorreccion.findAll({
    where: { solicitudId: documento.solicitudId, estado: 'abierta' },
    include: [{ association: 'documento', attributes: ['tipoDocumentoId'], required: true }],
    transaction,
  });
  return abiertas.filter((c) => c.documento.tipoDocumentoId === documento.tipoDocumentoId);
}

/**
 * Al finalizar un documento: resuelve las correcciones abiertas de ese tipo con este documento.
 * @returns {Promise<string[]>} Ids de las correcciones resueltas.
 */
async function cerrarPorDocumento(documento, transaction) {
  const abiertas = await abiertasDelTipo(documento, transaction);
  for (const c of abiertas) {
    await c.update(
      { estado: 'resuelta', resueltaConDocumentoId: documento.id, resueltaEn: new Date() },
      { transaction },
    );
  }
  return abiertas.map((c) => c.id);
}

/**
 * Al cancelar un documento capturado (vuelve a FALTA): las correcciones que había resuelto
 * vuelven a quedar abiertas.
 * @returns {Promise<string[]>} Ids de las correcciones reabiertas.
 */
async function reabrirPorDocumento(documento, transaction) {
  const { SolicitudCorreccion } = modelos();
  const resueltas = await SolicitudCorreccion.findAll({
    where: { resueltaConDocumentoId: documento.id, estado: 'resuelta' },
    transaction,
  });
  for (const c of resueltas) {
    await c.update(
      { estado: 'abierta', resueltaConDocumentoId: null, resueltaEn: null },
      { transaction },
    );
  }
  return resueltas.map((c) => c.id);
}

/**
 * Efecto de una corrección nueva en el caso: en EN_REVISION pasa a INFO_ADICIONAL (cambiarEstado
 * avisa a la familia); en los demás estados solo se avisa a la familia.
 */
async function aplicarAlCaso({ solicitud, usuario, nota, transaction }) {
  if (solicitud.estado === E.EN_REVISION) {
    await cambiarEstado({ solicitud, a: E.INFO_ADICIONAL, usuario, nota, transaction });
    return;
  }
  const { Paciente } = modelos();
  const paciente = await Paciente.findByPk(solicitud.pacienteId, {
    attributes: ['nombres'],
    transaction,
  });
  await notificar({
    usuarioIds: await usuariosFamiliaDe(solicitud.id, { transaction }),
    tipo: 'CORRECCION_SOLICITADA',
    variables: {
      nombre: paciente?.nombres?.split(' ')[0] ?? null,
      codigo: solicitud.codigo,
      solicitudId: solicitud.id,
      estado: solicitud.estado,
    },
    solicitudId: solicitud.id,
    transaction,
  });
}

function exigirEstadoConCorreccion(solicitud) {
  if (!ESTADOS_CON_CORRECCION.includes(solicitud.estado)) {
    throw errores.correccionNoPermitida(solicitud.estado);
  }
}

/**
 * Rechazo del coordinador (44) o nueva captura del voluntario o del coordinador (41): el documento
 * pasa a RECHAZADO con una corrección abierta.
 *
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} documentoId
 * @param {{ motivo: string, observaciones?: string }} cuerpo
 * @param {{ rechazo?: boolean }} [opciones] `rechazo`: el coordinador también puede rechazar un
 *   documento VALIDADO.
 */
async function pedirNuevaCaptura(
  usuario,
  documentoId,
  { motivo, observaciones },
  { rechazo = false } = {},
) {
  const { sequelize, SolicitudCorreccion } = modelos();
  return sequelize.transaction(async (transaction) => {
    const { documento, solicitud } = await documentoConAcceso(usuario, documentoId, {
      transaction,
      bloquear: true,
    });
    await solicitud.reload({ transaction, lock: transaction.LOCK.UPDATE });
    if (!documento.vigente) throw errores.noVigente();
    await exigirEdicion(usuario, solicitud, {
      tipoDocumentoId: documento.tipoDocumentoId,
      transaction,
    });
    exigirEstadoConCorreccion(solicitud);
    const aceptados = rechazo ? [D.CAPTURADO, D.VALIDADO] : [D.CAPTURADO];
    if (!aceptados.includes(documento.estado)) {
      throw errores.estadoInvalido(documento.estado, aceptados.join(' o '));
    }

    const de = documento.estado;
    await llamarOcr('cancelarExtraccion', { documentoId: documento.id, transaction });
    await documento.update(
      { estado: D.RECHAZADO, motivoRechazo: motivo, validadoPor: null, validadoEn: null },
      { transaction },
    );
    const correccion = await SolicitudCorreccion.create(
      {
        solicitudId: solicitud.id,
        documentoId: documento.id,
        motivo,
        observaciones: observaciones ?? null,
        solicitadoPor: usuario.id,
        estado: 'abierta',
      },
      { transaction },
    );
    correccion.documento = documento;
    await registrarBitacora({
      accion: rechazo ? 'documentos.rechazar' : 'documentos.pedir_nueva_captura',
      entidad: 'documentos',
      entidadId: documento.id,
      solicitudId: solicitud.id,
      antes: { estado: de },
      despues: { estado: D.RECHAZADO, motivo, correccionId: correccion.id },
      transaction,
    });
    await aplicarAlCaso({ solicitud, usuario, nota: `Corrección: ${motivo}`, transaction });
    emitirCambio(transaction, documento, de);

    const idioma = idiomaDe(usuario);
    return {
      correccion: formatearCorreccion(correccion, idioma),
      documento: await documentoCompleto(documento, { idioma, transaction }),
      solicitud: { id: solicitud.id, estado: solicitud.estado },
    };
  });
}

/**
 * POST /solicitudes/:id/correcciones (45): el coordinador pide corregir una sección del formulario.
 * Abre la edición de esa sección para la familia.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 * @param {{ seccion: string, motivo: string, observaciones?: string }} cuerpo
 */
async function corregirSeccion(usuario, solicitudId, { seccion, motivo, observaciones }) {
  if (usuario.rol !== ROLES.COORDINADOR) throw sinPermiso();
  const { sequelize, SolicitudCorreccion } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    exigirEstadoConCorreccion(solicitud);
    const abierta = await SolicitudCorreccion.findOne({
      where: { solicitudId: solicitud.id, seccion, estado: 'abierta' },
      transaction,
    });
    if (abierta) throw errores.correccionYaAbierta();

    const correccion = await SolicitudCorreccion.create(
      {
        solicitudId: solicitud.id,
        seccion,
        motivo,
        observaciones: observaciones ?? null,
        solicitadoPor: usuario.id,
        estado: 'abierta',
      },
      { transaction },
    );
    await registrarBitacora({
      accion: 'correcciones.seccion',
      entidad: 'solicitudes_correccion',
      entidadId: correccion.id,
      solicitudId: solicitud.id,
      despues: { seccion, motivo },
      transaction,
    });
    await aplicarAlCaso({ solicitud, usuario, nota: `Corrección de ${seccion}`, transaction });
    return {
      correccion: formatearCorreccion(correccion, idiomaDe(usuario)),
      documento: null,
      solicitud: { id: solicitud.id, estado: solicitud.estado },
    };
  });
}

/**
 * GET /solicitudes/:id/correcciones: de la más reciente a la más antigua.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 * @param {{ estado?: string }} filtro
 */
async function listar(usuario, solicitudId, { estado } = {}) {
  const { SolicitudCorreccion } = modelos();
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const correcciones = await SolicitudCorreccion.findAll({
    where: { solicitudId: solicitud.id, ...(estado ? { estado } : {}) },
    include: [{ association: 'documento', include: [{ association: 'tipoDocumento' }] }],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
  });
  const idioma = idiomaDe(usuario);
  return correcciones.map((c) => formatearCorreccion(c, idioma));
}

/**
 * Handler de `seccion.guardada`: si la familia guardó la sección, se resuelven sus correcciones
 * abiertas. Las secciones que guarda el personal no cierran correcciones.
 * @param {{ solicitudId: string, seccion: string, usuarioId?: string | null }} datos
 */
async function alGuardarSeccion(datos) {
  try {
    if (!datos?.usuarioId) return;
    const { sequelize, Usuario, SolicitudCorreccion } = modelos();
    // Casi siempre no hay ninguna abierta: entonces no se abre transacción ni se bloquea nada.
    const hayAbiertas = await SolicitudCorreccion.count({
      where: { solicitudId: datos.solicitudId, seccion: datos.seccion, estado: 'abierta' },
    });
    if (!hayAbiertas) return;
    const autor = await Usuario.findByPk(datos.usuarioId, {
      include: [{ association: 'rol', attributes: ['codigo'] }],
    });
    if (autor?.rol?.codigo !== ROLES.FAMILIA) return;
    await sequelize.transaction(async (transaction) => {
      const abiertas = await SolicitudCorreccion.findAll({
        where: { solicitudId: datos.solicitudId, seccion: datos.seccion, estado: 'abierta' },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      for (const c of abiertas) {
        await c.update({ estado: 'resuelta', resueltaEn: new Date() }, { transaction });
        await registrarBitacora({
          accion: 'correcciones.resolver',
          entidad: 'solicitudes_correccion',
          entidadId: c.id,
          solicitudId: c.solicitudId,
          antes: { estado: 'abierta' },
          despues: { estado: 'resuelta', seccion: c.seccion, version: datos.version ?? null },
          transaction,
        });
      }
    });
  } catch (err) {
    logger.error({ err, solicitudId: datos?.solicitudId }, 'No se pudo cerrar la corrección');
  }
}

module.exports = {
  ESTADOS_CON_CORRECCION,
  formatearCorreccion,
  cerrarPorDocumento,
  reabrirPorDocumento,
  pedirNuevaCaptura,
  corregirSeccion,
  listar,
  alGuardarSeccion,
};
