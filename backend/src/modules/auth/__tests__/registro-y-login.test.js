'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { REGISTRO, esperarCorreos, correo } = require('./ayudantes');

describe('POST /auth/register', () => {
  beforeEach(async () => {
    await limpiarBase();
    correo.limpiarEnviados();
  });

  test('crea una cuenta de familia, inicia sesión y envía la verificación del correo', async () => {
    const res = await api().post('/api/v1/auth/register').send(REGISTRO).expect(201);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiraEn: expect.any(String),
      usuario: expect.objectContaining({
        rol: 'familia',
        nombres: 'Familia',
        idioma: 'es',
        correoVerificado: false,
        permisos: expect.arrayContaining(['solicitud.crear', 'perfil.gestionar']),
      }),
    });

    const usuario = await db.Usuario.findOne({ where: { correo: 'nueva.familia@pruebas.test' } });
    expect(usuario).toMatchObject({
      telefono: '+50499990000',
      terminosVersion: '2026-11',
      estado: 'activo',
    });
    expect(usuario.terminosAceptadosEn).toBeInstanceOf(Date);
    expect(usuario.hashContrasena).toMatch(/^\$argon2id\$/);

    const [enviado] = await esperarCorreos(1);
    expect(enviado).toMatchObject({
      plantilla: 'verificar_correo',
      para: 'nueva.familia@pruebas.test',
    });
    expect(enviado.texto).toMatch(/vanguardia:\/\/verificar-correo\?token=/);
    expect(enviado.texto).not.toContain('nueva.familia@pruebas.test');

    const tokens = await db.TokenRecuperacion.findAll({ where: { usuarioId: usuario.id } });
    expect(tokens).toHaveLength(1);
    expect(enviado.texto).not.toContain(tokens[0].hash);
    expect(
      await db.Bitacora.count({ where: { accion: 'auth.registro', entidadId: usuario.id } }),
    ).toBe(1);

    await api()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
  });

  test('nunca crea personal: un campo extra como "rol" es un error', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ ...REGISTRO, rol: 'administrador' })
      .expect(400);
    expect(res.body.campos).toEqual({ rol: 'CAMPO_NO_PERMITIDO' });
    expect(await db.Usuario.count()).toBe(0);
  });

  test('un correo ya registrado (sin importar mayúsculas) responde 409', async () => {
    await f.crearUsuario({ correo: 'nueva.familia@pruebas.test' });
    const res = await api().post('/api/v1/auth/register').send(REGISTRO).expect(409);
    expect(res.body.codigo).toBe('AUTH_CORREO_EN_USO');
  });

  test.each([
    [{ telefono: '12345' }, { telefono: 'TELEFONO_INVALIDO' }],
    [{ telefono: '+1 305 555 0100' }, { telefono: 'TELEFONO_INVALIDO' }],
    [{ contrasena: 'corta' }, { contrasena: 'MUY_CORTO' }],
    [{ correo: 'no-es-correo' }, { correo: 'FORMATO_INVALIDO' }],
    [{ aceptaTerminos: false }, { aceptaTerminos: 'VALOR_NO_PERMITIDO' }],
    [{ idioma: 'fr' }, { idioma: 'VALOR_NO_PERMITIDO' }],
  ])('valida %j', async (cambio, campos) => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ ...REGISTRO, ...cambio })
      .expect(400);
    expect(res.body.campos).toEqual(campos);
  });

  test('la contraseña no puede ser el correo', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ ...REGISTRO, contrasena: 'nueva.familia@pruebas.test' })
      .expect(400);
    expect(res.body.campos).toEqual({ contrasena: 'IGUAL_AL_CORREO' });
  });

  test.each([
    ['+504 9999-0000', '+50499990000'],
    ['50499990000', '+50499990000'],
    ['(9999) 0000', '+50499990000'],
  ])('normaliza el teléfono %s', async (telefono, esperado) => {
    await api()
      .post('/api/v1/auth/register')
      .send({ ...REGISTRO, telefono })
      .expect(201);
    expect((await db.Usuario.findOne()).telefono).toBe(esperado);
  });
});

describe('POST /auth/login', () => {
  let usuario;

  beforeEach(async () => {
    await limpiarBase();
    usuario = await f.crearUsuario({ correo: 'coordinacion@pruebas.test', rol: 'coordinador' });
  });

  const login = (correoUsado, contrasena = f.CONTRASENA_PRUEBA) =>
    api().post('/api/v1/auth/login').send({ correo: correoUsado, contrasena });

  test('devuelve la sesión con el rol para abrir el módulo correcto', async () => {
    const res = await login('Coordinacion@Pruebas.test').expect(200);
    expect(res.body.usuario).toMatchObject({ id: usuario.id, rol: 'coordinador' });
    expect(res.body.usuario.permisos).toContain('coordinador.tablero');
    await usuario.reload();
    expect(usuario.ultimoAccesoEn).toBeInstanceOf(Date);
    const sesion = await db.Sesion.findOne({ where: { usuarioId: usuario.id } });
    expect(sesion.hashRefresh).not.toBe(res.body.refreshToken);
  });

  test('contraseña incorrecta, correo inexistente, cuenta inactiva o invitada responden igual', async () => {
    const inactivo = await f.crearUsuario({ estado: 'inactivo' });
    const invitado = await f.crearUsuario({ estado: 'invitado', hashContrasena: null });
    const respuestas = [
      await login(usuario.correo, 'contrasena-equivocada'),
      await login('nadie@pruebas.test'),
      await login(inactivo.correo),
      await login(invitado.correo),
    ];
    for (const r of respuestas) {
      expect([r.status, r.body]).toEqual([
        401,
        { codigo: 'AUTH_CREDENCIALES_INVALIDAS', mensaje: 'Correo o contraseña incorrectos' },
      ]);
    }
  });

  test('5 intentos fallidos seguidos bloquean 15 minutos, aun con la contraseña correcta', async () => {
    for (let i = 1; i <= 4; i += 1) await login(usuario.correo, 'mala-contrasena').expect(401);
    const quinto = await login(usuario.correo, 'mala-contrasena').expect(429);
    expect(quinto.body.codigo).toBe('AUTH_CUENTA_BLOQUEADA');
    await login(usuario.correo).expect(429);
    await usuario.reload();
    const minutos = (usuario.bloqueadoHasta - Date.now()) / 60000;
    expect(minutos).toBeGreaterThan(14);
    expect(await db.Bitacora.count({ where: { accion: 'auth.bloqueo' } })).toBe(1);

    await usuario.update({ bloqueadoHasta: new Date(Date.now() - 1000) });
    await login(usuario.correo).expect(200);
    await usuario.reload();
    expect([usuario.intentosFallidos, usuario.bloqueadoHasta]).toEqual([0, null]);
  });

  test('un login correcto reinicia el contador de intentos', async () => {
    await login(usuario.correo, 'mala-contrasena').expect(401);
    await login(usuario.correo, 'mala-contrasena').expect(401);
    await login(usuario.correo).expect(200);
    await usuario.reload();
    expect(usuario.intentosFallidos).toBe(0);
  });

  test('si la configuración exige correo verificado, responde 403 hasta verificarlo', async () => {
    await db.Configuracion.update(
      { valor: true },
      { where: { clave: 'auth.exigir_correo_verificado' } },
    );
    const res = await login(usuario.correo).expect(403);
    expect(res.body.codigo).toBe('AUTH_CORREO_NO_VERIFICADO');
    await usuario.update({ correoVerificadoEn: new Date() });
    await login(usuario.correo).expect(200);
  });

  test('valida la entrada', async () => {
    const res = await api().post('/api/v1/auth/login').send({ correo: 'x' }).expect(400);
    expect(res.body.campos).toEqual({ correo: 'FORMATO_INVALIDO', contrasena: 'REQUERIDO' });
  });
});
