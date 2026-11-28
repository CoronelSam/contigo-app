'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const correo = require('../../../core/correo');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

let admin;
let tokenAdmin;

beforeEach(async () => {
  await limpiarBase();
  correo.limpiarEnviados();
  admin = await f.crearUsuario({ rol: 'administrador', nombres: 'Admin', apellidos: 'Principal' });
  tokenAdmin = await tokenPara(admin);
});

const con = (req, token = tokenAdmin) => req.set('Authorization', `Bearer ${token}`);
const invitar = (cuerpo, token) => con(api().post('/api/v1/admin/usuarios'), token).send(cuerpo);
const cambiar = (id, cuerpo, token) =>
  con(api().patch(`/api/v1/admin/usuarios/${id}`), token).send(cuerpo);
const listar = (q = '', token) => con(api().get(`/api/v1/admin/usuarios${q}`), token);

const INVITACION = {
  correo: '  Nueva.Coordinadora@Pruebas.TEST ',
  nombres: 'Coordinadora',
  apellidos: 'Ficticia',
  telefono: '9999 0000',
  rol: 'coordinador',
  idioma: 'en',
};

/** Token del enlace del último correo de invitación. */
function tokenDelCorreo() {
  const enviado = correo.enviados.at(-1);
  const [, token] = enviado.texto.match(/aceptar-invitacion\?token=([^\s&]+)/) ?? [];
  return decodeURIComponent(token);
}

const sinCredenciales = (cuerpo) => {
  const texto = JSON.stringify(cuerpo);
  for (const prohibido of ['hash', 'contrasena', 'password', 'token', 'argon2']) {
    expect(texto.toLowerCase()).not.toContain(prohibido);
  }
};

describe('POST /admin/usuarios (invitación)', () => {
  test('invitación completa: correo con enlace → crear contraseña → iniciar sesión', async () => {
    const res = await invitar(INVITACION).expect(201);
    expect(res.body).toMatchObject({
      correo: 'nueva.coordinadora@pruebas.test',
      telefono: '+50499990000',
      rol: 'coordinador',
      estado: 'invitado',
      idioma: 'en',
      correoVerificado: false,
      invitacion: { expiraEn: expect.any(String), correoEnviado: true },
    });
    sinCredenciales(res.body);
    const usuario = await db.Usuario.findByPk(res.body.id);
    expect(usuario.hashContrasena).toBeNull();

    expect(correo.enviados).toHaveLength(1);
    expect(correo.enviados[0]).toMatchObject({
      plantilla: 'invitacion',
      para: 'nueva.coordinadora@pruebas.test',
      idioma: 'en',
    });
    expect(correo.enviados[0].texto).toContain('Coordinator');
    const token = tokenDelCorreo();
    expect(token.length).toBeGreaterThan(20);

    // Antes de aceptar no puede entrar.
    const contrasena = 'una-contrasena-ficticia-larga';
    await api()
      .post('/api/v1/auth/login')
      .send({ correo: 'nueva.coordinadora@pruebas.test', contrasena })
      .expect(401);
    await api().post('/api/v1/auth/password/reset').send({ token, contrasena }).expect(204);
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ correo: 'nueva.coordinadora@pruebas.test', contrasena })
      .expect(200);
    expect(login.body.usuario.rol).toBe('coordinador');
    expect((await usuario.reload()).estado).toBe('activo');

    const entrada = await db.Bitacora.findOne({ where: { accion: 'usuarios.invitar' } });
    expect(entrada).toMatchObject({ usuarioId: admin.id, entidadId: usuario.id });
    expect(entrada.despues).toEqual({ rol: 'coordinador', estado: 'invitado' });
  });

  test('validación: rol familia, correo inválido o campos de más → 400; correo repetido → 409', async () => {
    const familia = await invitar({ ...INVITACION, rol: 'familia' }).expect(400);
    expect(familia.body.campos).toEqual({ rol: 'VALOR_NO_PERMITIDO' });
    const mal = await invitar({ ...INVITACION, correo: 'no-es-correo', estado: 'activo' }).expect(
      400,
    );
    expect(mal.body.campos).toEqual({ correo: 'FORMATO_INVALIDO', estado: 'CAMPO_NO_PERMITIDO' });
    expect((await invitar({ ...INVITACION, telefono: '123' }).expect(400)).body.campos).toEqual({
      telefono: 'TELEFONO_INVALIDO',
    });

    await invitar(INVITACION).expect(201);
    const repetido = await invitar({ ...INVITACION, correo: 'NUEVA.coordinadora@pruebas.test' });
    expect(repetido.status).toBe(409);
    expect(repetido.body.codigo).toBe('USUARIO_CORREO_EXISTE');
    expect(await db.Usuario.count({ where: { estado: 'invitado' } })).toBe(1);
  });

  test('si el correo falla, la invitación queda y se puede reenviar', async () => {
    jest.spyOn(correo, 'enviarCorreo').mockRejectedValueOnce(new Error('SMTP caído (prueba)'));
    const res = await invitar(INVITACION).expect(201);
    expect(res.body.invitacion.correoEnviado).toBe(false);
    expect(res.body.estado).toBe('invitado');
    jest.restoreAllMocks();
    const otra = await cambiar(res.body.id, { reenviarInvitacion: true }).expect(200);
    expect(otra.body.invitacion.correoEnviado).toBe(true);
    expect(correo.enviados).toHaveLength(1);
  });
});

describe('GET /admin/usuarios', () => {
  test('busca por nombre o correo y filtra por rol y estado, con paginación', async () => {
    await f.crearUsuario({ rol: 'voluntario', nombres: 'Lucía', apellidos: 'Ficticia' });
    await f.crearUsuario({ rol: 'voluntario', correo: 'otra.voluntaria@pruebas.test' });
    await f.crearUsuario({ rol: 'coordinador', estado: 'inactivo', nombres: 'Mario' });
    await f.crearUsuario({ rol: 'familia', nombres: 'Lucía', apellidos: 'Familiar' });

    const todos = await listar().expect(200);
    expect(todos.body.paginacion).toEqual({ page: 1, limit: 20, total: 5 });
    sinCredenciales(todos.body);

    const lucia = await listar('?q=lucía fict').expect(200);
    expect(lucia.body.datos.map((u) => u.nombres)).toEqual(['Lucía']);
    expect(lucia.body.datos[0].rol).toBe('voluntario');
    const porCorreo = await listar('?q=OTRA.VOLUNTARIA').expect(200);
    expect(porCorreo.body.paginacion.total).toBe(1);
    expect((await listar('?q=%25').expect(200)).body.paginacion.total).toBe(0);

    expect((await listar('?rol=voluntario').expect(200)).body.paginacion.total).toBe(2);
    const inactivos = await listar('?estado=inactivo').expect(200);
    expect(inactivos.body.datos.map((u) => u.nombres)).toEqual(['Mario']);
    expect((await listar('?rol=familia&q=lucía').expect(200)).body.datos[0].apellidos).toBe(
      'Familiar',
    );

    const pagina = await listar('?limit=2&page=3').expect(200);
    expect(pagina.body.datos).toHaveLength(1);
    expect((await listar('?rol=jefe').expect(400)).body.campos).toEqual({
      'query.rol': 'VALOR_NO_PERMITIDO',
    });
  });
});

describe('PATCH /admin/usuarios/:id', () => {
  test('cambio de rol: sin motivo → 400; con motivo queda en la bitácora', async () => {
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    const sinMotivo = await cambiar(voluntario.id, { rol: 'coordinador' }).expect(400);
    expect(sinMotivo.body.campos).toEqual({ motivo: 'REQUERIDO' });

    const res = await cambiar(voluntario.id, {
      rol: 'coordinador',
      motivo: 'Asume la coordinación de una jornada ficticia',
    }).expect(200);
    expect(res.body.rol).toBe('coordinador');

    const entrada = await db.Bitacora.findOne({ where: { accion: 'usuarios.cambiar_rol' } });
    expect(entrada.usuarioId).toBe(admin.id);
    expect(entrada.antes).toEqual({ rol: 'voluntario', motivo: null });
    expect(entrada.despues).toEqual({
      rol: 'coordinador',
      motivo: 'Asume la coordinación de una jornada ficticia',
    });

    // El rol nuevo aplica de inmediato en la siguiente petición.
    const token = await tokenPara(voluntario);
    await con(api().get('/api/v1/coordinador/resumen'), token).expect(200);

    // Mismo rol sin motivo: no es un cambio.
    await cambiar(voluntario.id, { rol: 'coordinador' }).expect(200);
    expect(await db.Bitacora.count({ where: { accion: 'usuarios.cambiar_rol' } })).toBe(1);
  });

  test('familia ↔ personal → 409', async () => {
    const familia = await f.crearUsuario({ rol: 'familia' });
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    const motivo = 'Motivo ficticio';
    for (const [u, rol] of [
      [familia, 'voluntario'],
      [voluntario, 'familia'],
    ]) {
      const res = await cambiar(u.id, { rol, motivo }).expect(409);
      expect(res.body.codigo).toBe('USUARIO_ROL_NO_PERMITIDO');
    }
  });

  test('desactivar revoca las sesiones: la siguiente petición da 401; reactivar', async () => {
    const coordinador = await f.crearUsuario({ rol: 'coordinador' });
    const token = await tokenPara(coordinador);
    await con(api().get('/api/v1/me'), token).expect(200);

    const res = await cambiar(coordinador.id, {
      estado: 'inactivo',
      motivo: 'Terminó su voluntariado (ficticio)',
    }).expect(200);
    expect(res.body).toMatchObject({ estado: 'inactivo', sesionesRevocadas: 1 });
    expect((await con(api().get('/api/v1/me'), token).expect(401)).body.codigo).toBe(
      'SESION_INVALIDA',
    );
    expect(await db.Sesion.count({ where: { usuarioId: coordinador.id, revocadaEn: null } })).toBe(
      0,
    );
    const entrada = await db.Bitacora.findOne({ where: { accion: 'usuarios.desactivar' } });
    expect(entrada.despues).toEqual({
      estado: 'inactivo',
      motivo: 'Terminó su voluntariado (ficticio)',
    });
    expect(await db.Usuario.count({ where: { id: coordinador.id } })).toBe(1);

    const otraVez = await cambiar(coordinador.id, { estado: 'activo' }).expect(200);
    expect(otraVez.body.estado).toBe('activo');
    expect(otraVez.body.sesionesRevocadas).toBeUndefined();
  });

  test('autodesactivación o quitarse el rol → 409; último administrador → 409', async () => {
    const solo = await cambiar(admin.id, { estado: 'inactivo' }).expect(409);
    expect(solo.body.codigo).toBe('USUARIO_ULTIMO_ADMINISTRADOR');

    const otro = await f.crearUsuario({ rol: 'administrador' });
    for (const cuerpo of [{ estado: 'inactivo' }, { rol: 'coordinador', motivo: 'Prueba' }]) {
      const res = await cambiar(admin.id, cuerpo).expect(409);
      expect(res.body.codigo).toBe('USUARIO_PROPIA_CUENTA');
    }
    // Sus datos sí los puede cambiar.
    await cambiar(admin.id, { nombres: 'Admin Renombrado' }).expect(200);

    // Con dos administradores, uno puede quitarle el rol al otro; después ya no queda nadie más.
    await cambiar(otro.id, { rol: 'coordinador', motivo: 'Reorganización ficticia' }).expect(200);
    await con(api().get('/api/v1/admin/roles'), await tokenPara(otro)).expect(403);
    expect((await cambiar(admin.id, { estado: 'inactivo' }).expect(409)).body.codigo).toBe(
      'USUARIO_ULTIMO_ADMINISTRADOR',
    );
    // Un administrador invitado no cuenta como activo.
    await f.crearUsuario({ rol: 'administrador', estado: 'invitado', hashContrasena: null });
    expect((await cambiar(admin.id, { estado: 'inactivo' }).expect(409)).body.codigo).toBe(
      'USUARIO_ULTIMO_ADMINISTRADOR',
    );
  });

  test('dos administradores que se quitan el rol a la vez no dejan el sistema sin ninguno', async () => {
    const otro = await f.crearUsuario({ rol: 'administrador' });
    const tokenOtro = await tokenPara(otro);
    const motivo = 'Prueba de concurrencia ficticia';
    const [a, b] = await Promise.all([
      cambiar(otro.id, { rol: 'coordinador', motivo }),
      cambiar(admin.id, { rol: 'coordinador', motivo }, tokenOtro),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const activos = await db.Usuario.count({
      where: { estado: 'activo' },
      include: [{ association: 'rol', where: { codigo: 'administrador' } }],
    });
    expect(activos).toBe(1);
  });

  test('reenviar invitación: token nuevo e invalida el anterior; solo a cuentas sin contraseña', async () => {
    const { body } = await invitar(INVITACION).expect(201);
    const primero = tokenDelCorreo();
    const res = await cambiar(body.id, { reenviarInvitacion: true }).expect(200);
    expect(res.body.invitacion.correoEnviado).toBe(true);
    sinCredenciales(res.body);
    const segundo = tokenDelCorreo();
    expect(segundo).not.toBe(primero);

    const contrasena = 'una-contrasena-ficticia-larga';
    await api()
      .post('/api/v1/auth/password/reset')
      .send({ token: primero, contrasena })
      .expect(400);
    await api()
      .post('/api/v1/auth/password/reset')
      .send({ token: segundo, contrasena })
      .expect(204);

    const activa = await cambiar(body.id, { reenviarInvitacion: true }).expect(409);
    expect(activa.body.codigo).toBe('USUARIO_NO_INVITADO');
    const combinado = await cambiar(body.id, { reenviarInvitacion: true, estado: 'activo' });
    expect(combinado.status).toBe(400);
    expect(combinado.body.campos).toEqual({ estado: 'NO_COMBINABLE' });
  });

  test('una invitación desactivada no se activa sin contraseña: se reenvía y vuelve a invitado', async () => {
    const { body } = await invitar(INVITACION).expect(201);
    await cambiar(body.id, { estado: 'inactivo' }).expect(200);
    const token = tokenDelCorreo();
    await api()
      .post('/api/v1/auth/password/reset')
      .send({ token, contrasena: 'una-contrasena-ficticia-larga' })
      .expect(400);

    const activar = await cambiar(body.id, { estado: 'activo' }).expect(409);
    expect(activar.body.codigo).toBe('USUARIO_INVITACION_PENDIENTE');
    const reabierta = await cambiar(body.id, { reenviarInvitacion: true }).expect(200);
    expect(reabierta.body.estado).toBe('invitado');
    await api()
      .post('/api/v1/auth/password/reset')
      .send({ token: tokenDelCorreo(), contrasena: 'una-contrasena-ficticia-larga' })
      .expect(204);
  });

  test('datos de contacto con bitácora; validaciones y 404', async () => {
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    const res = await cambiar(voluntario.id, { apellidos: 'Cambiado', telefono: null }).expect(200);
    expect(res.body).toMatchObject({ apellidos: 'Cambiado', telefono: null });
    const entrada = await db.Bitacora.findOne({ where: { accion: 'usuarios.actualizar' } });
    expect(entrada.despues).toEqual({ apellidos: 'Cambiado', telefono: null });

    expect((await cambiar(voluntario.id, {}).expect(400)).body.campos).toEqual({
      cuerpo: 'SIN_CAMBIOS',
    });
    expect(
      (await cambiar(voluntario.id, { motivo: 'Solo motivo' }).expect(400)).body.campos,
    ).toEqual({ cuerpo: 'SIN_CAMBIOS' });
    expect(
      (await cambiar(voluntario.id, { correo: 'x@pruebas.test', estado: 'invitado' }).expect(400))
        .body.campos,
    ).toEqual({ correo: 'CAMPO_NO_PERMITIDO', estado: 'VALOR_NO_PERMITIDO' });
    await cambiar(crypto.randomUUID(), { nombres: 'Nadie' }).expect(404);
    await cambiar('no-es-uuid', { nombres: 'Nadie' }).expect(400);
  });
});

describe('GET /admin/roles', () => {
  test('los 4 roles con sus permisos y cuántas cuentas tiene cada uno', async () => {
    await f.crearUsuario({ rol: 'voluntario' });
    await f.crearUsuario({ rol: 'voluntario', estado: 'inactivo' });
    const res = await con(api().get('/api/v1/admin/roles')).expect(200);
    expect(res.body.map((r) => r.codigo)).toEqual([
      'familia',
      'voluntario',
      'coordinador',
      'administrador',
    ]);
    const voluntario = res.body[1];
    expect(voluntario.usuarios).toEqual({ invitado: 0, activo: 1, inactivo: 1 });
    expect(voluntario.permisos.map((p) => p.codigo)).toContain('ocr.revisar');
    const administrador = res.body[3];
    expect(administrador.permisos.map((p) => p.codigo)).toEqual(
      expect.arrayContaining(['admin.usuarios', 'admin.catalogos', 'admin.configuracion']),
    );
    expect(administrador.permisos.map((p) => p.codigo)).not.toContain('solicitud.leer');
  });
});
