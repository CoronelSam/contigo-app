'use strict';

// Asignaciones de casos a voluntarios ("Asignar voluntario", que falta en Figma: 36 y 44).
// Cerrar una asignación quita el acceso del voluntario al caso de inmediato: core/acceso filtra
// siempre por asignaciones activas.

const { obtenerSolicitudConAcceso, esUuid } = require('../../core/acceso');
const { registrarBitacora } = require('../../core/auditoria');
const { emitirTrasCommit, EVENTOS } = require('../../core/eventos');
const { notificar } = require('../../core/notificaciones');
const { ESTADOS_FINALES, ROLES } = require('../../core/estados/constantes');
const errores = require('./voluntario.errores');
const { analizarCaso, estadoSegun } = require('./estado');

const modelos = () => require('../../models');

const iso = (f) => (f ? new Date(f).toISOString() : null);

function formatear(asignacion, voluntario) {
  return {
    id: asignacion.id,
    solicitudId: asignacion.solicitudId,
    voluntario: { id: voluntario.id, nombres: voluntario.nombres, apellidos: voluntario.apellidos },
    estado: asignacion.estado,
    activa: asignacion.activa,
    notas: asignacion.notas ?? null,
    creadaEn: iso(asignacion.createdAt),
    actualizadaEn: iso(asignacion.updatedAt),
  };
}

/** El usuario existe, tiene rol voluntario y está activo; si no, 400 con el motivo. */
async function voluntarioValido(voluntarioId, transaction) {
  const { Usuario } = modelos();
  const usuario = await Usuario.findByPk(voluntarioId, {
    include: [{ association: 'rol', attributes: ['codigo'] }],
    transaction,
  });
  if (!usuario) throw errores.noEsVoluntario('NO_EXISTE');
  if (usuario.rol?.codigo !== ROLES.VOLUNTARIO) throw errores.noEsVoluntario('NO_ES_VOLUNTARIO');
  if (usuario.estado !== 'activo') throw errores.noEsVoluntario('INACTIVO');
  return usuario;
}

async function permiteVarios(transaction) {
  const { Configuracion } = modelos();
  const fila = await Configuracion.findByPk('asignaciones.varios_voluntarios', { transaction });
  return fila ? fila.valor !== false : true;
}

/**
 * Crea la asignación dentro de una transacción ya abierta (la usan crear y reasignar).
 * @returns {Promise<{ asignacion: object, voluntario: object }>}
 */
async function asignar({ solicitud, voluntarioId, notas, coordinador, transaction }) {
  const { Asignacion, sequelize } = modelos();
  const voluntario = await voluntarioValido(voluntarioId, transaction);

  // Una asignación a la vez por caso, para que las reglas de duplicado y de varios voluntarios
  // no fallen con 2 peticiones simultáneas.
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:clave, 0))', {
    replacements: { clave: `asignaciones:${solicitud.id}` },
    transaction,
  });
  const activas = await Asignacion.findAll({
    where: { solicitudId: solicitud.id, activa: true },
    transaction,
  });
  if (activas.some((a) => a.voluntarioId === voluntario.id)) throw errores.duplicada();
  if (activas.length && !(await permiteVarios(transaction))) throw errores.casoOcupado();

  const estado = estadoSegun(await analizarCaso(solicitud.id, { transaction }));
  const asignacion = await Asignacion.create(
    {
      solicitudId: solicitud.id,
      voluntarioId: voluntario.id,
      estado,
      activa: true,
      asignadoPor: coordinador.id,
      notas: notas ?? null,
    },
    { transaction },
  );
  await registrarBitacora({
    accion: 'asignaciones.asignar',
    entidad: 'asignaciones',
    entidadId: asignacion.id,
    solicitudId: solicitud.id,
    despues: { voluntarioId: voluntario.id, estado },
    transaction,
  });
  await notificar({
    usuarioIds: [voluntario.id],
    tipo: 'ASIGNACION_NUEVA',
    variables: { codigo: solicitud.codigo, solicitudId: solicitud.id },
    solicitudId: solicitud.id,
    transaction,
  });
  emitirTrasCommit(transaction, EVENTOS.ASIGNACION_CREADA, {
    asignacionId: asignacion.id,
    solicitudId: solicitud.id,
    voluntarioId: voluntario.id,
  });
  return { asignacion, voluntario };
}

/**
 * POST /solicitudes/:id/asignaciones.
 * @param {{ id: string, rol: string }} coordinador
 * @param {string} solicitudId
 * @param {{ voluntarioId: string, notas?: string | null }} cuerpo
 */
async function crearAsignacion(coordinador, solicitudId, { voluntarioId, notas }) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(coordinador, solicitudId, { transaction });
    if (ESTADOS_FINALES.includes(solicitud.estado)) throw errores.casoCerrado(solicitud.estado);
    const { asignacion, voluntario } = await asignar({
      solicitud,
      voluntarioId,
      notas,
      coordinador,
      transaction,
    });
    return formatear(asignacion, voluntario);
  });
}

/**
 * PATCH /asignaciones/:id: cerrar (`activa: false`), reasignar (`activa: false` y `voluntarioId`)
 * o cambiar las notas.
 * @param {{ id: string, rol: string }} coordinador
 * @param {string} asignacionId
 * @param {{ activa?: false, voluntarioId?: string, notas?: string | null }} cambios
 */
async function cambiarAsignacion(coordinador, asignacionId, { activa, voluntarioId, notas }) {
  if (!esUuid(asignacionId)) throw errores.asignacionNoEncontrada();
  const { sequelize, Asignacion, Usuario } = modelos();
  return sequelize.transaction(async (transaction) => {
    const asignacion = await Asignacion.findByPk(asignacionId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!asignacion) throw errores.asignacionNoEncontrada();
    const solicitud = await obtenerSolicitudConAcceso(coordinador, asignacion.solicitudId, {
      transaction,
    });

    const cerrar = activa === false;
    if (cerrar && !asignacion.activa && voluntarioId) throw errores.cerrada();
    if (voluntarioId === asignacion.voluntarioId) throw errores.mismoVoluntario();

    const antes = { activa: asignacion.activa, notas: asignacion.notas };
    await asignacion.update(
      { ...(cerrar ? { activa: false } : {}), ...(notas !== undefined ? { notas } : {}) },
      { transaction },
    );
    const cambio = cerrar && antes.activa;
    if (cambio || notas !== undefined) {
      await registrarBitacora({
        accion: voluntarioId
          ? 'asignaciones.reasignar'
          : cambio
            ? 'asignaciones.cerrar'
            : 'asignaciones.actualizar',
        entidad: 'asignaciones',
        entidadId: asignacion.id,
        solicitudId: solicitud.id,
        antes,
        despues: {
          activa: asignacion.activa,
          notas: asignacion.notas,
          voluntarioId: voluntarioId ?? null,
        },
        transaction,
      });
    }

    let reemplazo = null;
    if (voluntarioId) {
      const nueva = await asignar({ solicitud, voluntarioId, notas, coordinador, transaction });
      reemplazo = formatear(nueva.asignacion, nueva.voluntario);
    }
    const voluntario = await Usuario.findByPk(asignacion.voluntarioId, { transaction });
    return { ...formatear(asignacion, voluntario), reemplazo };
  });
}

module.exports = { crearAsignacion, cambiarAsignacion };
