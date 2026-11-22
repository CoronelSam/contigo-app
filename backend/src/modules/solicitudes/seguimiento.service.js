'use strict';

// Seguimiento del caso (30): línea de tiempo desde historial_estados. Cambia según la ruta
// decidida. Los pasos pendientes no llevan fecha y nunca se devuelven fechas estimadas.

const { Op } = require('sequelize');
const { obtenerSolicitudConAcceso } = require('../../core/acceso');
const { sinPermiso } = require('../../core/errores');
const {
  ESTADOS_SOLICITUD: E,
  ESTADOS_FINALES,
  ETAPAS,
  ROLES,
  RUTAS,
} = require('../../core/estados/constantes');
const { iso } = require('./solicitudes.util');

const PASOS_COMUNES = Object.freeze([
  'SOLICITUD_CREADA',
  'CAPTURA',
  'EN_REVISION',
  'EVALUACION_RUTA',
]);
const PASOS_HONDURAS = Object.freeze(['DERIVADA_HN', 'ATENDIDA_HN']);
const PASOS_EXTERIOR = Object.freeze(['PAQUETE_EXTERIOR', 'COMPLETA', 'ENVIADA', 'RESPUESTA']);
const SIN_RUTA = 'SIGUIENTE_PASO_SEGUN_RUTA';

const modelos = () => require('../../models');

/** Paso al que corresponde estar en `estado` (la revisión del paquete es parte del paquete). */
function pasoDeEstado(estado, etapa) {
  switch (estado) {
    case E.BORRADOR:
      return 'SOLICITUD_CREADA';
    case E.EN_REVISION:
      return etapa === ETAPAS.PAQUETE ? 'PAQUETE_EXTERIOR' : 'EN_REVISION';
    case E.EN_EVALUACION:
      return 'EVALUACION_RUTA';
    case E.ACEPTADA:
    case E.DENEGADA:
      return 'RESPUESTA';
    default:
      return estado;
  }
}

/** Paso en que ocurrió un pedido de información adicional. */
function pasoDeInfoAdicional(h) {
  if (h.estadoAnterior === E.ENVIADA) return 'ENVIADA';
  return h.etapa === ETAPAS.PAQUETE ? 'PAQUETE_EXTERIOR' : 'EN_REVISION';
}

function rutaDe(solicitud) {
  if (solicitud.rutaDecidida === RUTAS.HONDURAS) return 'HONDURAS';
  if ([RUTAS.MEXICO, RUTAS.INTERNACIONAL].includes(solicitud.rutaDecidida)) return 'EXTERIOR';
  return null;
}

/**
 * GET /solicitudes/:id/seguimiento (familia y coordinador).
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 */
async function obtenerSeguimiento(usuario, solicitudId) {
  if (![ROLES.FAMILIA, ROLES.COORDINADOR].includes(usuario.rol)) throw sinPermiso();
  const { HistorialEstado, DerivacionLocal } = modelos();
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const historial = await HistorialEstado.findAll({
    where: { solicitudId: solicitud.id },
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const ruta = rutaDe(solicitud);
  const codigos = [
    ...PASOS_COMUNES,
    ...(ruta === 'HONDURAS' ? PASOS_HONDURAS : ruta === 'EXTERIOR' ? PASOS_EXTERIOR : [SIN_RUTA]),
  ];

  // Última vez que el caso entró a cada paso, y pedidos de información adicional por paso.
  const entrada = new Map([['SOLICITUD_CREADA', solicitud.createdAt]]);
  const eventos = new Map();
  for (const h of historial) {
    if (h.estadoNuevo === E.INFO_ADICIONAL) {
      const paso = pasoDeInfoAdicional(h);
      if (!eventos.has(paso)) eventos.set(paso, []);
      eventos.get(paso).push({ codigo: 'INFO_ADICIONAL', fecha: iso(h.createdAt) });
    } else {
      entrada.set(pasoDeEstado(h.estadoNuevo, h.etapa), h.createdAt);
    }
  }

  let actual = solicitud.estado;
  if (actual === E.INFO_ADICIONAL) {
    const ultimo = historial.findLast((h) => h.estadoNuevo === E.INFO_ADICIONAL);
    actual = ultimo ? pasoDeInfoAdicional(ultimo) : 'EN_REVISION';
  } else {
    actual = pasoDeEstado(solicitud.estado, solicitud.etapa);
  }
  const indiceActual = codigos.indexOf(actual);
  const terminado = ESTADOS_FINALES.includes(solicitud.estado);

  let cita;
  if (ruta === 'HONDURAS' && indiceActual >= codigos.indexOf('DERIVADA_HN')) {
    const derivacion = await DerivacionLocal.findOne({
      where: { solicitudId: solicitud.id, estado: { [Op.ne]: 'cancelada' } },
      order: [['createdAt', 'DESC']],
    });
    if (derivacion) cita = { fecha: derivacion.fechaCita, hora: derivacion.horaCita ?? null };
  }

  const pasos = codigos.map((codigo, i) => {
    let estado = 'pendiente';
    if (i < indiceActual || (i === indiceActual && terminado)) estado = 'completado';
    else if (i === indiceActual) estado = 'actual';
    const paso = {
      codigo,
      estado,
      fecha: estado === 'pendiente' ? null : iso(entrada.get(codigo)),
      eventos: eventos.get(codigo) ?? [],
    };
    if (codigo === 'DERIVADA_HN' && cita) paso.cita = cita;
    if (codigo === 'RESPUESTA' && estado !== 'pendiente') {
      paso.resultado = solicitud.estado === E.DENEGADA ? 'DENEGADA' : 'ACEPTADA';
    }
    return paso;
  });

  return {
    solicitudId: solicitud.id,
    codigo: solicitud.codigo,
    estado: solicitud.estado,
    ruta,
    pasos,
  };
}

module.exports = { obtenerSeguimiento };
