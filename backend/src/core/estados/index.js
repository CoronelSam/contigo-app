'use strict';

// Máquina de estados de la solicitud. Ningún módulo cambia `estado`, `etapa` ni
// `ultimo_cambio_estado` por su cuenta: todo pasa por cambiarEstado, que en la misma transacción
// valida la transición y el rol, actualiza la solicitud, escribe historial y bitácora, crea las
// notificaciones y, tras el commit, emite `solicitud.estado_cambiado`.
//
// Las precondiciones de negocio (faltantes, paquete generado, etc.) las revisa el módulo que llama
// ANTES de cambiarEstado.

const C = require('./constantes');
const { TRANSICIONES, candidatas } = require('./transiciones');
const { conflicto } = require('../errores');
const { registrarBitacora } = require('../auditoria');
const { emitirTrasCommit, EVENTOS } = require('../eventos');
const { notificar } = require('../notificaciones');
const { usuariosFamiliaDe, coordinadoresDe } = require('../acceso');

const { ESTADOS_SOLICITUD: E } = C;

/** Campos que un módulo puede cambiar junto con el estado. */
const CAMPOS_PERMITIDOS = Object.freeze([
  'etapa',
  'rutaSugerida',
  'rutaDecidida',
  'paquete',
  'faltantesAlEnviar',
  'enviadaEn',
  'coordinadorId',
]);

const CAMPOS_AUDITADOS = ['estado', 'etapa', ...CAMPOS_PERMITIDOS.filter((c) => c !== 'etapa')];

const modelos = () => require('../../models');

function instantanea(solicitud) {
  return Object.fromEntries(CAMPOS_AUDITADOS.map((c) => [c, solicitud.get(c)]));
}

function transicionInvalida(de, a, solicitud, usuario, detalle) {
  const posibles = transicionesPosibles(solicitud, usuario).map((t) => t.a);
  const mensaje =
    detalle ??
    `No se puede pasar de ${de ?? 'nada'} a ${a}` +
      (posibles.length ? `. Permitidas: ${posibles.join(', ')}` : '');
  return conflicto('SOLICITUD_TRANSICION_INVALIDA', mensaje);
}

function validarCampos(campos) {
  const extra = Object.keys(campos).filter((c) => !CAMPOS_PERMITIDOS.includes(c));
  if (extra.length) throw new Error(`cambiarEstado no admite los campos: ${extra.join(', ')}`);
}

/**
 * Transiciones que este usuario puede hacer ahora (para habilitar botones en la app).
 * @param {{ estado: string, etapa: string }} solicitud
 * @param {{ rol: string }} usuario
 * @returns {Array<{ accion: string, a: string }>}
 */
function transicionesPosibles(solicitud, usuario) {
  return TRANSICIONES.filter(
    (t) =>
      t.de.includes(solicitud.estado) &&
      t.roles.includes(usuario?.rol) &&
      (!t.etapa || t.etapa === solicitud.etapa) &&
      (!t.disponible || t.disponible(solicitud)),
  ).map((t) => ({ accion: t.accion, a: t.a }));
}

async function variablesDe(solicitud, transaction) {
  const { Paciente } = modelos();
  const paciente = await Paciente.findByPk(solicitud.pacienteId, {
    attributes: ['nombres'],
    transaction,
  });
  return {
    nombre: paciente?.nombres?.split(' ')[0] ?? null,
    codigo: solicitud.codigo,
    solicitudId: solicitud.id,
    estado: solicitud.estado,
    ruta: solicitud.rutaDecidida,
  };
}

async function enviarNotificaciones({ solicitud, lista, notificacion, transaction }) {
  if (notificacion === false || !lista.length) return;
  const variables = await variablesDe(solicitud, transaction);
  let familia = lista.filter((n) => n.para === 'familia');
  const coordinadores = lista.filter((n) => n.para === 'coordinadores');
  if (notificacion) familia = [{ para: 'familia', ...notificacion }];

  const idsFamilia = familia.length ? await usuariosFamiliaDe(solicitud.id, { transaction }) : [];
  for (const n of familia) {
    await notificar({
      usuarioIds: idsFamilia,
      tipo: n.tipo,
      variables: { ...variables, ...(n.variables ?? {}) },
      solicitudId: solicitud.id,
      transaction,
    });
  }
  if (coordinadores.length) {
    const ids = await coordinadoresDe(solicitud, { transaction });
    for (const n of coordinadores) {
      await notificar({
        usuarioIds: ids,
        tipo: n.tipo,
        variables,
        solicitudId: solicitud.id,
        transaction,
      });
    }
  }
}

/**
 * Cambia el estado de la solicitud dentro de la transacción del módulo que llama.
 *
 * @param {object} p
 * @param {object} p.solicitud Instancia de Solicitud (se actualiza en memoria).
 * @param {string} p.a Estado destino.
 * @param {{ id: string, rol: string }} p.usuario Quien hace el cambio (req.usuario).
 * @param {string} [p.nota] Nota para el historial.
 * @param {object} [p.campos] Campos permitidos que cambian a la vez (ver CAMPOS_PERMITIDOS).
 * @param {false | { tipo: string, variables?: object }} [p.notificacion] `false` para no notificar;
 *   un objeto reemplaza las notificaciones por defecto a la familia.
 * @param {import('sequelize').Transaction} p.transaction Obligatoria.
 * @returns {Promise<object>} La solicitud actualizada.
 */
async function cambiarEstado({
  solicitud,
  a,
  usuario,
  nota,
  campos = {},
  notificacion,
  transaction,
}) {
  if (!transaction) throw new Error('cambiarEstado necesita una transacción');
  validarCampos(campos);

  const de = solicitud.estado;
  const posibles = candidatas(de, a);
  if (!posibles.length) throw transicionInvalida(de, a, solicitud, usuario);
  const conRol = posibles.filter((t) => t.roles.includes(usuario?.rol));
  if (!conRol.length) throw transicionInvalida(de, a, solicitud, usuario);
  const transicion = conRol.find((t) => !t.etapa || t.etapa === solicitud.etapa);
  if (!transicion) {
    throw transicionInvalida(
      de,
      a,
      solicitud,
      usuario,
      `La solicitud está en la etapa ${solicitud.etapa}`,
    );
  }
  const motivo = transicion.validar?.(solicitud, campos);
  if (motivo) throw transicionInvalida(de, a, solicitud, usuario, motivo);

  const antes = instantanea(solicitud);
  const cambios = {
    ...campos,
    ...(transicion.forzar?.(solicitud, campos) ?? {}),
    estado: a,
    ultimoCambioEstado: new Date(),
  };

  const { Solicitud, HistorialEstado } = modelos();
  const [actualizadas] = await Solicitud.update(cambios, {
    where: { id: solicitud.id, estado: de },
    transaction,
  });
  if (actualizadas !== 1) {
    throw conflicto(
      'SOLICITUD_ESTADO_DESACTUALIZADO',
      'La solicitud cambió de estado mientras se procesaba la acción',
    );
  }
  await solicitud.reload({ transaction });

  await HistorialEstado.create(
    {
      solicitudId: solicitud.id,
      estadoAnterior: de,
      estadoNuevo: a,
      etapa: solicitud.etapa,
      usuarioId: usuario.id,
      nota: nota ?? null,
    },
    { transaction },
  );
  await registrarBitacora({
    accion: `solicitud.${transicion.accion}`,
    entidad: 'solicitudes',
    entidadId: solicitud.id,
    solicitudId: solicitud.id,
    antes,
    despues: instantanea(solicitud),
    transaction,
  });
  await enviarNotificaciones({
    solicitud,
    lista: transicion.notificaciones,
    notificacion,
    transaction,
  });
  emitirTrasCommit(transaction, EVENTOS.SOLICITUD_ESTADO_CAMBIADO, {
    solicitudId: solicitud.id,
    de,
    a,
    accion: transicion.accion,
  });
  return solicitud;
}

/**
 * Registra la creación de una solicitud en BORRADOR (historial null → BORRADOR y bitácora).
 * El agente 05 crea la fila y llama a esta función en la misma transacción.
 * @param {{ solicitud: object, usuario: { id: string, rol: string }, transaction: import('sequelize').Transaction }} p
 */
async function registrarCreacion({ solicitud, usuario, transaction }) {
  if (!transaction) throw new Error('registrarCreacion necesita una transacción');
  const [transicion] = candidatas(null, E.BORRADOR);
  if (solicitud.estado !== E.BORRADOR || !transicion.roles.includes(usuario?.rol)) {
    throw transicionInvalida(null, E.BORRADOR, solicitud, usuario);
  }
  const { HistorialEstado } = modelos();
  await HistorialEstado.create(
    {
      solicitudId: solicitud.id,
      estadoAnterior: null,
      estadoNuevo: E.BORRADOR,
      etapa: solicitud.etapa,
      usuarioId: usuario.id,
    },
    { transaction },
  );
  await registrarBitacora({
    accion: 'solicitud.crear',
    entidad: 'solicitudes',
    entidadId: solicitud.id,
    solicitudId: solicitud.id,
    antes: null,
    despues: { codigo: solicitud.codigo, ...instantanea(solicitud) },
    transaction,
  });
  emitirTrasCommit(transaction, EVENTOS.SOLICITUD_ESTADO_CAMBIADO, {
    solicitudId: solicitud.id,
    de: null,
    a: E.BORRADOR,
    accion: 'crear',
  });
  return solicitud;
}

/**
 * Guarda la ruta sugerida o decidida sin cambiar de estado (evaluación con ruta Honduras).
 * Solo el coordinador y solo en EN_EVALUACION.
 * @param {{ solicitud: object, usuario: { id: string, rol: string },
 *   campos: { rutaSugerida?: string | null, rutaDecidida?: string | null }, nota?: string,
 *   notificacion?: { tipo: string, variables?: object }, transaction: import('sequelize').Transaction }} p
 */
async function actualizarCamposRuta({ solicitud, usuario, campos, notificacion, transaction }) {
  if (!transaction) throw new Error('actualizarCamposRuta necesita una transacción');
  const extra = Object.keys(campos).filter((c) => !['rutaSugerida', 'rutaDecidida'].includes(c));
  if (extra.length) throw new Error(`actualizarCamposRuta no admite: ${extra.join(', ')}`);
  if (usuario?.rol !== C.ROLES.COORDINADOR || solicitud.estado !== E.EN_EVALUACION) {
    throw conflicto(
      'SOLICITUD_TRANSICION_INVALIDA',
      'La ruta solo se registra con la solicitud en EN_EVALUACION',
    );
  }
  const antes = instantanea(solicitud);
  const { Solicitud } = modelos();
  const [actualizadas] = await Solicitud.update(campos, {
    where: { id: solicitud.id, estado: E.EN_EVALUACION },
    transaction,
  });
  if (actualizadas !== 1) {
    throw conflicto('SOLICITUD_ESTADO_DESACTUALIZADO', 'La solicitud cambió de estado');
  }
  await solicitud.reload({ transaction });
  await registrarBitacora({
    accion: 'solicitud.registrar_ruta',
    entidad: 'solicitudes',
    entidadId: solicitud.id,
    solicitudId: solicitud.id,
    antes,
    despues: instantanea(solicitud),
    transaction,
  });
  if (notificacion) {
    await enviarNotificaciones({
      solicitud,
      lista: [{ para: 'familia' }],
      notificacion,
      transaction,
    });
  }
  return solicitud;
}

module.exports = {
  ...C,
  TRANSICIONES,
  CAMPOS_PERMITIDOS,
  cambiarEstado,
  registrarCreacion,
  actualizarCamposRuta,
  transicionesPosibles,
};
