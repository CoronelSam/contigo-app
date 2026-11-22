'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const { limpiarBase } = require('../../../../test/helpers/db');
const eventos = require('../../../core/eventos');
const { api } = require('../../../../test/helpers/app');
const {
  conToken,
  imagen,
  simularOcr,
  casoDeFamilia,
  idTipo,
  crearDocumento,
  subirPagina,
  capturar,
} = require('./ayudantes');

afterEach(async () => {
  // Los handlers de eventos corren tras el commit: que terminen antes de limpiar la base.
  await eventos.esperarEventos();
  jest.restoreAllMocks();
});

describe('páginas de un documento', () => {
  let ctx;
  let documentoId;

  beforeEach(async () => {
    await limpiarBase();
    simularOcr();
    ctx = await casoDeFamilia();
    const creado = await crearDocumento(ctx.solicitud, ctx.token, {
      tipoDocumentoId: await idTipo('radiografias_informes'),
    }).expect(201);
    documentoId = creado.body.id;
  });

  const ordenActual = async () =>
    (await db.DocumentoPagina.findAll({ where: { documentoId }, order: [['orden', 'ASC']] })).map(
      (p) => p.id,
    );
  const finalizar = (paginasDeclaradas) =>
    conToken(api().post(`/api/v1/documentos/${documentoId}/finalizar`), ctx.token).send({
      paginasDeclaradas,
    });

  test('insertar en una posición, borrar y reordenar con una permutación exacta', async () => {
    const a = (await subirPagina(documentoId, ctx.token, await imagen(1)).expect(201)).body;
    const b = (await subirPagina(documentoId, ctx.token, await imagen(2)).expect(201)).body;
    const c = (await subirPagina(documentoId, ctx.token, await imagen(3), { orden: 1 }).expect(201))
      .body;
    expect(c.orden).toBe(1);
    expect(await ordenActual()).toEqual([c.id, a.id, b.id]);

    await conToken(
      api().delete(`/api/v1/documentos/${documentoId}/paginas/${a.id}`),
      ctx.token,
    ).expect(204);
    expect(await ordenActual()).toEqual([c.id, b.id]);

    const reordenado = await conToken(
      api().put(`/api/v1/documentos/${documentoId}/paginas/orden`),
      ctx.token,
    )
      .send({ paginas: [b.id, c.id] })
      .expect(200);
    expect(reordenado.body.paginas.map((p) => p.id)).toEqual([b.id, c.id]);

    const incompleta = await conToken(
      api().put(`/api/v1/documentos/${documentoId}/paginas/orden`),
      ctx.token,
    )
      .send({ paginas: [b.id] })
      .expect(400);
    expect(incompleta.body.campos).toEqual({ paginas: 'NO_ES_PERMUTACION' });
    await conToken(api().put(`/api/v1/documentos/${documentoId}/paginas/orden`), ctx.token)
      .send({ paginas: [b.id, b.id] })
      .expect(400);
    await subirPagina(documentoId, ctx.token, await imagen(4), { orden: 9 }).expect(400);
  });

  test('finalizar exige que las hojas declaradas coincidan con las subidas', async () => {
    expect((await finalizar(1).expect(409)).body.codigo).toBe('DOCUMENTO_SIN_PAGINAS');
    await subirPagina(documentoId, ctx.token, await imagen(1)).expect(201);
    expect((await finalizar(3).expect(409)).body.codigo).toBe('DOCUMENTO_PAGINAS_FALTANTES');
    await subirPagina(documentoId, ctx.token, await imagen(2)).expect(201);
    expect((await finalizar(1).expect(409)).body.codigo).toBe('DOCUMENTO_PAGINAS_SOBRANTES');
    expect((await db.Documento.findByPk(documentoId)).estado).toBe('FALTA');
    await finalizar(2).expect(200);
  });

  test('después de finalizar las páginas no cambian', async () => {
    const p = (await subirPagina(documentoId, ctx.token, await imagen(1)).expect(201)).body;
    await finalizar(1).expect(200);
    const res = await subirPagina(documentoId, ctx.token, await imagen(2)).expect(409);
    expect(res.body.codigo).toBe('DOCUMENTO_NO_EDITABLE');
    await conToken(
      api().delete(`/api/v1/documentos/${documentoId}/paginas/${p.id}`),
      ctx.token,
    ).expect(409);
    await finalizar(1).expect(409);
  });

  test('archivos inválidos, sin archivo y tipo de una sola página', async () => {
    const texto = await subirPagina(
      documentoId,
      ctx.token,
      Buffer.from('no soy una imagen'),
    ).expect(400);
    expect(texto.body.codigo).toBe('ARCHIVO_TIPO_NO_PERMITIDO');
    const sinArchivo = await conToken(
      api().post(`/api/v1/documentos/${documentoId}/paginas`),
      ctx.token,
    )
      .set('Idempotency-Key', crypto.randomUUID())
      .expect(400);
    expect(sinArchivo.body.campos).toEqual({ archivo: 'REQUERIDO' });
    expect(await db.DocumentoPagina.count()).toBe(0);

    await db.TipoDocumento.update(
      { admiteVariasPaginas: false },
      { where: { codigo: 'radiografias_informes' } },
    );
    await subirPagina(documentoId, ctx.token, await imagen(1)).expect(201);
    const segunda = await subirPagina(documentoId, ctx.token, await imagen(2)).expect(409);
    expect(segunda.body.codigo).toBe('DOCUMENTO_UNA_PAGINA');
  });

  test('otra familia no toca las páginas (404)', async () => {
    const otra = await casoDeFamilia();
    await subirPagina(documentoId, otra.token, await imagen(1)).expect(404);
  });
});

describe('POST /documentos/:id/cancelar', () => {
  beforeEach(() => limpiarBase());

  test('con el OCR en curso, lo cancela y el documento vuelve a FALTA', async () => {
    const { cancelar } = simularOcr({ conOcr: true });
    const ctx = await casoDeFamilia();
    const documento = await capturar(ctx.solicitud, ctx.token);
    const res = await conToken(
      api().post(`/api/v1/documentos/${documento.id}/cancelar`),
      ctx.token,
    ).expect(200);
    expect(res.body).toMatchObject({
      estado: 'FALTA',
      paginasDeclaradas: null,
      extraccion: { estado: 'cancelada' },
    });
    expect(cancelar).toHaveBeenCalled();
    // Puede repetir las páginas y volver a finalizar.
    await subirPagina(documento.id, ctx.token, await imagen(7)).expect(201);
  });

  test('si el OCR ya terminó hace falta una versión nueva', async () => {
    simularOcr({ conOcr: true });
    const ctx = await casoDeFamilia();
    const documento = await capturar(ctx.solicitud, ctx.token);
    await db.Extraccion.update(
      { estado: 'por_confirmar' },
      { where: { documentoId: documento.id } },
    );
    const res = await conToken(
      api().post(`/api/v1/documentos/${documento.id}/cancelar`),
      ctx.token,
    ).expect(409);
    expect(res.body.codigo).toBe('DOCUMENTO_OCR_EN_REVISION');
  });
});
