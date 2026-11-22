'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const eventos = require('../../../core/eventos');
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

describe('recorrido del anexo B', () => {
  let ctx;
  let coordinador;

  beforeEach(async () => {
    await limpiarBase();
    ctx = await casoDeFamilia();
    coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
  });

  test('FALTA → páginas → CAPTURADO → OCR confirmado → VALIDADO', async () => {
    const { encolar } = simularOcr({ conOcr: true });
    const capturados = [];
    const cambios = [];
    const quitar = [
      eventos.suscribir(eventos.EVENTOS.DOCUMENTO_CAPTURADO, (d) => capturados.push(d)),
      eventos.suscribir(eventos.EVENTOS.DOCUMENTO_ESTADO_CAMBIADO, (d) => cambios.push(d)),
    ];

    try {
      const lista = await conToken(
        api().get(`/api/v1/solicitudes/${ctx.solicitud.id}/documentos`),
        ctx.token,
      ).expect(200);
      expect(lista.body.rutas).toEqual(['EVALUACION']);
      expect(lista.body.requisitos.map((r) => [r.tipoDocumento.codigo, r.estado])).toEqual([
        ['fotos_condicion', 'FALTA'],
        ['radiografias_informes', 'FALTA'],
        ['certificacion_medica', 'FALTA'],
      ]);
      expect(lista.body.requisitos[0].tipoDocumento.comoFotografiar).toMatch(/luz/);

      const creado = await crearDocumento(ctx.solicitud, ctx.token, {
        tipoDocumentoId: await idTipo('fotos_condicion'),
      }).expect(201);
      expect(creado.body).toMatchObject({
        estado: 'FALTA',
        version: 1,
        vigente: true,
        origen: 'app',
        tipoDocumento: { codigo: 'fotos_condicion', nombre: 'Fotos de la condición' },
        paciente: { nombreCompleto: expect.any(String), fotoArchivoId: null },
      });

      const id = creado.body.id;
      await subirPagina(id, ctx.token, await imagen(1)).expect(201);
      await subirPagina(id, ctx.token, await imagen(2)).expect(201);
      const capturado = await conToken(api().post(`/api/v1/documentos/${id}/finalizar`), ctx.token)
        .send({ paginasDeclaradas: 2 })
        .expect(200);
      expect(capturado.body).toMatchObject({
        estado: 'CAPTURADO',
        paginasDeclaradas: 2,
        extraccion: { estado: 'en_cola' },
      });
      expect(capturado.body.paginas.map((p) => p.orden)).toEqual([1, 2]);
      expect(encolar).toHaveBeenCalledWith(expect.objectContaining({ documentoId: id }));

      // Capturar no es validar: con el OCR sin revisar, el coordinador no puede validar.
      const sinRevisar = await conToken(
        api().post(`/api/v1/documentos/${id}/validar`),
        coordinador,
      ).expect(409);
      expect(sinRevisar.body.codigo).toBe('DOCUMENTO_OCR_SIN_REVISAR');

      await db.Extraccion.update(
        { estado: 'confirmada', progreso: 100 },
        { where: { documentoId: id } },
      );
      const validado = await conToken(
        api().post(`/api/v1/documentos/${id}/validar`),
        coordinador,
      ).expect(200);
      expect(validado.body).toMatchObject({ estado: 'VALIDADO', validadoEn: expect.any(String) });
      await eventos.esperarEventos();
    } finally {
      quitar.forEach((q) => q());
    }

    expect(capturados).toEqual([
      expect.objectContaining({ solicitudId: ctx.solicitud.id, version: 1, origen: 'app' }),
    ]);
    expect(cambios).toEqual([expect.objectContaining({ de: 'CAPTURADO', a: 'VALIDADO' })]);
    const lista = await conToken(
      api().get(`/api/v1/solicitudes/${ctx.solicitud.id}/documentos`),
      ctx.token,
    );
    expect(lista.body.requisitos[0]).toMatchObject({ estado: 'VALIDADO', cumplido: true });
    expect(lista.body.requisitos[0].documento.paginas).toHaveLength(2);
    const acciones = await db.Bitacora.findAll({ where: { entidad: 'documentos' } });
    expect(acciones.map((b) => b.accion).sort()).toEqual([
      'documentos.agregar_pagina',
      'documentos.agregar_pagina',
      'documentos.crear',
      'documentos.finalizar',
      'documentos.validar',
    ]);
  });

  test('sin plantilla de OCR, el coordinador valida apenas se captura', async () => {
    simularOcr();
    const documento = await capturar(ctx.solicitud, ctx.token);
    expect(documento.extraccion).toBeNull();
    await conToken(api().post(`/api/v1/documentos/${documento.id}/validar`), coordinador).expect(
      200,
    );
    const familia = await conToken(
      api().post(`/api/v1/documentos/${documento.id}/validar`),
      ctx.token,
    );
    expect(familia.status).toBe(403);
  });
});

describe('POST /solicitudes/:id/documentos', () => {
  let ctx;

  beforeEach(async () => {
    await limpiarBase();
    simularOcr();
    ctx = await casoDeFamilia();
  });

  test('reintentos: el mismo id del teléfono o la misma Idempotency-Key no duplican nada', async () => {
    const id = crypto.randomUUID();
    const tipoDocumentoId = await idTipo('radiografias_informes');
    const primero = await crearDocumento(ctx.solicitud, ctx.token, { id, tipoDocumentoId }).expect(
      201,
    );
    expect(primero.body.id).toBe(id);
    const otraVez = await crearDocumento(ctx.solicitud, ctx.token, { id, tipoDocumentoId }).expect(
      200,
    );
    expect(otraVez.body.id).toBe(id);

    const clave = crypto.randomUUID();
    const pagina = await subirPagina(id, ctx.token, await imagen(5), { clave }).expect(201);
    const repetida = await subirPagina(id, ctx.token, await imagen(5), { clave }).expect(201);
    expect(repetida.headers['idempotency-replayed']).toBe('true');
    expect(repetida.body).toEqual(pagina.body);
    const mismaImagen = await subirPagina(id, ctx.token, await imagen(5)).expect(200);
    expect(mismaImagen.body.id).toBe(pagina.body.id);

    expect(await db.Documento.count()).toBe(1);
    expect(await db.DocumentoPagina.count()).toBe(1);

    // El id del teléfono no sirve para tomar el documento de otra cuenta.
    const otra = await casoDeFamilia();
    const robo = await crearDocumento(otra.solicitud, otra.token, { id, tipoDocumentoId }).expect(
      409,
    );
    expect(robo.body.codigo).toBe('DOCUMENTO_ID_EN_USO');
  });

  test('el vigente en FALTA se reutiliza; un tipo fuera de los requisitos activos → 409', async () => {
    const tipoDocumentoId = await idTipo('fotos_condicion');
    const a = await crearDocumento(ctx.solicitud, ctx.token, { tipoDocumentoId }).expect(201);
    const b = await crearDocumento(ctx.solicitud, ctx.token, { tipoDocumentoId }).expect(200);
    expect(b.body.id).toBe(a.body.id);

    const mexico = await crearDocumento(ctx.solicitud, ctx.token, {
      tipoDocumentoId: await idTipo('seguros'),
    }).expect(409);
    expect(mexico.body.codigo).toBe('DOCUMENTO_NO_REQUERIDO');
    const inexistente = await crearDocumento(ctx.solicitud, ctx.token, {
      tipoDocumentoId: crypto.randomUUID(),
    }).expect(400);
    expect(inexistente.body.campos).toEqual({ tipoDocumentoId: 'NO_EXISTE' });
    await conToken(api().post(`/api/v1/solicitudes/${ctx.solicitud.id}/documentos`), ctx.token)
      .send({ tipoDocumentoId })
      .expect(428);
  });

  test('con el paquete fijado se piden los del paquete, sin mezclar México e internacional', async () => {
    const paquete = await casoDeFamilia({ estado: 'PAQUETE_EXTERIOR', rutaDecidida: 'MEXICO' });
    await crearDocumento(paquete.solicitud, paquete.token, {
      tipoDocumentoId: await idTipo('seguros'),
    }).expect(201);
    const internacional = await crearDocumento(paquete.solicitud, paquete.token, {
      tipoDocumentoId: await idTipo('consentimiento_telesalud_firmado'),
    }).expect(409);
    expect(internacional.body.codigo).toBe('DOCUMENTO_NO_REQUERIDO');
  });

  test('versión nueva al reemplazar un rechazado; la anterior sigue consultable', async () => {
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    const v1 = await capturar(ctx.solicitud, ctx.token);
    await conToken(api().post(`/api/v1/documentos/${v1.id}/rechazar`), coordinador)
      .send({ motivo: 'imagen_borrosa' })
      .expect(201);

    const v2 = await crearDocumento(ctx.solicitud, ctx.token, {
      tipoDocumentoId: v1.tipoDocumento.id,
    }).expect(201);
    expect(v2.body).toMatchObject({ version: 2, reemplazaA: v1.id, estado: 'FALTA' });
    const anterior = await conToken(api().get(`/api/v1/documentos/${v1.id}`), coordinador).expect(
      200,
    );
    expect(anterior.body).toMatchObject({
      vigente: false,
      estado: 'RECHAZADO',
      motivoRechazo: 'imagen_borrosa',
    });
    const detalle = await conToken(api().get(`/api/v1/documentos/${v2.body.id}`), ctx.token);
    expect(detalle.body.versionAnterior).toMatchObject({ id: v1.id, version: 1 });
    expect(await db.Bitacora.count({ where: { accion: 'documentos.nueva_version' } })).toBe(1);
  });

  test('un documento validado solo lo reemplaza el coordinador', async () => {
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    const v1 = await capturar(ctx.solicitud, ctx.token);
    await conToken(api().post(`/api/v1/documentos/${v1.id}/validar`), coordinador).expect(200);
    const familia = await crearDocumento(ctx.solicitud, ctx.token, {
      tipoDocumentoId: v1.tipoDocumento.id,
    }).expect(409);
    expect(familia.body.codigo).toBe('DOCUMENTO_VALIDADO');
    const nuevo = await crearDocumento(ctx.solicitud, coordinador, {
      tipoDocumentoId: v1.tipoDocumento.id,
    }).expect(201);
    expect(nuevo.body.version).toBe(2);
  });

  test('captura en jornada: voluntario asignado sí, sin asignación 404, familia no', async () => {
    const tipoDocumentoId = await idTipo('radiografias_informes');
    const familia = await crearDocumento(ctx.solicitud, ctx.token, {
      tipoDocumentoId,
      origen: 'jornada',
    }).expect(400);
    expect(familia.body.campos).toEqual({ origen: 'VALOR_NO_PERMITIDO' });

    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    const tv = await tokenPara(voluntario);
    await crearDocumento(ctx.solicitud, tv, { tipoDocumentoId, origen: 'jornada' }).expect(404);
    await f.crearAsignacion({ solicitud: ctx.solicitud, voluntario });
    const res = await crearDocumento(ctx.solicitud, tv, {
      tipoDocumentoId,
      origen: 'jornada',
    }).expect(201);
    expect(res.body).toMatchObject({
      origen: 'jornada',
      paciente: { nombreCompleto: expect.any(String) },
    });
    expect((await db.Documento.findByPk(res.body.id)).capturadoPor).toBe(voluntario.id);
  });

  test('ventana de edición y acceso', async () => {
    const tipoDocumentoId = await idTipo('fotos_condicion');
    await db.Solicitud.update({ estado: 'EN_REVISION' }, { where: { id: ctx.solicitud.id } });
    const bloqueada = await crearDocumento(ctx.solicitud, ctx.token, { tipoDocumentoId }).expect(
      409,
    );
    expect(bloqueada.body.codigo).toBe('SOLICITUD_EDICION_BLOQUEADA');
    const ajena = await tokenPara(await f.crearUsuario());
    await crearDocumento(ctx.solicitud, ajena, { tipoDocumentoId }).expect(404);
    const admin = await tokenPara(await f.crearUsuario({ rol: 'administrador' }));
    await crearDocumento(ctx.solicitud, admin, { tipoDocumentoId }).expect(403);
    await api().post(`/api/v1/solicitudes/${ctx.solicitud.id}/documentos`).expect(401);
  });
});

describe('GET /tipos-documento/:id', () => {
  beforeEach(() => limpiarBase());

  test('ayuda en el idioma del usuario', async () => {
    const id = await idTipo('certificacion_medica');
    const es = await conToken(
      api().get(`/api/v1/tipos-documento/${id}`),
      await tokenPara(await f.crearUsuario()),
    ).expect(200);
    expect(es.body).toMatchObject({
      codigo: 'certificacion_medica',
      nombre: 'Certificación del profesional de salud',
      admiteVariasPaginas: true,
    });
    expect(es.body.paraQueSirve).toMatch(/La familia no la llena/);
    const en = await conToken(
      api().get(`/api/v1/tipos-documento/${id}`),
      await tokenPara(await f.crearUsuario({ idioma: 'en' })),
    ).expect(200);
    expect(en.body.nombre).toBe('Health professional certification');
    await conToken(
      api().get(`/api/v1/tipos-documento/${crypto.randomUUID()}`),
      await tokenPara(await f.crearUsuario()),
    ).expect(404);
  });
});

describe('integración con la firma de los consentimientos (agente 05)', () => {
  beforeEach(async () => {
    await limpiarBase();
    simularOcr();
  });

  test('validar la hoja firmada deja el consentimiento firmado', async () => {
    const ctx = await casoDeFamilia({ estado: 'PAQUETE_EXTERIOR', rutaDecidida: 'INTERNACIONAL' });
    const hoja = await capturar(ctx.solicitud, ctx.token, 'consentimiento_divulgacion_firmado');
    const texto = await db.TextoConsentimiento.findOne({
      where: { tipo: 'divulgacion_informacion_medica', idioma: 'es' },
    });
    await conToken(api().post(`/api/v1/consentimientos/textos/${texto.id}/abierto`), ctx.token)
      .send({ solicitudId: ctx.solicitud.id })
      .expect(200);
    await conToken(
      api().put(
        `/api/v1/solicitudes/${ctx.solicitud.id}/consentimientos/divulgacion_informacion_medica`,
      ),
      ctx.token,
    )
      .send({ decision: 'acepta', textoId: texto.id, documentoFirmadoId: hoja.id })
      .expect(200);
    expect((await db.Consentimiento.findOne()).estadoFirma).toBe('pendiente');

    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    await conToken(api().post(`/api/v1/documentos/${hoja.id}/validar`), coordinador).expect(200);
    await eventos.esperarEventos();
    expect((await db.Consentimiento.findOne()).estadoFirma).toBe('firmado');
  });
});
