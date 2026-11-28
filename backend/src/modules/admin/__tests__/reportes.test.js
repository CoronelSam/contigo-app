'use strict';

// Reportes con un conjunto ficticio de resultados conocidos (primer trimestre de 2026).
// America/Tegucigalpa es UTC−6: 2026-02-01T03:00Z todavía es 31 de enero en Honduras.

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { hoyLocal } = require('../reportes.service');

let token;

/** Cambia `created_at` de una fila (las factories crean con la hora actual). */
async function fechar(modelo, fila, iso) {
  await db.sequelize.query(`UPDATE ${modelo.getTableName()} SET created_at = :f WHERE id = :id`, {
    replacements: { f: iso, id: fila.id },
  });
}

async function solicitud(creada, datos = {}) {
  const s = await f.crearSolicitud({ estado: 'EN_REVISION', ...datos });
  await fechar(db.Solicitud, s, creada);
  return s;
}

/** Historial: [estadoNuevo, fecha ISO, etapa?] en orden. */
async function historial(s, pasos) {
  let anterior = null;
  for (const [estado, fecha, etapa = null] of pasos) {
    const h = await db.HistorialEstado.create({
      solicitudId: s.id,
      estadoAnterior: anterior,
      estadoNuevo: estado,
      etapa,
    });
    await fechar(db.HistorialEstado, h, fecha);
    anterior = estado;
  }
}

async function evaluacion(s, ruta, fecha, vigente = true) {
  const e = await f.crearEvaluacion({ solicitud: s, rutaDecidida: ruta, vigente });
  await fechar(db.Evaluacion, e, fecha);
}

async function respuesta(s, resultado, fecha, destino) {
  let envioId = null;
  if (destino) {
    const paquete = await f.crearPaquetePdf({ solicitud: s, paquete: destino });
    const envio = await db.Envio.create({
      solicitudId: s.id,
      paquetePdfId: paquete.id,
      destino,
      fecha,
      metodo: 'correo',
    });
    envioId = envio.id;
  }
  await db.RespuestaShriners.create({ solicitudId: s.id, envioId, fecha, resultado });
}

async function camposOcr(campos) {
  await f.crearExtraccion({
    estado: 'confirmada',
    campos: campos.map(([estado, revisadoEn], i) => ({
      campo: `campo_ficticio_${i}`,
      seccion: 'informacion_medica',
      tipo: 'texto',
      valorLeido: 'Valor ficticio',
      confianza: 0.9,
      estado,
      revisadoEn: revisadoEn ? new Date(revisadoEn) : null,
    })),
  });
}

async function sembrarDatos() {
  const R = 'evaluacion';
  // S1: Honduras, atendido en febrero.
  const s1 = await solicitud('2026-01-10T15:00:00Z', { estado: 'ATENDIDA_HN' });
  await historial(s1, [
    ['EN_REVISION', '2026-01-10T15:00:00Z', R],
    ['EN_EVALUACION', '2026-01-12T15:00:00Z'],
    ['DERIVADA_HN', '2026-01-15T15:00:00Z'],
    ['ATENDIDA_HN', '2026-02-14T15:00:00Z'],
  ]);
  await evaluacion(s1, 'HONDURAS', '2026-01-15T15:00:00Z');

  // S2: creada el 31 de enero (hora local); México, aceptada en marzo.
  const s2 = await solicitud('2026-02-01T03:00:00Z', { estado: 'ACEPTADA', paquete: 'MEXICO' });
  await historial(s2, [
    ['EN_REVISION', '2026-02-01T03:00:00Z', R],
    ['EN_EVALUACION', '2026-02-05T03:00:00Z'],
    ['PAQUETE_EXTERIOR', '2026-02-06T03:00:00Z'],
    ['ENVIADA', '2026-02-16T03:00:00Z'],
    ['ACEPTADA', '2026-03-18T03:00:00Z'],
  ]);
  await evaluacion(s2, 'MEXICO', '2026-02-06T03:00:00Z');
  await respuesta(s2, 'aceptada', '2026-03-17', 'MEXICO');

  // S3: internacional, denegada; vuelve a evaluación y se deriva en Honduras.
  const s3 = await solicitud('2026-02-15T15:00:00Z', { estado: 'DERIVADA_HN' });
  await historial(s3, [
    ['EN_REVISION', '2026-02-15T15:00:00Z', R],
    ['EN_EVALUACION', '2026-02-21T15:00:00Z'],
    ['PAQUETE_EXTERIOR', '2026-02-23T15:00:00Z'],
    ['ENVIADA', '2026-03-01T15:00:00Z'],
    ['DENEGADA', '2026-03-11T15:00:00Z'],
    ['EN_EVALUACION', '2026-03-15T15:00:00Z'],
    ['DERIVADA_HN', '2026-03-20T15:00:00Z'],
  ]);
  await evaluacion(s3, 'INTERNACIONAL', '2026-02-23T15:00:00Z', false);
  await evaluacion(s3, 'HONDURAS', '2026-03-20T15:00:00Z');
  await respuesta(s3, 'denegada', '2026-03-10', 'INTERNACIONAL');

  // S4: creada el 31 de marzo a las 23:00 (hora local); respuesta sin envío (destino del caso).
  const s4 = await solicitud('2026-04-01T05:00:00Z', { paquete: 'MEXICO' });
  await historial(s4, [['EN_REVISION', '2026-04-01T05:00:00Z', R]]);
  await respuesta(s4, 'denegada', '2026-03-31', null);

  // S5: 1 de abril a las 00:30 (hora local): fuera del rango.
  await solicitud('2026-04-01T06:30:00Z');

  // S6: de diciembre de 2025; solo su salida de PAQUETE_EXTERIOR cae en el rango.
  const s6 = await solicitud('2025-12-20T15:00:00Z', {
    estado: 'ENVIADA',
    paquete: 'INTERNACIONAL',
  });
  await historial(s6, [
    ['EN_EVALUACION', '2025-12-20T15:00:00Z'],
    ['PAQUETE_EXTERIOR', '2025-12-25T15:00:00Z'],
    ['ENVIADA', '2026-01-05T15:00:00Z'],
  ]);
  await evaluacion(s6, 'INTERNACIONAL', '2025-12-25T15:00:00Z');
  await respuesta(s6, 'aceptada', '2026-04-02', null);
  await respuesta(s6, 'informacion_adicional', '2026-01-20', null);

  // OCR: enero 3 de 4 confirmados; marzo 1 de 3 (uno revisado el 31 a las 23:00 local).
  await camposOcr([
    ['confirmado', '2026-01-20T15:00:00Z'],
    ['confirmado', '2026-01-20T15:00:00Z'],
    ['confirmado', '2026-01-21T15:00:00Z'],
    ['corregido', '2026-01-21T15:00:00Z'],
    ['propuesto', null],
    ['confirmado', '2025-12-31T23:00:00Z'],
  ]);
  await camposOcr([
    ['confirmado', '2026-04-01T05:00:00Z'],
    ['corregido', '2026-03-05T15:00:00Z'],
    ['corregido', '2026-03-06T15:00:00Z'],
  ]);
  return [s1, s2, s3, s4, s6];
}

beforeEach(async () => {
  await limpiarBase();
  token = await tokenPara(await f.crearUsuario({ rol: 'administrador' }));
});

const reportes = (q = '') =>
  api().get(`/api/v1/admin/reportes${q}`).set('Authorization', `Bearer ${token}`);

test('cada indicador del primer trimestre con números exactos', async () => {
  const casos = await sembrarDatos();
  const res = await reportes('?desde=2026-01-01&hasta=2026-03-31').expect(200);
  const r = res.body;
  expect(r).toMatchObject({
    desde: '2026-01-01',
    hasta: '2026-03-31',
    zonaHoraria: 'America/Tegucigalpa',
  });

  expect(r.casosPorMes).toEqual([
    { mes: '2026-01', creados: 2, cerrados: 0, aceptadas: 0, atendidasHn: 0, denegadas: 0 },
    { mes: '2026-02', creados: 1, cerrados: 1, aceptadas: 0, atendidasHn: 1, denegadas: 0 },
    { mes: '2026-03', creados: 1, cerrados: 2, aceptadas: 1, atendidasHn: 0, denegadas: 1 },
  ]);

  expect(r.tiemposRevision).toEqual([
    { estado: 'EN_REVISION', etapa: 'evaluacion', casos: 3, medianaDias: 4, promedioDias: 4 },
    { estado: 'EN_EVALUACION', etapa: null, casos: 4, medianaDias: 2.5, promedioDias: 2.75 },
    { estado: 'PAQUETE_EXTERIOR', etapa: null, casos: 3, medianaDias: 10, promedioDias: 9 },
    { estado: 'ENVIADA', etapa: null, casos: 2, medianaDias: 20, promedioDias: 20 },
    { estado: 'DENEGADA', etapa: null, casos: 1, medianaDias: 4, promedioDias: 4 },
    { estado: 'DERIVADA_HN', etapa: null, casos: 1, medianaDias: 30, promedioDias: 30 },
  ]);

  expect(r.precisionOcr).toEqual({
    confirmados: 4,
    corregidos: 3,
    revisados: 7,
    precision: 0.5714,
    porMes: [
      { mes: '2026-01', confirmados: 3, corregidos: 1, precision: 0.75 },
      { mes: '2026-02', confirmados: 0, corregidos: 0, precision: null },
      { mes: '2026-03', confirmados: 1, corregidos: 2, precision: 0.3333 },
    ],
  });

  expect(r.rutas).toEqual({
    honduras: 2,
    mexico: 1,
    internacional: 0,
    exterior: 1,
    atendidosEnHonduras: 1,
  });

  expect(r.tiempoHastaDecision).toEqual({ casos: 3, medianaDias: 2, promedioDias: 2 });

  expect(r.aceptacionPorDestino).toEqual([
    { destino: 'MEXICO', aceptadas: 1, denegadas: 1, respuestasFinales: 2, tasa: 0.5 },
    { destino: 'INTERNACIONAL', aceptadas: 0, denegadas: 1, respuestasFinales: 1, tasa: 0 },
  ]);

  // Solo agregados: ningún código de caso ni identificador.
  const texto = JSON.stringify(r);
  for (const s of casos) {
    expect(texto).not.toContain(s.codigo);
    expect(texto).not.toContain(s.id);
  }
});

test('un mes sin datos sale en cero y las tasas sin denominador en null', async () => {
  const res = await reportes('?desde=2026-02-10&hasta=2026-02-10').expect(200);
  expect(res.body.casosPorMes).toEqual([
    { mes: '2026-02', creados: 0, cerrados: 0, aceptadas: 0, atendidasHn: 0, denegadas: 0 },
  ]);
  expect(res.body.tiemposRevision).toEqual([]);
  expect(res.body.tiempoHastaDecision).toEqual({ casos: 0, medianaDias: null, promedioDias: null });
  expect(res.body.precisionOcr.precision).toBeNull();
  expect(res.body.aceptacionPorDestino.map((d) => d.tasa)).toEqual([null, null]);
});

test('por defecto, los últimos 12 meses hasta hoy en Honduras', async () => {
  const res = await reportes().expect(200);
  const hoy = hoyLocal();
  expect(res.body.hasta).toBe(hoy);
  expect(res.body.desde.slice(8)).toBe('01');
  expect(res.body.casosPorMes).toHaveLength(12);
  expect(res.body.casosPorMes.at(-1).mes).toBe(hoy.slice(0, 7));
  const soloHasta = await reportes('?hasta=2026-03-15').expect(200);
  expect(soloHasta.body.desde).toBe('2025-04-01');
});

test('rango inválido → 400', async () => {
  const al = async (q) => (await reportes(q).expect(400)).body.campos;
  expect(await al('?desde=2026-03-01&hasta=2026-02-01')).toEqual({
    'query.desde': 'POSTERIOR_A_HASTA',
  });
  expect(await al('?desde=2020-01-01&hasta=2026-01-01')).toEqual({
    'query.desde': 'RANGO_DEMASIADO_AMPLIO',
  });
  expect(await al('?desde=2026-13-01')).toEqual({ 'query.desde': 'FORMATO_INVALIDO' });
});
