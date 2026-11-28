'use strict';

// Reportes (56): solo agregados, nunca nombres, códigos de caso ni datos de un niño.
// Consultas SQL con `replacements`, agrupadas por mes en America/Tegucigalpa. El rango
// `desde`–`hasta` es de fechas locales, las dos incluidas.

const { QueryTypes } = require('sequelize');
const {
  ESTADOS_SOLICITUD: E,
  RUTAS,
  LISTA_PAQUETES,
  LISTA_ESTADOS_SOLICITUD,
  LISTA_ETAPAS,
} = require('../../core/estados/constantes');
const errores = require('./admin.errores');

const modelos = () => require('../../models');

const ZONA = 'America/Tegucigalpa';
const MESES_POR_DEFECTO = 12;
const MAX_MESES = 60;
const CERRADOS = Object.freeze([E.ACEPTADA, E.ATENDIDA_HN, E.DENEGADA]);

/** Instantes de inicio y fin del rango (fin exclusivo: el día siguiente a `hasta`). */
const RANGO = `rango AS (
  SELECT CAST(:desde AS date)::timestamp AT TIME ZONE :zona AS inicio,
         (CAST(:hasta AS date) + 1)::timestamp AT TIME ZONE :zona AS fin
)`;
const DIAS = (fin, inicio) => `EXTRACT(EPOCH FROM (${fin} - ${inicio}))::float8 / 86400`;

const redondear = (valor, decimales) =>
  valor === null || valor === undefined
    ? null
    : Math.round(Number(valor) * 10 ** decimales) / 10 ** decimales;
const tasa = (parte, total) => (total ? redondear(parte / total, 4) : null);

/** Fecha de hoy (YYYY-MM-DD) en America/Tegucigalpa. */
function hoyLocal(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

/** Primer día del mes `meses` antes del mes de `fecha`. */
function primerDiaMesesAntes(fecha, meses) {
  const [a, m] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 - meses, 1)).toISOString().slice(0, 10);
}

/** Meses 'YYYY-MM' del rango, los dos extremos incluidos. */
function mesesDelRango(desde, hasta) {
  const meses = [];
  let [a, m] = desde.split('-').map(Number);
  const [aFin, mFin] = hasta.split('-').map(Number);
  while (a < aFin || (a === aFin && m <= mFin)) {
    meses.push(`${a}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
  return meses;
}

/**
 * Rango del reporte: por defecto, los últimos 12 meses (del primer día de hace 11 meses a hoy).
 * @param {{ desde?: string, hasta?: string }} filtros
 */
function rangoDe({ desde, hasta } = {}) {
  const fin = hasta ?? hoyLocal();
  const inicio = desde ?? primerDiaMesesAntes(fin, MESES_POR_DEFECTO - 1);
  if (inicio > fin) throw errores.rangoInvalido('desde', 'POSTERIOR_A_HASTA');
  if (mesesDelRango(inicio, fin).length > MAX_MESES) {
    throw errores.rangoInvalido('desde', 'RANGO_DEMASIADO_AMPLIO');
  }
  return { desde: inicio, hasta: fin };
}

async function consultar(sql, rango, extra = {}) {
  const { sequelize } = modelos();
  return sequelize.query(sql, {
    replacements: { ...rango, zona: ZONA, ...extra },
    type: QueryTypes.SELECT,
  });
}

/** Casos creados por mes y casos que llegaron a un estado de cierre en cada mes. */
async function casosPorMes(rango) {
  const [creados, cierres] = await Promise.all([
    consultar(
      `WITH ${RANGO}
       SELECT to_char(s.created_at AT TIME ZONE :zona, 'YYYY-MM') AS mes, count(*)::int AS n
         FROM solicitudes s, rango
        WHERE s.created_at >= rango.inicio AND s.created_at < rango.fin
        GROUP BY 1`,
      rango,
    ),
    consultar(
      `WITH ${RANGO}
       SELECT to_char(h.created_at AT TIME ZONE :zona, 'YYYY-MM') AS mes,
              count(DISTINCT h.solicitud_id)::int AS cerrados,
              count(DISTINCT h.solicitud_id) FILTER (WHERE h.estado_nuevo = :aceptada)::int AS aceptadas,
              count(DISTINCT h.solicitud_id) FILTER (WHERE h.estado_nuevo = :atendida)::int AS atendidas,
              count(DISTINCT h.solicitud_id) FILTER (WHERE h.estado_nuevo = :denegada)::int AS denegadas
         FROM historial_estados h, rango
        WHERE h.estado_nuevo IN (:cerrados)
          AND h.created_at >= rango.inicio AND h.created_at < rango.fin
        GROUP BY 1`,
      rango,
      { cerrados: CERRADOS, aceptada: E.ACEPTADA, atendida: E.ATENDIDA_HN, denegada: E.DENEGADA },
    ),
  ]);
  const creadosPorMes = new Map(creados.map((f) => [f.mes, f.n]));
  const cierresPorMes = new Map(cierres.map((f) => [f.mes, f]));
  return mesesDelRango(rango.desde, rango.hasta).map((mes) => {
    const c = cierresPorMes.get(mes);
    return {
      mes,
      creados: creadosPorMes.get(mes) ?? 0,
      cerrados: c?.cerrados ?? 0,
      aceptadas: c?.aceptadas ?? 0,
      atendidasHn: c?.atendidas ?? 0,
      denegadas: c?.denegadas ?? 0,
    };
  });
}

/**
 * Tiempo en cada estado (y etapa): de la entrada en el estado a la siguiente transición del
 * mismo caso. Cuenta los tramos que terminaron dentro del rango.
 */
async function tiemposRevision(rango) {
  const filas = await consultar(
    `WITH ${RANGO},
     tramos AS (
       SELECT h.estado_nuevo AS estado, h.etapa, h.created_at AS entrada,
              lead(h.created_at) OVER (PARTITION BY h.solicitud_id ORDER BY h.created_at, h.id) AS salida
         FROM historial_estados h, rango
        WHERE h.created_at < rango.fin
     )
     SELECT t.estado, t.etapa, count(*)::int AS casos,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ${DIAS('t.salida', 't.entrada')}) AS mediana,
            avg(${DIAS('t.salida', 't.entrada')}) AS promedio
       FROM tramos t, rango
      WHERE t.salida >= rango.inicio AND t.salida < rango.fin
      GROUP BY t.estado, t.etapa`,
    rango,
  );
  // En el orden del proceso, no en el alfabético (que depende de la collation).
  const posicion = (f) =>
    LISTA_ESTADOS_SOLICITUD.indexOf(f.estado) * 10 +
    (f.etapa ? LISTA_ETAPAS.indexOf(f.etapa) + 1 : 0);
  filas.sort((a, b) => posicion(a) - posicion(b));
  return filas.map((f) => ({
    estado: f.estado,
    etapa: f.etapa ?? null,
    casos: f.casos,
    medianaDias: redondear(f.mediana, 2),
    promedioDias: redondear(f.promedio, 2),
  }));
}

/** Campos de OCR revisados en el rango: confirmados tal cual frente a corregidos. */
async function precisionOcr(rango) {
  const filas = await consultar(
    `WITH ${RANGO}
     SELECT to_char(coalesce(c.revisado_en, c.updated_at) AT TIME ZONE :zona, 'YYYY-MM') AS mes,
            count(*) FILTER (WHERE c.estado = 'confirmado')::int AS confirmados,
            count(*) FILTER (WHERE c.estado = 'corregido')::int AS corregidos
       FROM campos_extraidos c, rango
      WHERE c.estado IN ('confirmado', 'corregido')
        AND coalesce(c.revisado_en, c.updated_at) >= rango.inicio
        AND coalesce(c.revisado_en, c.updated_at) < rango.fin
      GROUP BY 1`,
    rango,
  );
  const porMes = new Map(filas.map((f) => [f.mes, f]));
  const confirmados = filas.reduce((s, f) => s + f.confirmados, 0);
  const corregidos = filas.reduce((s, f) => s + f.corregidos, 0);
  return {
    confirmados,
    corregidos,
    revisados: confirmados + corregidos,
    precision: tasa(confirmados, confirmados + corregidos),
    porMes: mesesDelRango(rango.desde, rango.hasta).map((mes) => {
      const f = porMes.get(mes);
      const c = f?.confirmados ?? 0;
      const k = f?.corregidos ?? 0;
      return { mes, confirmados: c, corregidos: k, precision: tasa(c, c + k) };
    }),
  };
}

/** Ruta de la evaluación vigente de los casos decididos en el rango. */
async function rutas(rango) {
  const filas = await consultar(
    `WITH ${RANGO}
     SELECT e.ruta_decidida AS ruta, count(*)::int AS casos,
            count(*) FILTER (WHERE s.estado = :atendida)::int AS atendidos
       FROM evaluaciones e
       JOIN solicitudes s ON s.id = e.solicitud_id, rango
      WHERE e.vigente AND e.created_at >= rango.inicio AND e.created_at < rango.fin
      GROUP BY 1`,
    rango,
    { atendida: E.ATENDIDA_HN },
  );
  const por = new Map(filas.map((f) => [f.ruta, f]));
  const casos = (ruta) => por.get(ruta)?.casos ?? 0;
  return {
    honduras: casos(RUTAS.HONDURAS),
    mexico: casos(RUTAS.MEXICO),
    internacional: casos(RUTAS.INTERNACIONAL),
    exterior: casos(RUTAS.MEXICO) + casos(RUTAS.INTERNACIONAL),
    atendidosEnHonduras: por.get(RUTAS.HONDURAS)?.atendidos ?? 0,
  };
}

/** De la primera entrada en EN_EVALUACION a la primera evaluación registrada después. */
async function tiempoHastaDecision(rango) {
  const [fila] = await consultar(
    `WITH ${RANGO},
     entradas AS (
       SELECT solicitud_id, min(created_at) AS entrada
         FROM historial_estados
        WHERE estado_nuevo = :evaluacion
        GROUP BY solicitud_id
     ),
     decisiones AS (
       SELECT en.solicitud_id, en.entrada, min(e.created_at) AS decidida
         FROM entradas en
         JOIN evaluaciones e ON e.solicitud_id = en.solicitud_id AND e.created_at >= en.entrada
        GROUP BY en.solicitud_id, en.entrada
     )
     SELECT count(*)::int AS casos,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ${DIAS('d.decidida', 'd.entrada')}) AS mediana,
            avg(${DIAS('d.decidida', 'd.entrada')}) AS promedio
       FROM decisiones d, rango
      WHERE d.decidida >= rango.inicio AND d.decidida < rango.fin`,
    rango,
    { evaluacion: E.EN_EVALUACION },
  );
  return {
    casos: fila.casos,
    medianaDias: redondear(fila.mediana, 2),
    promedioDias: redondear(fila.promedio, 2),
  };
}

/** Respuestas finales de Shriners (aceptada o denegada) por destino del envío. */
async function aceptacionPorDestino(rango) {
  const filas = await consultar(
    `SELECT coalesce(en.destino, s.paquete) AS destino,
            count(*) FILTER (WHERE r.resultado = 'aceptada')::int AS aceptadas,
            count(*) FILTER (WHERE r.resultado = 'denegada')::int AS denegadas
       FROM respuestas_shriners r
       JOIN solicitudes s ON s.id = r.solicitud_id
       LEFT JOIN envios en ON en.id = r.envio_id
      WHERE r.resultado IN ('aceptada', 'denegada')
        AND r.fecha >= CAST(:desde AS date) AND r.fecha <= CAST(:hasta AS date)
      GROUP BY 1`,
    rango,
  );
  const por = new Map(filas.map((f) => [f.destino, f]));
  return LISTA_PAQUETES.map((destino) => {
    const aceptadas = por.get(destino)?.aceptadas ?? 0;
    const denegadas = por.get(destino)?.denegadas ?? 0;
    return {
      destino,
      aceptadas,
      denegadas,
      respuestasFinales: aceptadas + denegadas,
      tasa: tasa(aceptadas, aceptadas + denegadas),
    };
  });
}

/**
 * GET /admin/reportes
 * @param {{ desde?: string, hasta?: string }} filtros
 */
async function reportes(filtros) {
  const rango = rangoDe(filtros);
  const [casos, tiempos, ocr, porRuta, decision, aceptacion] = await Promise.all([
    casosPorMes(rango),
    tiemposRevision(rango),
    precisionOcr(rango),
    rutas(rango),
    tiempoHastaDecision(rango),
    aceptacionPorDestino(rango),
  ]);
  return {
    desde: rango.desde,
    hasta: rango.hasta,
    zonaHoraria: ZONA,
    casosPorMes: casos,
    tiemposRevision: tiempos,
    precisionOcr: ocr,
    rutas: porRuta,
    tiempoHastaDecision: decision,
    aceptacionPorDestino: aceptacion,
  };
}

module.exports = { reportes, rangoDe, hoyLocal, ZONA };
