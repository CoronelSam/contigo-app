'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const contratos = require('../contratos');
const { enlaceDeToken, hashToken } = require('../tokens');
const { REGISTRO, esperarCorreos, tokenDelCorreo, correo } = require('./ayudantes');

const CONTRASENA_NUEVA = 'otra-contrasena-segura';

describe('recuperación de contraseña e invitaciones', () => {
  let usuario;

  beforeEach(async () => {
    await limpiarBase();
    correo.limpiarEnviados();
    usuario = await f.crearUsuario({ correo: 'olvido@pruebas.test', idioma: 'en' });
  });

  const olvido = (correoUsado) =>
    api().post('/api/v1/auth/password/forgot').send({ correo: correoUsado });
  const reset = (token, contrasena = CONTRASENA_NUEVA) =>
    api().post('/api/v1/auth/password/reset').send({ token, contrasena });
  const login = (contrasena) =>
    api().post('/api/v1/auth/login').send({ correo: usuario.correo, contrasena });

  test('la respuesta es idéntica exista o no la cuenta', async () => {
    const existe = await olvido(usuario.correo).expect(202);
    const noExiste = await olvido('nadie@pruebas.test').expect(202);
    expect(existe.body).toEqual(noExiste.body);
    const enviados = await esperarCorreos(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      plantilla: 'recuperar_contrasena',
      para: usuario.correo,
      idioma: 'en',
    });
    expect(enviados[0].texto).toMatch(/vanguardia:\/\/restablecer-contrasena\?token=/);
  });

  test('el enlace permite crear una contraseña nueva una sola vez y revoca las sesiones', async () => {
    const tokenSesion = await tokenPara(usuario);
    await olvido(usuario.correo).expect(202);
    const token = tokenDelCorreo((await esperarCorreos(1))[0]);

    await reset(token).expect(204);
    await login(f.CONTRASENA_PRUEBA).expect(401);
    await login(CONTRASENA_NUEVA).expect(200);
    await api().get('/api/v1/me').set('Authorization', `Bearer ${tokenSesion}`).expect(401);

    const reuso = await reset(token, 'una-tercera-contrasena').expect(400);
    expect(reuso.body.codigo).toBe('AUTH_TOKEN_INVALIDO');
  });

  test('un token vencido, inventado o de otro tipo no sirve', async () => {
    const { token } = await contratos.emitirToken({ usuarioId: usuario.id, tipo: 'recuperar' });
    await db.TokenRecuperacion.update(
      { expiraEn: new Date(Date.now() - 1000) },
      { where: { hash: hashToken(token) } },
    );
    await reset(token).expect(400);
    await reset('t'.repeat(43)).expect(400);
    const verificacion = await contratos.emitirToken({
      usuarioId: usuario.id,
      tipo: 'verificar_correo',
    });
    await reset(verificacion.token).expect(400);
  });

  test('una contraseña nueva que viola la política no consume el token', async () => {
    const { token } = await contratos.emitirToken({ usuarioId: usuario.id, tipo: 'recuperar' });
    const res = await reset(token, usuario.correo).expect(400);
    expect(res.body.campos).toEqual({ contrasena: 'IGUAL_AL_CORREO' });
    await reset(token).expect(204);
  });

  test('una invitación activa la cuenta del personal al crear su contraseña', async () => {
    const invitado = await f.crearUsuario({
      rol: 'coordinador',
      estado: 'invitado',
      hashContrasena: null,
    });
    const { token } = await contratos.emitirToken({ usuarioId: invitado.id, tipo: 'invitar' });
    expect(enlaceDeToken('invitar', token)).toBe(
      `vanguardia://aceptar-invitacion?token=${encodeURIComponent(token)}`,
    );

    await reset(token).expect(204);
    await invitado.reload();
    expect(invitado.estado).toBe('activo');
    expect(invitado.correoVerificadoEn).toBeInstanceOf(Date);
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ correo: invitado.correo, contrasena: CONTRASENA_NUEVA })
      .expect(200);
    expect(res.body.usuario.rol).toBe('coordinador');
    expect(await db.Bitacora.count({ where: { accion: 'auth.invitacion_aceptada' } })).toBe(1);
  });

  test('emitir un token nuevo invalida los anteriores del mismo tipo', async () => {
    const primero = await contratos.emitirToken({ usuarioId: usuario.id, tipo: 'recuperar' });
    const segundo = await contratos.emitirToken({ usuarioId: usuario.id, tipo: 'recuperar' });
    await reset(primero.token).expect(400);
    await reset(segundo.token).expect(204);
    const guardados = await db.TokenRecuperacion.findAll({ where: { usuarioId: usuario.id } });
    expect(guardados.map((t) => t.hash)).not.toContain(segundo.token);
  });

  test('revocarSesiones revoca todas las sesiones vigentes', async () => {
    await tokenPara(usuario);
    await tokenPara(usuario);
    expect(await contratos.revocarSesiones({ usuarioId: usuario.id })).toBe(2);
    expect(await db.Sesion.count({ where: { usuarioId: usuario.id, revocadaEn: null } })).toBe(0);
  });
});

describe('verificación del correo', () => {
  beforeEach(async () => {
    await limpiarBase();
    correo.limpiarEnviados();
  });

  test('el enlace del registro verifica el correo una sola vez', async () => {
    const sesion = (await api().post('/api/v1/auth/register').send(REGISTRO).expect(201)).body;
    const token = tokenDelCorreo((await esperarCorreos(1))[0]);

    await api().post('/api/v1/auth/correo/verificar').send({ token }).expect(204);
    const usuario = await db.Usuario.findByPk(sesion.usuario.id);
    expect(usuario.correoVerificadoEn).toBeInstanceOf(Date);
    await api().post('/api/v1/auth/correo/verificar').send({ token }).expect(400);

    const res = await api()
      .post('/api/v1/auth/correo/reenviar')
      .set('Authorization', `Bearer ${sesion.accessToken}`)
      .expect(409);
    expect(res.body.codigo).toBe('AUTH_CORREO_YA_VERIFICADO');
  });

  test('reenviar manda un enlace nuevo e invalida el anterior', async () => {
    const sesion = (await api().post('/api/v1/auth/register').send(REGISTRO).expect(201)).body;
    const primero = tokenDelCorreo((await esperarCorreos(1))[0]);
    await api()
      .post('/api/v1/auth/correo/reenviar')
      .set('Authorization', `Bearer ${sesion.accessToken}`)
      .expect(202);
    const segundo = tokenDelCorreo((await esperarCorreos(2))[1]);
    expect(segundo).not.toBe(primero);
    await api().post('/api/v1/auth/correo/verificar').send({ token: primero }).expect(400);
    await api().post('/api/v1/auth/correo/verificar').send({ token: segundo }).expect(204);
  });

  test('reenviar exige sesión', async () => {
    await api().post('/api/v1/auth/correo/reenviar').expect(401);
  });
});
