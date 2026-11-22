'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const eventos = require('../../../core/eventos');
const { recalcularEstadoAsignacion } = require('../estado');
const { casoAsignado, casos } = require('./ayudantes');

let ctx;

beforeEach(async () => {
  await limpiarBase();
  ctx = await casoAsignado();
});

const documento = (tipo, datos = {}) =>
  f.crearDocumento({ solicitud: ctx.solicitud, tipo, ...datos });
const estadoActual = async () => {
  await recalcularEstadoAsignacion(ctx.solicitud.id);
  return (await ctx.asignacion.reload()).estado;
};

describe('estado de la asignación', () => {
  test('asignado: recién asignado, sin capturas', async () => {
    expect(await estadoActual()).toBe('asignado');
  });

  test('captura_en_proceso: un documento en FALTA ya tiene páginas, o hay OCR en curso', async () => {
    await documento('fotos_condicion', { estado: 'FALTA', paginas: 1 });
    expect(await estadoActual()).toBe('captura_en_proceso');
  });

  test('captura_en_proceso también con una extracción en cola', async () => {
    const d = await documento('fotos_condicion');
    await f.crearExtraccion({ documento: d, estado: 'en_cola', progreso: 0 });
    expect(await estadoActual()).toBe('captura_en_proceso');
  });

  test('pendiente_captura: falta un obligatorio y ya hubo captura', async () => {
    await documento('fotos_condicion', { estado: 'RECHAZADO' });
    expect(await estadoActual()).toBe('pendiente_captura');
  });

  test('un documento en FALTA sin páginas no cuenta como captura', async () => {
    await documento('fotos_condicion', { estado: 'FALTA', paginas: 0 });
    expect(await estadoActual()).toBe('asignado');
  });

  test('en_revision: hay una extracción por confirmar', async () => {
    const d = await documento('fotos_condicion');
    await f.crearExtraccion({ documento: d });
    expect(await estadoActual()).toBe('en_revision');
  });

  test('revisado: los obligatorios están y todas las extracciones están confirmadas', async () => {
    const d = await documento('fotos_condicion');
    await f.crearExtraccion({ documento: d, estado: 'confirmada' });
    await documento('radiografias_informes');
    await documento('certificacion_medica');
    expect(await estadoActual()).toBe('revisado');
  });

  test('precedencia: revisión antes que captura en proceso, y esta antes que pendiente', async () => {
    const conOcr = await documento('fotos_condicion');
    await f.crearExtraccion({ documento: conOcr });
    await documento('radiografias_informes', { estado: 'FALTA', paginas: 2 });
    await documento('certificacion_medica', { estado: 'RECHAZADO' });
    expect(await estadoActual()).toBe('en_revision');

    await db.Extraccion.update({ estado: 'confirmada' }, { where: { documentoId: conOcr.id } });
    expect(await estadoActual()).toBe('captura_en_proceso');

    await db.Documento.update({ estado: 'CAPTURADO' }, { where: { estado: 'FALTA' } });
    expect(await estadoActual()).toBe('pendiente_captura');

    // Con todo capturado y confirmado, revisado.
    await db.Documento.update({ estado: 'CAPTURADO' }, { where: { estado: 'RECHAZADO' } });
    expect(await estadoActual()).toBe('revisado');
  });

  test('recalcular es idempotente y no escribe si nada cambió', async () => {
    await documento('fotos_condicion', { estado: 'RECHAZADO' });
    await recalcularEstadoAsignacion(ctx.solicitud.id);
    const primero = (await ctx.asignacion.reload()).updatedAt;
    const r = await recalcularEstadoAsignacion(ctx.solicitud.id);
    expect(r.estado).toBe('pendiente_captura');
    expect((await ctx.asignacion.reload()).updatedAt).toEqual(primero);
  });

  test('un caso sin asignaciones activas no se calcula', async () => {
    await ctx.asignacion.update({ activa: false });
    expect(await recalcularEstadoAsignacion(ctx.solicitud.id)).toBeNull();
  });

  test('se recalcula con los eventos de documentos y OCR', async () => {
    const d = await documento('fotos_condicion');
    await f.crearExtraccion({ documento: d });
    require('../index'); // las suscripciones se registran con el módulo
    eventos.emitirTrasCommit(null, eventos.EVENTOS.EXTRACCION_LISTA_PARA_REVISION, {
      solicitudId: ctx.solicitud.id,
    });
    await eventos.esperarEventos();
    expect((await ctx.asignacion.reload()).estado).toBe('en_revision');
  });

  test('al listar los casos se corrige un estado desfasado', async () => {
    await documento('fotos_condicion', { estado: 'RECHAZADO' });
    await ctx.asignacion.update({ estado: 'revisado' }); // como si se hubiera perdido un evento
    const lista = await casos(ctx.voluntario);
    expect(lista.datos[0].estadoAsignacion).toBe('pendiente_captura');
    expect((await ctx.asignacion.reload()).estado).toBe('pendiente_captura');
  });
});
