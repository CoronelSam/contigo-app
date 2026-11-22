'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const eventos = require('../../../core/eventos');
const { conToken, simularOcr, casoDeFamilia, capturar } = require('./ayudantes');

afterEach(async () => {
  // Los handlers de eventos corren tras el commit: que terminen antes de limpiar la base.
  await eventos.esperarEventos();
  jest.restoreAllMocks();
});

describe('nueva captura y rechazo', () => {
  let ctx;
  let voluntario;
  let tv;
  let coordinador;

  beforeEach(async () => {
    await limpiarBase();
    simularOcr();
    ctx = await casoDeFamilia();
    voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud: ctx.solicitud, voluntario });
    tv = await tokenPara(voluntario);
    coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
  });

  const nuevaCaptura = (documentoId, t = tv, motivo = 'imagen_borrosa') =>
    conToken(api().post(`/api/v1/documentos/${documentoId}/correcciones`), t).send({
      motivo,
      observaciones: 'La foto salió movida (prueba)',
    });
  const notificaciones = () =>
    db.Notificacion.findAll({
      where: { usuarioId: ctx.usuario.id, tipo: 'CORRECCION_SOLICITADA' },
    });

  test('en EN_REVISION lleva el caso a INFO_ADICIONAL, rechaza el documento y avisa a la familia', async () => {
    const documento = await capturar(ctx.solicitud, ctx.token);
    await db.Solicitud.update({ estado: 'EN_REVISION' }, { where: { id: ctx.solicitud.id } });

    const res = await nuevaCaptura(documento.id).expect(201);
    expect(res.body).toMatchObject({
      solicitud: { estado: 'INFO_ADICIONAL' },
      documento: { estado: 'RECHAZADO', motivoRechazo: 'imagen_borrosa' },
      correccion: { tipo: 'documento', motivo: 'imagen_borrosa', estado: 'abierta' },
    });
    expect(await notificaciones()).toHaveLength(1);
    const historial = await db.HistorialEstado.findAll({
      where: { solicitudId: ctx.solicitud.id },
    });
    expect(historial.map((h) => h.estadoNuevo)).toEqual(['INFO_ADICIONAL']);
    expect(await db.HistorialEstado.count({ where: { estadoNuevo: 'DENEGADA' } })).toBe(0);

    // La familia corrige: versión nueva, la corrección se resuelve al finalizar.
    const v2 = await capturar(ctx.solicitud, ctx.token);
    expect(v2.version).toBe(2);
    const [correccion] = await db.SolicitudCorreccion.findAll();
    expect(correccion).toMatchObject({ estado: 'resuelta', resueltaConDocumentoId: v2.id });
  });

  test('en CAPTURA el caso no cambia de estado, pero la familia recibe el aviso', async () => {
    const documento = await capturar(ctx.solicitud, ctx.token);
    const res = await nuevaCaptura(documento.id).expect(201);
    expect(res.body.solicitud.estado).toBe('CAPTURA');
    expect((await ctx.solicitud.reload()).estado).toBe('CAPTURA');
    expect(await notificaciones()).toHaveLength(1);
    expect(await db.HistorialEstado.count()).toBe(0);
  });

  test('el coordinador rechaza también un validado; el voluntario no', async () => {
    const documento = await capturar(ctx.solicitud, ctx.token);
    await conToken(api().post(`/api/v1/documentos/${documento.id}/validar`), coordinador).expect(
      200,
    );
    const vol = await nuevaCaptura(documento.id).expect(409);
    expect(vol.body.codigo).toBe('DOCUMENTO_ESTADO_INVALIDO');
    await conToken(api().post(`/api/v1/documentos/${documento.id}/rechazar`), tv)
      .send({ motivo: 'no_cumple_requisito' })
      .expect(403);
    const res = await conToken(
      api().post(`/api/v1/documentos/${documento.id}/rechazar`),
      coordinador,
    )
      .send({ motivo: 'no_cumple_requisito' })
      .expect(201);
    expect(res.body.documento).toMatchObject({ estado: 'RECHAZADO', validadoEn: null });
    // Ya está rechazado: no se pide otra corrección sobre el mismo.
    await nuevaCaptura(documento.id, coordinador).expect(409);
  });

  test('cancelar un documento capturado reabre la corrección que había resuelto', async () => {
    const documento = await capturar(ctx.solicitud, ctx.token);
    await nuevaCaptura(documento.id).expect(201);
    const v2 = await capturar(ctx.solicitud, ctx.token);
    await conToken(api().post(`/api/v1/documentos/${v2.id}/cancelar`), ctx.token).expect(200);
    expect(await db.SolicitudCorreccion.findOne()).toMatchObject({
      estado: 'abierta',
      resueltaConDocumentoId: null,
    });
  });

  test('sin asignación, en un estado sin correcciones o con un motivo de otro tipo → error', async () => {
    const documento = await capturar(ctx.solicitud, ctx.token);
    const otro = await tokenPara(await f.crearUsuario({ rol: 'voluntario' }));
    await nuevaCaptura(documento.id, otro).expect(404);
    await nuevaCaptura(documento.id, ctx.token).expect(403);
    const motivo = await nuevaCaptura(documento.id, tv, 'dato_incorrecto').expect(400);
    expect(motivo.body.campos).toEqual({ motivo: 'VALOR_NO_PERMITIDO' });

    await db.Solicitud.update({ estado: 'EN_EVALUACION' }, { where: { id: ctx.solicitud.id } });
    const coord = await conToken(
      api().post(`/api/v1/documentos/${documento.id}/rechazar`),
      coordinador,
    )
      .send({ motivo: 'imagen_borrosa' })
      .expect(409);
    expect(coord.body.codigo).toBe('CORRECCION_NO_PERMITIDA');
  });
});

describe('correcciones de sección', () => {
  let ctx;
  let coordinador;

  beforeEach(async () => {
    await limpiarBase();
    ctx = await casoDeFamilia({ estado: 'EN_REVISION' });
    coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
  });

  const corregir = (cuerpo, t = coordinador) =>
    conToken(api().post(`/api/v1/solicitudes/${ctx.solicitud.id}/correcciones`), t).send(cuerpo);
  const guardarSeccion = (seccion, datos) =>
    conToken(
      api().put(`/api/v1/solicitudes/${ctx.solicitud.id}/secciones/${seccion}`),
      ctx.token,
    ).send({
      datos,
    });

  test('abre la sección para la familia y se resuelve cuando la familia la guarda', async () => {
    await guardarSeccion('educacion', { gradoEscolar: 'basica_1' }).expect(409);

    const res = await corregir({
      seccion: 'educacion',
      motivo: 'dato_incompleto',
      observaciones: 'Falta la asistencia (prueba)',
    }).expect(201);
    expect(res.body).toMatchObject({
      solicitud: { estado: 'INFO_ADICIONAL' },
      correccion: { tipo: 'seccion', seccion: 'educacion', estado: 'abierta' },
      documento: null,
    });
    expect((await corregir({ seccion: 'educacion', motivo: 'otro' }).expect(409)).body.codigo).toBe(
      'CORRECCION_YA_ABIERTA',
    );

    await guardarSeccion('informacion_medica', { diagnostico: 'x' }).expect(409);
    await guardarSeccion('educacion', {
      gradoEscolar: 'basica_1',
      asisteEscuela: 'si',
      educacionEspecial: 'no',
    }).expect(200);
    await eventos.esperarEventos();
    const correccion = await db.SolicitudCorreccion.findOne();
    expect(correccion.estado).toBe('resuelta');
    expect(correccion.resueltaEn).toBeInstanceOf(Date);

    const lista = await conToken(
      api().get(`/api/v1/solicitudes/${ctx.solicitud.id}/correcciones?estado=resuelta`),
      ctx.token,
    ).expect(200);
    expect(lista.body).toEqual([
      expect.objectContaining({ seccion: 'educacion', estado: 'resuelta' }),
    ]);
  });

  test('si la guarda el personal, la corrección sigue abierta', async () => {
    await corregir({ seccion: 'educacion', motivo: 'dato_incorrecto' }).expect(201);
    await conToken(
      api().put(`/api/v1/solicitudes/${ctx.solicitud.id}/secciones/educacion`),
      coordinador,
    )
      .send({ datos: { gradoEscolar: 'basica_2' } })
      .expect(200);
    await eventos.esperarEventos();
    expect((await db.SolicitudCorreccion.findOne()).estado).toBe('abierta');
  });

  test('solo el coordinador; secciones con formulario', async () => {
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud: ctx.solicitud, voluntario });
    await corregir({ seccion: 'educacion', motivo: 'otro' }, await tokenPara(voluntario)).expect(
      403,
    );
    await corregir({ seccion: 'educacion', motivo: 'otro' }, ctx.token).expect(403);
    const invalida = await corregir({ seccion: 'consentimientos', motivo: 'otro' }).expect(400);
    expect(invalida.body.campos).toEqual({ seccion: 'VALOR_NO_PERMITIDO' });
    const ajena = await tokenPara(await f.crearUsuario());
    await conToken(api().get(`/api/v1/solicitudes/${ctx.solicitud.id}/correcciones`), ajena).expect(
      404,
    );
  });
});

describe('GET /archivos/:id/url', () => {
  let ctx;
  let coordinador;

  beforeEach(async () => {
    await limpiarBase();
    simularOcr();
    ctx = await casoDeFamilia({ estado: 'EN_REVISION' });
    coordinador = await f.crearUsuario({ rol: 'coordinador' });
  });

  const url = async (archivoId, usuario, estado) =>
    conToken(api().get(`/api/v1/archivos/${archivoId}/url`), await tokenPara(usuario)).expect(
      estado,
    );

  test('página de un documento: familia y coordinador sí; otra familia 404; se registra el acceso', async () => {
    const documento = await f.crearDocumento({ solicitud: ctx.solicitud });
    const pagina = await db.DocumentoPagina.findOne({ where: { documentoId: documento.id } });

    const res = await url(pagina.archivoId, ctx.usuario, 200);
    expect(res.body.url).toEqual(expect.any(String));
    expect(new Date(res.body.expiraEn).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    expect(res.headers['cache-control']).toBe('no-store');
    await url(pagina.archivoId, coordinador, 200);
    await url(pagina.archivoId, await f.crearUsuario(), 404);
    await url(pagina.archivoId, await f.crearUsuario({ rol: 'voluntario' }), 404);

    const accesos = await db.RegistroAcceso.findAll({ order: [['createdAt', 'ASC']] });
    expect(accesos.map((a) => [a.usuarioId, a.recurso, a.recursoId, a.solicitudId])).toEqual([
      [ctx.usuario.id, 'documento', pagina.archivoId, ctx.solicitud.id],
      [coordinador.id, 'documento', pagina.archivoId, ctx.solicitud.id],
    ]);
  });

  test('paquete PDF: solo el coordinador', async () => {
    const paquete = await f.crearPaquetePdf({ solicitud: ctx.solicitud });
    await url(paquete.archivoId, ctx.usuario, 404);
    const res = await url(paquete.archivoId, coordinador, 200);
    expect(res.body.url).toEqual(expect.any(String));
    expect((await db.RegistroAcceso.findOne()).recurso).toBe('paquete');
  });

  test('foto del niño: familia, coordinador y voluntario asignado a un caso del niño', async () => {
    const foto = await f.crearArchivo();
    await ctx.paciente.update({ fotoArchivoId: foto.id });
    await url(foto.id, ctx.usuario, 200);
    await url(foto.id, coordinador, 200);
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await url(foto.id, voluntario, 404);
    await f.crearAsignacion({ solicitud: ctx.solicitud, voluntario });
    await url(foto.id, voluntario, 200);
    await url(foto.id, await f.crearUsuario(), 404);
  });

  test('adjunto del chat: familia y coordinador; el voluntario no participa', async () => {
    const archivo = await f.crearArchivo();
    await f.crearMensaje({ solicitud: ctx.solicitud, autor: ctx.usuario, archivoId: archivo.id });
    await url(archivo.id, ctx.usuario, 200);
    await url(archivo.id, coordinador, 200);
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud: ctx.solicitud, voluntario });
    await url(archivo.id, voluntario, 404);
  });

  test('PDF de plantilla: administrador y personal; archivos sin dueño o inexistentes → 404', async () => {
    const plantilla = await f.crearPlantilla();
    await url(plantilla.archivoPdfId, await f.crearUsuario({ rol: 'administrador' }), 200);
    await url(plantilla.archivoPdfId, coordinador, 200);
    await url(plantilla.archivoPdfId, ctx.usuario, 404);

    const huerfano = await f.crearArchivo();
    await url(huerfano.id, coordinador, 404);
    await url(crypto.randomUUID(), coordinador, 404);
    await api().get(`/api/v1/archivos/${huerfano.id}/url`).expect(401);
  });

  test('una página subida por la API se abre con la URL firmada', async () => {
    const familia = await casoDeFamilia();
    const documento = await capturar(familia.solicitud, familia.token);
    const res = await url(documento.paginas[0].archivoId, familia.usuario, 200);
    const archivo = await db.Archivo.findByPk(documento.paginas[0].archivoId);
    expect(archivo).toMatchObject({ mime: 'image/png', subidoPor: familia.usuario.id });
    expect(res.body.url).toEqual(expect.any(String));
  });
});
