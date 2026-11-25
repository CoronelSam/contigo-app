'use strict';

// Envío del expediente a Shriners (49) y respuesta de Shriners (50). Son registros internos: no
// hay integración con Shriners. El envío no es una aceptación clínica.

const { obtenerSolicitudConAcceso } = require('../../core/acceso');
const { cambiarEstado } = require('../../core/estados');
const { ESTADOS_SOLICITUD: E } = require('../../core/estados/constantes');
const { registrarBitacora } = require('../../core/auditoria');
const { validacion } = require('../../core/errores');
const errores = require('./paquetes.errores');
const { hoyIso, iso, usuariosBreves, solicitudBreve } = require('./paquetes.util');

const modelos = () => require('../../models');

/** Estado al que lleva cada resultado de Shriners. */
const ESTADO_DE_RESULTADO = Object.freeze({
  informacion_adicional: E.INFO_ADICIONAL,
  aceptada: E.ACEPTADA,
  denegada: E.DENEGADA,
});

function formatearEnvio(envio, usuario) {
  return {
    id: envio.id,
    solicitudId: envio.solicitudId,
    paqueteId: envio.paquetePdfId,
    destino: envio.destino,
    fecha: envio.fecha,
    metodo: envio.metodo,
    guia: envio.guia ?? null,
    observaciones: envio.observaciones ?? null,
    registradoPor: usuario(envio.registradoPor),
    creadoEn: iso(envio.createdAt),
  };
}

function formatearRespuesta(r, usuario) {
  return {
    id: r.id,
    solicitudId: r.solicitudId,
    envioId: r.envioId ?? null,
    fecha: r.fecha,
    resultado: r.resultado,
    observaciones: r.observaciones ?? null,
    registradoPor: usuario(r.registradoPor),
    creadoEn: iso(r.createdAt),
  };
}

/**
 * ¿El paquete sirve para el envío? Final, listo, revisado, del paquete actual de la solicitud y
 * generado durante el estado COMPLETA vigente (uno de una etapa anterior puede estar desactualizado).
 */
function paqueteEnviable(paquete, solicitud) {
  return (
    paquete &&
    paquete.tipo === 'final' &&
    paquete.estado === 'listo' &&
    Boolean(paquete.revisadoEn) &&
    paquete.paquete === solicitud.paquete &&
    paquete.createdAt >= solicitud.ultimoCambioEstado
  );
}

/**
 * Registra el envío del paquete final a Shriners: COMPLETA → ENVIADA.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {{ paqueteId: string, destino: string, fecha: string, metodo: string, guia?: string | null,
 *   observaciones?: string | null }} cuerpo
 */
async function registrarEnvio(usuario, solicitudId, cuerpo) {
  if (cuerpo.fecha > hoyIso()) throw validacion({ fecha: 'FECHA_FUTURA' });
  const { sequelize, PaquetePdf, Envio } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (solicitud.estado !== E.COMPLETA) throw errores.envioEstado(solicitud.estado);
    const paquete = await PaquetePdf.findOne({
      where: { id: cuerpo.paqueteId, solicitudId },
      transaction,
    });
    if (!paqueteEnviable(paquete, solicitud)) throw errores.envioSinPaqueteFinal();
    if (cuerpo.destino !== paquete.paquete) throw errores.envioDestinoDistinto();

    const envio = await Envio.create(
      {
        solicitudId,
        paquetePdfId: paquete.id,
        destino: cuerpo.destino,
        fecha: cuerpo.fecha,
        metodo: cuerpo.metodo,
        guia: cuerpo.guia ?? null,
        observaciones: cuerpo.observaciones ?? null,
        registradoPor: usuario.id,
      },
      { transaction },
    );
    await registrarBitacora({
      accion: 'envio.registrar',
      entidad: 'envios',
      entidadId: envio.id,
      solicitudId,
      despues: {
        paqueteId: paquete.id,
        destino: envio.destino,
        fecha: envio.fecha,
        metodo: envio.metodo,
      },
      transaction,
    });
    await cambiarEstado({ solicitud, a: E.ENVIADA, usuario, transaction });
    const usuarioDe = await usuariosBreves([usuario.id], transaction);
    return { solicitud: solicitudBreve(solicitud), envio: formatearEnvio(envio, usuarioDe) };
  });
}

/**
 * Registra la respuesta de Shriners al último envío: ENVIADA → INFO_ADICIONAL, ACEPTADA o
 * DENEGADA. La familia recibe un aviso neutral (RESPUESTA_REGISTRADA).
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {{ fecha: string, resultado: 'informacion_adicional' | 'aceptada' | 'denegada',
 *   observaciones?: string | null }} cuerpo
 */
async function registrarRespuesta(usuario, solicitudId, cuerpo) {
  if (cuerpo.fecha > hoyIso()) throw validacion({ fecha: 'FECHA_FUTURA' });
  const { sequelize, Envio, RespuestaShriners } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (solicitud.estado !== E.ENVIADA) throw errores.respuestaEstado(solicitud.estado);
    const envio = await Envio.findOne({
      where: { solicitudId },
      order: [['createdAt', 'DESC']],
      transaction,
    });
    if (envio && cuerpo.fecha < envio.fecha) {
      throw validacion(
        { fecha: 'ANTERIOR_AL_ENVIO' },
        'La respuesta no puede ser anterior al envío',
      );
    }

    const respuesta = await RespuestaShriners.create(
      {
        solicitudId,
        envioId: envio?.id ?? null,
        fecha: cuerpo.fecha,
        resultado: cuerpo.resultado,
        observaciones: cuerpo.observaciones ?? null,
        registradoPor: usuario.id,
      },
      { transaction },
    );
    await registrarBitacora({
      accion: 'respuesta.registrar',
      entidad: 'respuestas_shriners',
      entidadId: respuesta.id,
      solicitudId,
      despues: {
        envioId: respuesta.envioId,
        fecha: respuesta.fecha,
        resultado: respuesta.resultado,
      },
      transaction,
    });
    await cambiarEstado({
      solicitud,
      a: ESTADO_DE_RESULTADO[cuerpo.resultado],
      usuario,
      notificacion: { tipo: 'RESPUESTA_REGISTRADA' },
      transaction,
    });
    const usuarioDe = await usuariosBreves([usuario.id], transaction);
    return {
      solicitud: solicitudBreve(solicitud),
      respuesta: formatearRespuesta(respuesta, usuarioDe),
      acciones: cuerpo.resultado === 'denegada' ? ['reabrir_evaluacion'] : [],
    };
  });
}

module.exports = { registrarEnvio, registrarRespuesta, ESTADO_DE_RESULTADO };
