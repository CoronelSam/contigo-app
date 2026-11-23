'use strict';

// Inicio (42), actividad reciente y tablero (43) del coordinador.

const { ESTADOS_SOLICITUD: E, LISTA_ESTADOS_SOLICITUD } = require('../../core/estados/constantes');
const { TRANSICIONES } = require('../../core/estados');
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

/**
 * Estados que el tablero oculta sin filtro de estado, si `tablero.estados_ocultos` no existe:
 * borradores (todavía no llegan al equipo) y casos terminados.
 */
const OCULTOS_POR_DEFECTO = Object.freeze([E.BORRADOR, E.ACEPTADA, E.ATENDIDA_HN]);

/** Acciones de la bitácora que son cambios de estado: en la actividad salen del historial. */
const ACCIONES_DE_ESTADO = Object.freeze(TRANSICIONES.map((t) => `solicitud.${t.accion}`));

const autorDe = (u) =>
  u ? { id: u.id, nombre: nombrePersona(u), rol: u.rol?.codigo ?? '' } : null;

/** Acción (`solicitud.enviar`, …) del cambio de estado de una fila del historial. */
function accionDeCambio(de, a) {
  const transicion = TRANSICIONES.find((t) => t.a === a && t.de.includes(de));
  return `solicitud.${transicion?.accion ?? 'cambio_estado'}`;
}

/**
 * Actividad reciente de los casos: los cambios de estado salen de `historial_estados` (con el
 * estado anterior, el nuevo y la nota) y el resto de las acciones, de la bitácora. Cada cambio de
 * estado también está en la bitácora: ahí se omite para no repetirlo.
 * @param {{ idioma?: string }} usuario
 * @param {{ page: number, limit: number }} paginacion
 */
async function actividad(usuario, { page, limit }) {
  const { sequelize, Usuario, Solicitud } = modelos();
  const idioma = idiomaDe(usuario);
  const tipo = { type: sequelize.QueryTypes.SELECT };
  const union = `
    FROM (
      SELECT b.id, b.accion, b.solicitud_id, b.usuario_id, b.created_at,
             NULL::varchar AS estado_anterior, NULL::varchar AS estado_nuevo, NULL::text AS nota
        FROM bitacora b
       WHERE b.solicitud_id IS NOT NULL AND b.accion NOT IN (:excluidas)
      UNION ALL
      SELECT h.id, NULL, h.solicitud_id, h.usuario_id, h.created_at,
             h.estado_anterior, h.estado_nuevo, h.nota
        FROM historial_estados h
    ) a`;
  const replacements = { excluidas: [...ACCIONES_SIN_ACTIVIDAD, ...ACCIONES_DE_ESTADO] };

  const [filas, [{ total }]] = await Promise.all([
    sequelize.query(
      `SELECT a.* ${union} ORDER BY a.created_at DESC, a.id ASC LIMIT :limit OFFSET :offset`,
      { ...tipo, replacements: { ...replacements, limit, offset: (page - 1) * limit } },
    ),
    sequelize.query(`SELECT count(*)::int AS total ${union}`, { ...tipo, replacements }),
  ]);

  const [autores, solicitudes] = await Promise.all([
    Usuario.findAll({
      where: { id: [...new Set(filas.map((f) => f.usuario_id).filter(Boolean))] },
      attributes: ['id', 'nombres', 'apellidos'],
      include: [{ association: 'rol', attributes: ['codigo'] }],
    }),
    Solicitud.findAll({
      where: { id: [...new Set(filas.map((f) => f.solicitud_id))] },
      attributes: ['id', 'codigo'],
    }),
  ]);
  const autorPorId = new Map(autores.map((u) => [u.id, u]));
  const codigoPorId = new Map(solicitudes.map((s) => [s.id, s.codigo]));

  return {
    datos: filas.map((f) => {
      const esCambio = f.estado_nuevo !== null;
      const accion = esCambio ? accionDeCambio(f.estado_anterior, f.estado_nuevo) : f.accion;
      return {
        id: f.id,
        accion,
        descripcion: describir(accion, idioma),
        solicitudId: f.solicitud_id,
        codigoCaso: codigoPorId.get(f.solicitud_id) ?? null,
        autor: autorDe(autorPorId.get(f.usuario_id)),
        fecha: iso(f.created_at),
        estadoAnterior: f.estado_anterior ?? null,
        estadoNuevo: f.estado_nuevo ?? null,
        nota: f.nota ?? null,
      };
    }),
    paginacion: { page, limit, total },
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

/**
 * Estados que el tablero muestra sin filtro: todos salvo los de `tablero.estados_ocultos`
 * (decisión de la organización; por defecto, borradores y terminados).
 */
async function estadosVisibles() {
  const { Configuracion } = modelos();
  const fila = await Configuracion.findByPk('tablero.estados_ocultos');
  const ocultos = Array.isArray(fila?.valor) ? fila.valor : OCULTOS_POR_DEFECTO;
  return LISTA_ESTADOS_SOLICITUD.filter((e) => !ocultos.includes(e));
}

/**
 * WHERE y parámetros del tablero. Solo valores por `replacements`, nunca concatenados.
 * @param {{ id: string }} usuario
 * @param {object} filtros
 * @param {string[]} [visibles] Estados a mostrar sin filtro de estado.
 */
function filtrosTablero(usuario, { q, estado, destino, etapa, mios }, visibles) {
  const condiciones = [];
  const replacements = {};
  // Siempre una lista IN: así el planificador usa el índice (estado, ultimo_cambio_estado).
  // Si la configuración ocultara todos los estados, el tablero quedaría vacío: se muestran todos.
  let porDefecto = visibles;
  if (!porDefecto)
    porDefecto = LISTA_ESTADOS_SOLICITUD.filter((e) => !OCULTOS_POR_DEFECTO.includes(e));
  else if (!porDefecto.length) porDefecto = LISTA_ESTADOS_SOLICITUD;
  condiciones.push('s.estado IN (:estados)');
  replacements.estados = estado?.length ? estado : porDefecto;
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

/** Consulta del tablero (también la usa la medición con EXPLAIN). */
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
  const visibles = filtros.estado?.length ? undefined : await estadosVisibles();
  const { where, replacements } = filtrosTablero(usuario, filtros, visibles);
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
  OCULTOS_POR_DEFECTO,
  resumen,
  actividad,
  tablero,
  filtrosTablero,
  sqlTablero,
};
