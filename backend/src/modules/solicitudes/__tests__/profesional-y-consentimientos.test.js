'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const eventos = require('../../../core/eventos');
const { conToken, familiaConSolicitud, enviar } = require('./ayudantes');

describe('PUT /solicitudes/:id/profesional-salud', () => {
  let ctx;

  beforeEach(async () => {
    await limpiarBase();
    ctx = await familiaConSolicitud();
  });

  const guardar = (datos, t = ctx.token, solicitud = ctx.solicitud) =>
    conToken(api().put(`/api/v1/solicitudes/${solicitud.id}/profesional-salud`), t).send(datos);

  test('con nombre, especialidad, teléfono y la certificación capturada queda completa', async () => {
    const certificacion = await f.crearDocumento({
      solicitud: ctx.solicitud,
      tipo: 'certificacion_medica',
    });
    const parcial = await guardar({
      nombre: 'Dra.  Ficticia  Prueba',
      telefono: '2222-0000',
    }).expect(200);
    expect(parcial.body).toMatchObject({
      nombre: 'Dra. Ficticia Prueba',
      telefono: '+50422220000',
      especialidad: null,
      estado: 'incompleta',
      obligatorio: true,
    });

    const completa = await guardar({
      especialidad: 'ortopedia_pediatrica',
      correo: 'Medica@Pruebas.test',
      documentoCertificacionId: certificacion.id,
    }).expect(200);
    expect(completa.body).toMatchObject({
      nombre: 'Dra. Ficticia Prueba',
      correo: 'medica@pruebas.test',
      documentoCertificacionId: certificacion.id,
      estado: 'completa',
    });

    const borrado = await guardar({ correo: null }).expect(200);
    expect(borrado.body).toMatchObject({ correo: null, nombre: 'Dra. Ficticia Prueba' });
    expect(await db.ProfesionalSalud.count()).toBe(1);
    expect(await db.Bitacora.count({ where: { accion: 'profesionales_salud.guardar' } })).toBe(3);
  });

  test('la certificación debe ser de esta solicitud y del tipo correcto; la especialidad, del catálogo', async () => {
    const otroTipo = await f.crearDocumento({ solicitud: ctx.solicitud, tipo: 'fotos_condicion' });
    const r1 = await guardar({ documentoCertificacionId: otroTipo.id }).expect(400);
    expect(r1.body.campos).toEqual({ documentoCertificacionId: 'NO_CORRESPONDE' });

    const ajena = await f.crearDocumento({ tipo: 'certificacion_medica' });
    const r2 = await guardar({ documentoCertificacionId: ajena.id }).expect(400);
    expect(r2.body.campos).toEqual({ documentoCertificacionId: 'NO_CORRESPONDE' });

    const r3 = await guardar({ especialidad: 'astrologia' }).expect(400);
    expect(r3.body.campos).toEqual({ especialidad: 'VALOR_NO_PERMITIDO' });
    const r4 = await guardar({}).expect(400);
    expect(r4.body.campos).toEqual({ cuerpo: 'SIN_CAMBIOS' });
    const r5 = await guardar({ telefono: '12' }).expect(400);
    expect(r5.body.campos).toEqual({ telefono: 'TELEFONO_INVALIDO' });
  });

  test('ventana de edición y acceso', async () => {
    await db.Solicitud.update({ estado: 'EN_REVISION' }, { where: { id: ctx.solicitud.id } });
    expect((await guardar({ nombre: 'X' })).body.codigo).toBe('SOLICITUD_EDICION_BLOQUEADA');
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    await guardar({ nombre: 'Corregido por el coordinador' }, coordinador).expect(200);
    const ajena = await tokenPara(await f.crearUsuario());
    await guardar({ nombre: 'X' }, ajena).expect(404);
  });
});

describe('consentimientos', () => {
  let ctx;

  beforeEach(async () => {
    await limpiarBase();
    ctx = await familiaConSolicitud();
  });

  const textos = (t = ctx.token, query = '') =>
    conToken(api().get(`/api/v1/consentimientos/textos${query}`), t);
  const abrir = (textoId, t = ctx.token, solicitudId = ctx.solicitud.id) =>
    conToken(api().post(`/api/v1/consentimientos/textos/${textoId}/abierto`), t).send({
      solicitudId,
    });
  const decidir = (tipo, cuerpo, t = ctx.token) =>
    conToken(api().put(`/api/v1/solicitudes/${ctx.solicitud.id}/consentimientos/${tipo}`), t)
      .set('X-Dispositivo', 'Telefono de prueba')
      .send(cuerpo);
  const textoDe = async (tipo, idioma = 'es') =>
    db.TextoConsentimiento.findOne({ where: { tipo, idioma }, order: [['version', 'DESC']] });

  test('textos vigentes en el idioma pedido o en el del usuario', async () => {
    const es = await textos().expect(200);
    expect(es.body.map((t) => t.tipo)).toEqual([
      'divulgacion_informacion_medica',
      'marketing',
      'telesalud',
      'condiciones_atencion',
    ]);
    expect(es.body[0]).toMatchObject({
      version: 1,
      idioma: 'es',
      obligatorio: true,
      requiereFirma: true,
    });
    const en = await textos(ctx.token, '?idioma=en').expect(200);
    expect(en.body.every((t) => t.idioma === 'en')).toBe(true);
    const ingles = await tokenPara(await f.crearUsuario({ idioma: 'en' }));
    expect((await textos(ingles).expect(200)).body[0].idioma).toBe('en');

    // Una versión nueva reemplaza a la anterior.
    const v1 = await textoDe('telesalud');
    await db.TextoConsentimiento.create({ ...v1.get(), id: undefined, version: 2 });
    const nuevos = await textos().expect(200);
    expect(nuevos.body.find((t) => t.tipo === 'telesalud').version).toBe(2);

    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    await textos(coordinador).expect(403);
  });

  test('decidir exige haber abierto ese mismo texto; se guardan IP, dispositivo y firma pendiente', async () => {
    const texto = await textoDe('divulgacion_informacion_medica');
    const sinAbrir = await decidir('divulgacion_informacion_medica', {
      decision: 'acepta',
      textoId: texto.id,
    }).expect(409);
    expect(sinAbrir.body.codigo).toBe('CONSENTIMIENTO_TEXTO_NO_ABIERTO');

    const abierto = await abrir(texto.id).expect(200);
    expect(abierto.body).toMatchObject({ tipo: 'divulgacion_informacion_medica', decision: null });

    const res = await decidir('divulgacion_informacion_medica', {
      decision: 'acepta',
      textoId: texto.id,
    }).expect(200);
    expect(res.body).toMatchObject({
      decision: 'acepta',
      textoVersion: 1,
      textoIdioma: 'es',
      estadoFirma: 'pendiente',
      firmaPendiente: true,
    });
    const fila = await db.Consentimiento.findOne();
    expect(fila).toMatchObject({ decididoPor: ctx.usuario.id, dispositivo: 'Telefono de prueba' });
    expect(fila.ip).toEqual(expect.any(String));
    expect(fila.decididoEn).toBeInstanceOf(Date);

    const otroTipo = await textoDe('marketing');
    const malo = await decidir('divulgacion_informacion_medica', {
      decision: 'acepta',
      textoId: otroTipo.id,
    }).expect(400);
    expect(malo.body.campos).toEqual({ textoId: 'NO_CORRESPONDE' });
  });

  test('un texto abierto de otra versión no sirve para decidir', async () => {
    const v1 = await textoDe('telesalud');
    await abrir(v1.id).expect(200);
    const v2 = await db.TextoConsentimiento.create({ ...v1.get(), id: undefined, version: 2 });

    const conV2 = await decidir('telesalud', { decision: 'acepta', textoId: v2.id }).expect(409);
    expect(conV2.body.codigo).toBe('CONSENTIMIENTO_TEXTO_NO_ABIERTO');
    const conV1 = await decidir('telesalud', { decision: 'acepta', textoId: v1.id }).expect(409);
    expect(conV1.body.codigo).toBe('CONSENTIMIENTO_TEXTO_NO_VIGENTE');
    expect((await abrir(v1.id).expect(409)).body.codigo).toBe('CONSENTIMIENTO_TEXTO_NO_VIGENTE');

    await abrir(v2.id).expect(200);
    await decidir('telesalud', { decision: 'acepta', textoId: v2.id }).expect(200);
  });

  test('abrir el texto en otro idioma después de decidir anula la decisión', async () => {
    const es = await textoDe('condiciones_atencion');
    await abrir(es.id).expect(200);
    await decidir('condiciones_atencion', { decision: 'acepta', textoId: es.id }).expect(200);
    await abrir(es.id).expect(200);
    expect((await db.Consentimiento.findOne()).decision).toBe('acepta');

    const en = await textoDe('condiciones_atencion', 'en');
    const res = await abrir(en.id).expect(200);
    expect(res.body.decision).toBeNull();
    expect(await db.Consentimiento.findOne()).toMatchObject({ decision: null, textoId: en.id });
  });

  test('rechazar marketing no deja firma pendiente ni bloquea el envío', async () => {
    const marketing = await textoDe('marketing');
    await abrir(marketing.id).expect(200);
    const res = await decidir('marketing', { decision: 'no_acepta', textoId: marketing.id }).expect(
      200,
    );
    expect(res.body).toMatchObject({ estadoFirma: 'no_aplica', firmaPendiente: false });

    await enviar(ctx.solicitud, ctx.token).expect(200);
    const resumen = await conToken(api().get(`/api/v1/solicitudes/${ctx.solicitud.id}`), ctx.token);
    expect(resumen.body.consentimientos.find((c) => c.tipo === 'marketing')).toMatchObject({
      decision: 'no_acepta',
      firmaPendiente: false,
    });
  });

  test('la firma queda firmada cuando la hoja firmada se valida, también en una versión nueva', async () => {
    const texto = await textoDe('divulgacion_informacion_medica');
    await abrir(texto.id).expect(200);
    const incorrecta = await f.crearDocumento({
      solicitud: ctx.solicitud,
      tipo: 'consentimiento_telesalud_firmado',
    });
    const r1 = await decidir('divulgacion_informacion_medica', {
      decision: 'acepta',
      textoId: texto.id,
      documentoFirmadoId: incorrecta.id,
    }).expect(400);
    expect(r1.body.campos).toEqual({ documentoFirmadoId: 'NO_CORRESPONDE' });

    const hoja = await f.crearDocumento({
      solicitud: ctx.solicitud,
      tipo: 'consentimiento_divulgacion_firmado',
    });
    const r2 = await decidir('divulgacion_informacion_medica', {
      decision: 'acepta',
      textoId: texto.id,
      documentoFirmadoId: hoja.id,
    }).expect(200);
    expect(r2.body).toMatchObject({ estadoFirma: 'pendiente', documentoFirmadoId: hoja.id });

    // El agente 06 valida el documento y emite documento.estado_cambiado.
    await hoja.update({ estado: 'VALIDADO' });
    eventos.emitirTrasCommit(null, eventos.EVENTOS.DOCUMENTO_ESTADO_CAMBIADO, {
      documentoId: hoja.id,
    });
    await eventos.esperarEventos();
    expect(await db.Consentimiento.findOne()).toMatchObject({ estadoFirma: 'firmado' });

    // Una versión nueva de la hoja (todavía sin validar) toma su lugar.
    await hoja.update({ vigente: false });
    const nueva = await f.crearDocumento({
      solicitud: ctx.solicitud,
      tipo: 'consentimiento_divulgacion_firmado',
      version: 2,
      reemplazaA: hoja.id,
    });
    eventos.emitirTrasCommit(null, eventos.EVENTOS.DOCUMENTO_CAPTURADO, { documentoId: nueva.id });
    await eventos.esperarEventos();
    expect(await db.Consentimiento.findOne()).toMatchObject({
      documentoFirmadoId: nueva.id,
      estadoFirma: 'pendiente',
    });
  });

  test('acceso y ventana de edición', async () => {
    const texto = await textoDe('marketing');
    const ajena = await tokenPara(await f.crearUsuario());
    await abrir(texto.id, ajena).expect(404);
    await decidir('marketing', { decision: 'acepta', textoId: texto.id }, ajena).expect(404);
    const voluntario = await tokenPara(await f.crearUsuario({ rol: 'voluntario' }));
    await abrir(texto.id, voluntario).expect(403);
    await abrir(crypto.randomUUID()).expect(404);
    const tipoMalo = await decidir('publicidad', { decision: 'acepta', textoId: texto.id });
    expect(tipoMalo.body.campos).toEqual({ 'params.tipo': 'VALOR_NO_PERMITIDO' });

    await db.Solicitud.update({ estado: 'EN_REVISION' }, { where: { id: ctx.solicitud.id } });
    expect((await abrir(texto.id)).body.codigo).toBe('SOLICITUD_EDICION_BLOQUEADA');
  });
});
