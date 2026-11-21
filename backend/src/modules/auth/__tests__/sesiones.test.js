'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');

describe('refresh rotativo y cierre de sesión', () => {
  let usuario;
  let sesion;

  beforeEach(async () => {
    await limpiarBase();
    usuario = await f.crearUsuario({ correo: 'familia.sesion@pruebas.test' });
    sesion = (
      await api()
        .post('/api/v1/auth/login')
        .send({
          correo: usuario.correo,
          contrasena: f.CONTRASENA_PRUEBA,
          dispositivo: 'Teléfono de prueba',
        })
        .expect(200)
    ).body;
  });

  const refrescar = (refreshToken) => api().post('/api/v1/auth/refresh').send({ refreshToken });
  const me = (token) => api().get('/api/v1/me').set('Authorization', `Bearer ${token}`);

  test('rota: el refresh entrega tokens nuevos y la sesión anterior queda reemplazada', async () => {
    const nueva = (await refrescar(sesion.refreshToken).expect(200)).body;
    expect(nueva.refreshToken).not.toBe(sesion.refreshToken);
    expect(nueva.usuario.id).toBe(usuario.id);
    await me(nueva.accessToken).expect(200);
    await me(sesion.accessToken).expect(401);

    const sesiones = await db.Sesion.findAll({
      where: { usuarioId: usuario.id },
      order: [['createdAt', 'ASC']],
    });
    expect(sesiones).toHaveLength(2);
    expect(sesiones[0].reemplazadaPor).toBe(sesiones[1].id);
    expect(sesiones[1].cadenaId).toBe(sesiones[0].cadenaId);
    expect(sesiones[1].dispositivo).toBe('Teléfono de prueba');
  });

  test('reutilizar un refresh ya rotado revoca toda la cadena', async () => {
    const nueva = (await refrescar(sesion.refreshToken).expect(200)).body;
    const reuso = await refrescar(sesion.refreshToken).expect(401);
    expect(reuso.body.codigo).toBe('AUTH_REFRESH_INVALIDO');
    await refrescar(nueva.refreshToken).expect(401);
    await me(nueva.accessToken).expect(401);
    expect(await db.Bitacora.count({ where: { accion: 'auth.reuso_refresh' } })).toBe(1);
  });

  test('un refresh vencido, desconocido o de un usuario inactivo responde 401', async () => {
    await refrescar('x'.repeat(43)).expect(401);
    await db.Sesion.update(
      { expiraEn: new Date(Date.now() - 1000) },
      { where: { usuarioId: usuario.id } },
    );
    await refrescar(sesion.refreshToken).expect(401);

    const otra = (
      await api()
        .post('/api/v1/auth/login')
        .send({ correo: usuario.correo, contrasena: f.CONTRASENA_PRUEBA })
        .expect(200)
    ).body;
    await usuario.update({ estado: 'inactivo' });
    await refrescar(otra.refreshToken).expect(401);
  });

  test('logout revoca la sesión y borra el dispositivo enviado', async () => {
    const tokenFcm = 'token-fcm-de-prueba-123';
    await api()
      .post('/api/v1/me/dispositivos')
      .set('Authorization', `Bearer ${sesion.accessToken}`)
      .send({ tokenFcm, plataforma: 'android' })
      .expect(200);

    await api()
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${sesion.accessToken}`)
      .send({ refreshToken: sesion.refreshToken, tokenFcm })
      .expect(204);

    await me(sesion.accessToken).expect(401);
    await refrescar(sesion.refreshToken).expect(401);
    expect(await db.Dispositivo.count({ where: { tokenFcm } })).toBe(0);
  });

  test('logout exige sesión', async () => {
    await api().post('/api/v1/auth/logout').send({}).expect(401);
  });
});
