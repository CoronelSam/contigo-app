'use strict';

// Inicio (42), actividad reciente y tablero (43) del coordinador.

const { Op } = require('sequelize');
const { ESTADOS_SOLICITUD: E, LISTA_ESTADOS_SOLICITUD } = require('../../core/estados/constantes');
const {
  iso,
  idiomaDe,
  nombreCompleto,
  nombrePersona,
  edadDe,
  diasDesde,
  esBusquedaDeCodigo,
  describir,
  ACCIONES_SIN_ACTIVIDAD,
} = require('./coordinador.util');

const { formatearCodigo } = require('../solicitudes/codigo');

const modelos = () => require('../../models');

/** Estados que cuenta el inicio (42); los 2 últimos los pide el DR para la ruta Honduras. */
const ESTADOS_RESUMEN = Object.freeze([
  E.EN_REVISION,
  E.COMPLETA,
  E.ENVIADA,
  E.INFO_ADICIONAL,
  E.EN_EVALUACION,
  E.DERIVADA_HN,
]);

/** Sin filtro de estado, el tablero muestra los casos en curso (ni borradores ni terminados). */
const FUERA_DEL_TABLERO = Object.freeze([E.BORRADOR, E.ACEPTADA, E.ATENDIDA_HN]);
const EN_CURSO = Object.freeze(
  LISTA_ESTADOS_SOLICITUD.filter((e) => !FUERA_DEL_TABLERO.includes(e)),
);

const autorDe = (u) =>
  u ? { id: u.id, nombre: nombrePersona(u), rol: u.rol?.codigo ?? '' } : null;

/**
 * Actividad reciente desde la bitácora de los casos (cada cambio de estado también queda ahí).
 * @param {{ idioma?: string }} usuario
 * @param {{ page: number, limit: number }} paginacion
 */
async function actividad(usuario, { page, limit }) {
  const { Bitacora } = modelos();
  const idioma = idiomaDe(usuario);
  const { count, rows } = await Bitacora.findAndCountAll({
    where: {
      solicitudId: { [Op.ne]: null },
      accion: { [Op.notIn]: ACCIONES_SIN_ACTIVIDAD },
    },
    include: [
      {
        association: 'usuario',
        attributes: ['id', 'nombres', 'apellidos'],
        include: [{ association: 'rol', attributes: ['codigo'] }],
      },
      { association: 'solicitud', attributes: ['codigo'] },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit,
    offset: (page - 1) * limit,
  });
  return {
    datos: rows.map((b) => ({
      id: b.id,
      accion: b.accion,
      descripcion: describir(b.accion, idioma),
      solicitudId: b.solicitudId,
      codigoCaso: b.solicitud?.codigo ?? null,
      autor: autorDe(b.usuario),
      fecha: iso(b.createdAt),
    })),
    paginacion: { page, limit, total: count },
  };
}

/**
 * GET /coordinador/resumen: contadores por estado y las 10 actividades más recientes.
 * @param {{ idioma?: string }} usuario
 */
async function resumen(usuario) {
  const { Solicitud, sequelize } = modelos();
  const filas = await Solicitud.findAll({
    where: { estado: ESTADOS_RESUMEN },
    attributes: ['estado', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    group: ['estado'],
    raw: true,
  });
  const contadores = Object.fromEntries(ESTADOS_RESUMEN.map((e) => [e, 0]));
  for (const f of filas) contadores[f.estado] = Number(f.n);
  const { datos } = await actividad(usuario, { page: 1, limit: 10 });
  return { contadores, actividad: datos };
}

/** WHERE y parámetros del tablero. Solo valores por `replacements`, nunca concatenados. */
function filtrosTablero(usuario, { q, estado, destino, etapa, mios }) {
  const condiciones = [];
  const replacements = {};
  // Siempre una lista IN: así el planificador usa el índice (estado, ultimo_cambio_estado).
  condiciones.push('s.estado IN (:estados)');
  replacements.estados = estado?.length ? estado : EN_CURSO;
  if (etapa) {
    condiciones.push('s.etapa = :etapa');
    replacements.etapa = etapa;
  }
  if (destino === 'sin_decidir') condiciones.push('s.ruta_decidida IS NULL');
  else if (destino) {
    condiciones.push('s.ruta_decidida = :destino');
    replacements.destino = destino;
  }
  if (mios) {
    condiciones.push('s.coordinador_id = :yo');
    replacements.yo = usuario.id;
  }
  if (q) {
    if (esBusquedaDeCodigo(q) && /^hn/i.test(q.trim())) {
      // Código completo (`HN-0258`, `hn258`): igualdad, que usa el índice único del código.
      condiciones.push('s.codigo = :codigo');
      replacements.codigo = formatearCodigo(Number(q.replace(/\D/g, '')));
    } else if (esBusquedaDeCodigo(q)) {
      // Parte del número: búsqueda parcial.
      condiciones.push("replace(s.codigo, '-', '') ILIKE :codigo");
      replacements.codigo = `%${q.replace(/[\s-]/g, '')}%`;
    } else {
      // Usa el índice trigram de pacientes.nombre_busqueda.
      condiciones.push("p.nombre_busqueda ILIKE '%' || lower(f_unaccent(:q)) || '%'");
      replacements.q = q;
    }
  }
  return { where: condiciones.join(' AND '), replacements };
}

/** Consulta del tablero (también la usa la prueba de EXPLAIN). */
function sqlTablero(where) {
  return `
    SELECT s.id, s.codigo, s.estado, s.etapa, s.ruta_sugerida, s.ruta_decidida,
           s.ultimo_cambio_estado, s.faltantes_al_enviar, s.coordinador_id,
           p.nombres, p.apellido_paterno, p.apellido_materno, p.fecha_nacimiento,
           p.posible_duplicado, d.codigo AS departamento_codigo, d.nombre AS departamento_nombre
      FROM solicitudes s
      JOIN pacientes p ON p.id = s.paciente_id
      LEFT JOIN municipios m ON m.codigo = p.municipio_codigo
      LEFT JOIN departamentos d ON d.codigo = m.departamento_codigo
     WHERE ${where}
     ORDER BY s.ultimo_cambio_estado ASC, s.id ASC
     LIMIT :limit OFFSET :offset`;
}

/**
 * GET /solicitudes (tablero): por defecto, más tiempo esperando primero.
 * @param {{ id: string }} usuario
 * @param {{ q?: string, estado?: string[], destino?: string, etapa?: string, mios?: boolean,
 *   page: number, limit: number }} filtros
 */
async function tablero(usuario, filtros) {
  const { sequelize, Asignacion, Usuario } = modelos();
  const { page, limit } = filtros;
  const { where, replacements } = filtrosTablero(usuario, filtros);
  const tipo = { type: sequelize.QueryTypes.SELECT };

  const [filas, [{ total }]] = await Promise.all([
    sequelize.query(sqlTablero(where), {
      ...tipo,
      replacements: { ...replacements, limit, offset: (page - 1) * limit },
    }),
    sequelize.query(
      `SELECT count(*)::int AS total FROM solicitudes s
         JOIN pacientes p ON p.id = s.paciente_id WHERE ${where}`,
      { ...tipo, replacements },
    ),
  ]);

  const ids = filas.map((f) => f.id);
  const [asignaciones, coordinadores] = await Promise.all([
    ids.length
      ? Asignacion.findAll({
          where: { solicitudId: ids, activa: true },
          include: [{ association: 'voluntario', attributes: ['id', 'nombres', 'apellidos'] }],
          order: [['createdAt', 'ASC']],
        })
      : [],
    Usuario.findAll({
      where: { id: [...new Set(filas.map((f) => f.coordinador_id).filter(Boolean))] },
      attributes: ['id', 'nombres', 'apellidos'],
    }),
  ]);
  const coordinadorPorId = new Map(coordinadores.map((c) => [c.id, c]));

  return {
    datos: filas.map((f) => {
      const coordinador = coordinadorPorId.get(f.coordinador_id);
      return {
        id: f.id,
        codigo: f.codigo,
        paciente: {
          nombreCompleto: nombreCompleto(f),
          edad: edadDe(f.fecha_nacimiento),
          departamento: f.departamento_codigo
            ? { codigo: f.departamento_codigo, nombre: f.departamento_nombre }
            : null,
        },
        estado: f.estado,
        etapa: f.etapa,
        rutaSugerida: f.ruta_sugerida,
        rutaDecidida: f.ruta_decidida,
        diasEnEstado: diasDesde(f.ultimo_cambio_estado),
        faltantesAlEnviar: f.faltantes_al_enviar ?? [],
        voluntarios: asignaciones
          .filter((a) => a.solicitudId === f.id)
          .map((a) => ({ id: a.voluntario.id, nombre: nombrePersona(a.voluntario) })),
        coordinador: coordinador
          ? { id: coordinador.id, nombre: nombrePersona(coordinador) }
          : null,
        posibleDuplicado: f.posible_duplicado,
      };
    }),
    paginacion: { page, limit, total },
  };
}

module.exports = {
  ESTADOS_RESUMEN,
  FUERA_DEL_TABLERO,
  resumen,
  actividad,
  tablero,
  filtrosTablero,
  sqlTablero,
};
