'use strict';

const express = require('express');
const request = require('supertest');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { crearLimitador } = require('../limites');
const { manejadorErrores } = require('../../../core/errores/manejador');

describe('perfil, preferencias y dispositivos', () => {
  let usuario;
  let token;

  beforeEach(async () => {
    await limpiarBase();
    usuario = await f.crearUsuario({ correo: 'perfil@pruebas.test', telefono: '+50411112222' });
    token = await tokenPara(usuario);
  });

  const conToken = (r, t = token) => r.set('Authorization', `Bearer ${t}`);

  test('todo /me exige sesión', async () => {
    await api().get('/api/v1/me').expect(401);
    await api().patch('/api/v1/me').send({ nombres: 'X' }).expect(401);
    await api().patch('/api/v1/me/password').send({}).expect(401);
    await api().get('/api/v1/me/preferencias').expect(401);
    await api().put('/api/v1/me/preferencias').send({}).expect(401);
    await api().post('/api/v1/me/dispositivos').send({}).expect(401);
  });

  test('GET /me devuelve el perfil con rol y permisos, sin hashes', async () => {
    const res = await conToken(api().get('/api/v1/me')).expect(200);
    expect(res.body).toEqual({
      id: usuario.id,
      correo: 'perfil@pruebas.test',
      nombres: usuario.nombres,
      apellidos: 'Prueba',
      telefono: '+50411112222',
      idioma: 'es',
      rol: 'familia',
      permisos: expect.arrayContaining(['perfil.gestionar']),
      correoVerificado: false,
      terminosVersion: null,
      creadoEn: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|hash/i);
  });

  test('PATCH /me cambia los datos propios y queda en la bitácora; el correo no se cambia', async () => {
    const res = await conToken(api().patch('/api/v1/me'))
      .send({ nombres: 'Nombre Nuevo', telefono: '9876 5432', idioma: 'en' })
      .expect(200);
    expect(res.body).toMatchObject({
      nombres: 'Nombre Nuevo',
      telefono: '+50498765432',
      idioma: 'en',
    });
    const [b] = await db.Bitacora.findAll({ where: { accion: 'usuarios.actualizar_perfil' } });
    expect(b.despues).toEqual({ nombres: 'Nombre Nuevo', telefono: '+50498765432', idioma: 'en' });
    expect(b.usuarioId).toBe(usuario.id);

    const correoNuevo = await conToken(api().patch('/api/v1/me'))
      .send({ correo: 'otro@pruebas.test' })
      .expect(400);
    expect(correoNuevo.body.campos).toEqual({ correo: 'CAMPO_NO_PERMITIDO' });
    const vacio = await conToken(api().patch('/api/v1/me')).send({}).expect(400);
    expect(vacio.body.campos).toEqual({ cuerpo: 'SIN_CAMBIOS' });
  });

  test('PATCH /me/password exige la actual y revoca las otras sesiones, no la actual', async () => {
    const otroToken = await tokenPara(usuario);
    const mala = await conToken(api().patch('/api/v1/me/password'))
      .send({ actual: 'no-es-la-actual', nueva: 'contrasena-nueva-123' })
      .expect(400);
    expect(mala.body.codigo).toBe('AUTH_CONTRASENA_ACTUAL_INCORRECTA');

    const igual = await conToken(api().patch('/api/v1/me/password'))
      .send({ actual: f.CONTRASENA_PRUEBA, nueva: 'perfil@pruebas.test' })
      .expect(400);
    expect(igual.body.campos).toEqual({ nueva: 'IGUAL_AL_CORREO' });

    await conToken(api().patch('/api/v1/me/password'))
      .send({ actual: f.CONTRASENA_PRUEBA, nueva: 'contrasena-nueva-123' })
      .expect(204);
    await conToken(api().get('/api/v1/me')).expect(200);
    await conToken(api().get('/api/v1/me'), otroToken).expect(401);
    await api()
      .post('/api/v1/auth/login')
      .send({ correo: usuario.correo, contrasena: 'contrasena-nueva-123' })
      .expect(200);
  });

  test('preferencias: todo activo por defecto y PUT conserva lo que no se envía', async () => {
    const porDefecto = await conToken(api().get('/api/v1/me/preferencias')).expect(200);
    expect(porDefecto.body).toEqual({
      push: { mensajes: true, correcciones: true, estados: true, documentos: true, citas: true },
    });
    await conToken(api().put('/api/v1/me/preferencias'))
      .send({ push: { mensajes: false } })
      .expect(200);
    const res = await conToken(api().put('/api/v1/me/preferencias'))
      .send({ push: { citas: false } })
      .expect(200);
    expect(res.body.push).toEqual({
      mensajes: false,
      correcciones: true,
      estados: true,
      documentos: true,
      citas: false,
    });
    const invalida = await conToken(api().put('/api/v1/me/preferencias'))
      .send({ push: { otra: true } })
      .expect(400);
    expect(invalida.body.campos).toEqual({ 'push.otra': 'CAMPO_NO_PERMITIDO' });
  });

  test('un dispositivo se registra una vez y pasa a la última cuenta que lo usa', async () => {
    const datos = { tokenFcm: 'token-fcm-compartido-1', plataforma: 'ios' };
    await conToken(api().post('/api/v1/me/dispositivos')).send(datos).expect(200);
    await conToken(api().post('/api/v1/me/dispositivos')).send(datos).expect(200);
    expect(await db.Dispositivo.count()).toBe(1);

    const otro = await f.crearUsuario();
    await conToken(api().post('/api/v1/me/dispositivos'), await tokenPara(otro))
      .send({ ...datos, plataforma: 'android' })
      .expect(200);
    const [dispositivo] = await db.Dispositivo.findAll();
    expect([dispositivo.usuarioId, dispositivo.plataforma]).toEqual([otro.id, 'android']);

    await conToken(api().post('/api/v1/me/dispositivos'))
      .send({ tokenFcm: 'corto', plataforma: 'blackberry' })
      .expect(400);
  });

  test('el administrador también gestiona su perfil', async () => {
    const admin = await f.crearUsuario({ rol: 'administrador' });
    await conToken(api().get('/api/v1/me'), await tokenPara(admin)).expect(200);
  });
});

describe('límites de intentos', () => {
  test('al superar el máximo responde 429 DEMASIADOS_INTENTOS con cabeceras estándar', async () => {
    const app = express();
    app.post('/limitado', crearLimitador({ ventanaMs: 60_000, maximo: 2 }), (req, res) =>
      res.json({ ok: true }),
    );
    app.use(manejadorErrores);
    await request(app).post('/limitado').expect(200);
    await request(app).post('/limitado').expect(200);
    const res = await request(app).post('/limitado').expect(429);
    expect(res.body.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(res.headers.ratelimit).toBeDefined();
  });
});
