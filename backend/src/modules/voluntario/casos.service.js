'use strict';

// Inicio (35) y casos asignados (36) del voluntario. Cada consulta parte de SUS asignaciones
// activas: nunca sale un caso que no le toca, ni siquiera en los contadores. Lo que se devuelve es
// lo mínimo para trabajar: nada de historia clínica.

const { Op } = require('sequelize');
const { ESTADOS, recalcularEstadoAsignacion } = require('./estado');

const modelos = () => require('../../models');

const ZONA_HORARIA = 'America/Tegucigalpa';
/** `HN-0258`, `hn0258` o solo `0258`: búsqueda por código. */
const PATRON_CODIGO = /^(hn-?)?\d{2,}$/i;

/** Edad en años y meses (hora de Honduras). */
function edadDe(fechaNacimiento) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA });
  const [ha, hm, hd] = hoy.split('-').map(Number);
  const [a, m, d] = String(fechaNacimiento).split('-').map(Number);
  let meses = (ha - a) * 12 + (hm - m);
  if (hd < d) meses -= 1;
  meses = Math.max(meses, 0);
  return { anios: Math.floor(meses / 12), meses: meses % 12 };
}

const nombreCompleto = (p) =>
  [p.nombres, p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' ');

/**
 * Recalcula el estado de cada caso activo del voluntario (se corrige solo si se perdió un evento).
 * @returns {Promise<Map<string, { estado: string, hechos: object }>>} solicitudId → análisis
 */
async function recalcularCasosDe(voluntarioId) {
  const { Asignacion } = modelos();
  const activas = await Asignacion.findAll({
    where: { voluntarioId, activa: true },
    attributes: ['solicitudId'],
  });
  const analisis = new Map();
  for (const { solicitudId } of activas) {
    analisis.set(solicitudId, await recalcularEstadoAsignacion(solicitudId));
  }
  return analisis;
}

/**
 * GET /voluntario/resumen.
 * @param {{ id: string }} voluntario
 */
async function resumen(voluntario) {
  const analisis = await recalcularCasosDe(voluntario.id);
  const estados = [...analisis.values()].map((a) => a.estado);
  const contar = (...lista) => estados.filter((e) => lista.includes(e)).length;
  return {
    casosAsignados: estados.length,
    pendientesRevision: contar(ESTADOS.EN_REVISION),
    capturasPendientes: contar(
      ESTADOS.ASIGNADO,
      ESTADOS.PENDIENTE_CAPTURA,
      ESTADOS.CAPTURA_EN_PROCESO,
    ),
    revisados: contar(ESTADOS.REVISADO),
  };
}

/**
 * GET /voluntario/casos: `q` busca por código (`HN-0258`) o por nombre del niño sin acentos.
 * @param {{ id: string }} voluntario
 * @param {{ q?: string, estado?: string, page: number, limit: number }} filtros
 */
async function listarCasos(voluntario, { q, estado, page, limit }) {
  const { Asignacion, sequelize } = modelos();
  const analisis = await recalcularCasosDe(voluntario.id);

  const dondePaciente = [];
  const dondeSolicitud = [];
  if (q) {
    const texto = sequelize.escape(q);
    if (PATRON_CODIGO.test(q.replace(/\s/g, ''))) {
      dondeSolicitud.push(
        sequelize.where(sequelize.fn('replace', sequelize.col('solicitud.codigo'), '-', ''), {
          [Op.iLike]: `%${q.replace(/[\s-]/g, '')}%`,
        }),
      );
    } else {
      dondePaciente.push(
        sequelize.literal(
          `"solicitud->paciente"."nombre_busqueda" ILIKE '%' || lower(f_unaccent(${texto})) || '%'`,
        ),
      );
    }
  }

  const { count, rows } = await Asignacion.findAndCountAll({
    where: { voluntarioId: voluntario.id, activa: true, ...(estado ? { estado } : {}) },
    include: [
      {
        association: 'solicitud',
        required: true,
        attributes: ['id', 'codigo', 'estado'],
        where: dondeSolicitud.length ? { [Op.and]: dondeSolicitud } : undefined,
        include: [
          {
            association: 'paciente',
            required: true,
            attributes: ['nombres', 'apellidoPaterno', 'apellidoMaterno', 'fechaNacimiento'],
            where: dondePaciente.length ? { [Op.and]: dondePaciente } : undefined,
            include: [{ association: 'municipio', attributes: ['codigo', 'nombre'] }],
          },
        ],
      },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
    // Solo asociaciones 1:1: sin subconsulta, el filtro por nombre ve el alias del paciente.
    subQuery: false,
  });

  return {
    datos: rows.map((a) => {
      const { solicitud } = a;
      const { paciente } = solicitud;
      const hechos = analisis.get(solicitud.id)?.hechos;
      return {
        asignacionId: a.id,
        solicitudId: solicitud.id,
        codigo: solicitud.codigo,
        estadoSolicitud: solicitud.estado,
        paciente: {
          nombreCompleto: nombreCompleto(paciente),
          edad: edadDe(paciente.fechaNacimiento),
          municipio: paciente.municipio
            ? { codigo: paciente.municipio.codigo, nombre: paciente.municipio.nombre }
            : null,
        },
        estadoAsignacion: a.estado,
        pendientes: {
          documentos: hechos?.pendientesDocumentos ?? 0,
          revisionesOcr: hechos?.revisionesOcr ?? 0,
        },
        asignadaEn: a.createdAt.toISOString(),
      };
    }),
    paginacion: { page, limit, total: count },
  };
}

module.exports = { resumen, listarCasos, edadDe };
