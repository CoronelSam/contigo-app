'use strict';

// Decisión de ruta (46 ampliada): sugerencia con reglas versionadas, registro del dictamen y su
// justificación, reapertura y lo que ve la familia. El sistema sugiere; una persona decide.

const { obtenerSolicitudConAcceso } = require('../../core/acceso');
const { registrarBitacora } = require('../../core/auditoria');
const { cambiarEstado, actualizarCamposRuta } = require('../../core/estados');
const { ESTADOS_SOLICITUD: E, ETAPAS, RUTAS, ROLES } = require('../../core/estados/constantes');
const { sinPermiso, validacion } = require('../../core/errores');
const errores = require('./ruta.errores');
const { sugerirRuta, motivosEn } = require('./motor');
const { hoyIso, iso, idiomaDe, nombrePersona } = require('./ruta.util');

/** Estados desde los que se reabre la evaluación (transición `reabrir_evaluacion`). */
const REABRIBLES = Object.freeze([E.PAQUETE_EXTERIOR, E.DERIVADA_HN, E.DENEGADA]);

const modelos = () => require('../../models');

function formatearEvaluacion(e, idioma) {
  return {
    id: e.id,
    solicitudId: e.solicitudId,
    rutaSugerida: e.rutaSugerida,
    motivos: motivosEn(e.motivos ?? [], idioma),
    versionReglas: e.versionReglas ?? null,
    hechos: e.hechos ?? {},
    rutaDecidida: e.rutaDecidida,
    justificacion: e.justificacion,
    evaluadorNombre: e.evaluadorNombre,
    evaluadorCargo: e.evaluadorCargo,
    tipoDictamen: e.tipoDictamen,
    fechaDictamen: e.fechaDictamen,
    registradoPor: e.registrador
      ? { id: e.registrador.id, nombre: nombrePersona(e.registrador) }
      : null,
    vigente: e.vigente,
    creadaEn: iso(e.createdAt),
  };
}

/**
 * GET /solicitudes/:id/ruta-sugerida: calcula la sugerencia; no guarda nada.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 */
async function rutaSugerida(usuario, solicitudId) {
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const s = await sugerirRuta(solicitud.id);
  return { ...s, motivos: motivosEn(s.motivos, idiomaDe(usuario)) };
}

/**
 * POST /solicitudes/:id/evaluaciones: registra el dictamen. La sugerencia se recalcula aquí y se
 * guarda con la evaluación (nunca se acepta una sugerida por el cliente).
 *
 * - Exterior: PAQUETE_EXTERIOR con el paquete fijado y la etapa de paquete.
 * - Honduras: guarda la ruta sin cambiar de estado (la derivación lo mueve a DERIVADA_HN).
 *
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 * @param {object} cuerpo
 */
async function registrarEvaluacion(usuario, solicitudId, cuerpo) {
  if (cuerpo.fechaDictamen > hoyIso()) throw validacion({ fechaDictamen: 'FECHA_FUTURA' });
  const { sequelize, Evaluacion } = modelos();
  const resultado = await sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (solicitud.estado !== E.EN_EVALUACION) throw errores.noEnEvaluacion(solicitud.estado);

    const sugerencia = await sugerirRuta(solicitud.id, { transaction });
    await Evaluacion.update(
      { vigente: false },
      { where: { solicitudId: solicitud.id, vigente: true }, transaction },
    );
    const evaluacion = await Evaluacion.create(
      {
        solicitudId: solicitud.id,
        rutaSugerida: sugerencia.rutaSugerida,
        motivos: sugerencia.motivos,
        hechos: sugerencia.hechos,
        versionReglas: sugerencia.versionReglas,
        rutaDecidida: cuerpo.rutaDecidida,
        justificacion: cuerpo.justificacion,
        evaluadorNombre: cuerpo.evaluadorNombre,
        evaluadorCargo: cuerpo.evaluadorCargo,
        tipoDictamen: cuerpo.tipoDictamen,
        fechaDictamen: cuerpo.fechaDictamen,
        registradoPor: usuario.id,
        vigente: true,
      },
      { transaction },
    );
    await registrarBitacora({
      accion: 'evaluaciones.registrar',
      entidad: 'evaluaciones',
      entidadId: evaluacion.id,
      solicitudId: solicitud.id,
      despues: {
        rutaSugerida: sugerencia.rutaSugerida,
        rutaDecidida: cuerpo.rutaDecidida,
        versionReglas: sugerencia.versionReglas,
        tipoDictamen: cuerpo.tipoDictamen,
      },
      transaction,
    });

    const campos = { rutaDecidida: cuerpo.rutaDecidida, rutaSugerida: sugerencia.rutaSugerida };
    if (cuerpo.rutaDecidida === RUTAS.HONDURAS) {
      await actualizarCamposRuta({
        solicitud,
        usuario,
        campos,
        notificacion: { tipo: 'RUTA_DECIDIDA' },
        transaction,
      });
    } else {
      // Notifica RUTA_DECIDIDA y DOCUMENTOS_PENDIENTES (transición decidir_ruta_exterior).
      await cambiarEstado({ solicitud, a: E.PAQUETE_EXTERIOR, usuario, campos, transaction });
    }
    return { evaluacion, solicitud };
  });

  const evaluacion = await Evaluacion.findByPk(resultado.evaluacion.id, {
    include: [{ association: 'registrador', attributes: ['id', 'nombres', 'apellidos'] }],
  });
  const { solicitud } = resultado;
  return {
    evaluacion: formatearEvaluacion(evaluacion, idiomaDe(usuario)),
    solicitud: {
      id: solicitud.id,
      estado: solicitud.estado,
      etapa: solicitud.etapa,
      rutaDecidida: solicitud.rutaDecidida ?? null,
      paquete: solicitud.paquete ?? null,
    },
  };
}

/**
 * GET /solicitudes/:id/evaluaciones: historial del caso, de la más reciente a la más antigua.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 */
async function listarEvaluaciones(usuario, solicitudId) {
  const { Evaluacion } = modelos();
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const evaluaciones = await Evaluacion.findAll({
    where: { solicitudId: solicitud.id },
    include: [{ association: 'registrador', attributes: ['id', 'nombres', 'apellidos'] }],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
  });
  const idioma = idiomaDe(usuario);
  return evaluaciones.map((e) => formatearEvaluacion(e, idioma));
}

/**
 * Reabre la evaluación dentro de una transacción ya abierta: EN_EVALUACION, etapa de evaluación,
 * sin ruta ni paquete; la evaluación vigente deja de serlo y una cita programada se cancela.
 */
async function reabrirEn({ solicitud, usuario, motivo, transaction }) {
  const { Evaluacion, DerivacionLocal } = modelos();
  await Evaluacion.update(
    { vigente: false },
    { where: { solicitudId: solicitud.id, vigente: true }, transaction },
  );
  await DerivacionLocal.update(
    { estado: 'cancelada' },
    { where: { solicitudId: solicitud.id, estado: 'programada' }, transaction },
  );
  const de = solicitud.estado;
  await cambiarEstado({ solicitud, a: E.EN_EVALUACION, usuario, nota: motivo, transaction });
  await registrarBitacora({
    accion: 'evaluaciones.reabrir',
    entidad: 'solicitudes',
    entidadId: solicitud.id,
    solicitudId: solicitud.id,
    despues: { desde: de, motivo },
    transaction,
  });
}

/**
 * POST /solicitudes/:id/reabrir-evaluacion. Desde DENEGADA, el objetivo es buscar atención en
 * Honduras.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {{ motivo: string }} cuerpo
 */
async function reabrirEvaluacion(usuario, solicitudId, { motivo }) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!REABRIBLES.includes(solicitud.estado)) {
      throw errores.reaperturaNoPermitida(solicitud.estado);
    }
    await reabrirEn({ solicitud, usuario, motivo, transaction });
    return {
      id: solicitud.id,
      estado: solicitud.estado,
      etapa: solicitud.etapa,
      rutaDecidida: solicitud.rutaDecidida ?? null,
      paquete: solicitud.paquete ?? null,
    };
  });
}

/** Siguiente paso para la familia, como código que la app traduce. Nunca un diagnóstico. */
function siguientePaso(solicitud, cita) {
  switch (solicitud.estado) {
    case E.EN_EVALUACION:
      return solicitud.rutaDecidida === RUTAS.HONDURAS ? 'COORDINANDO_CITA' : 'PENDIENTE_DECISION';
    case E.DERIVADA_HN:
      return cita?.estado === 'programada' ? 'ASISTIR_A_CITA' : 'REPROGRAMANDO_CITA';
    case E.ATENDIDA_HN:
      return 'ATENDIDO';
    case E.PAQUETE_EXTERIOR:
      return 'COMPLETAR_DOCUMENTOS_PAQUETE';
    case E.EN_REVISION:
    case E.INFO_ADICIONAL:
      return solicitud.etapa === ETAPAS.PAQUETE
        ? solicitud.estado === E.INFO_ADICIONAL
          ? 'COMPLETAR_DOCUMENTOS_PAQUETE'
          : 'PAQUETE_EN_REVISION'
        : 'PENDIENTE_DECISION';
    case E.COMPLETA:
      return 'PAQUETE_EN_REVISION';
    case E.ENVIADA:
      return 'ESPERAR_RESPUESTA_SHRINERS';
    case E.ACEPTADA:
      return 'ACEPTADA';
    case E.DENEGADA:
      return 'BUSCANDO_OTRA_ATENCION';
    default:
      return 'PENDIENTE_DECISION';
  }
}

/**
 * GET /solicitudes/:id/ruta (familia vinculada): ruta decidida, siguiente paso y la cita. Nunca
 * la ruta sugerida, los motivos, los hechos, la justificación ni el evaluador.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 */
async function rutaParaFamilia(usuario, solicitudId) {
  if (usuario.rol !== ROLES.FAMILIA) throw sinPermiso();
  const { DerivacionLocal } = modelos();
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const derivacion =
    solicitud.rutaDecidida === RUTAS.HONDURAS
      ? await DerivacionLocal.findOne({
          where: { solicitudId: solicitud.id },
          include: [{ association: 'proveedor' }],
          order: [
            ['createdAt', 'DESC'],
            ['id', 'ASC'],
          ],
        })
      : null;
  const respuesta = {
    rutaDecidida: solicitud.rutaDecidida ?? null,
    siguientePaso: siguientePaso(solicitud, derivacion),
  };
  if (derivacion) {
    const contacto = derivacion.proveedor?.contacto ?? {};
    respuesta.cita = {
      fecha: derivacion.fechaCita,
      hora: derivacion.horaCita ? derivacion.horaCita.slice(0, 5) : null,
      proveedor: {
        nombre: derivacion.proveedor?.nombre ?? '',
        direccion: contacto.direccion ?? null,
        telefono: contacto.telefono ?? null,
      },
      especialidad: derivacion.especialidad,
      estado: derivacion.estado,
    };
  }
  return respuesta;
}

module.exports = {
  REABRIBLES,
  rutaSugerida,
  registrarEvaluacion,
  listarEvaluaciones,
  reabrirEvaluacion,
  reabrirEn,
  rutaParaFamilia,
};
