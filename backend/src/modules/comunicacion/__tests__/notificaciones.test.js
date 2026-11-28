'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const cola = require('../../../core/cola');
const { notificar } = require('../../../core/notificaciones');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

let usuario;
let token;
let otro;

beforeEach(async () => {
  await limpiarBase();
  cola.vaciar();
  usuario = await f.crearUsuario({ rol: 'familia' });
  token = await tokenPara(usuario);
  otro = await f.crearUsuario({ rol: 'familia' });
});

const con = (req, t = token) => req.set('Authorization', `Bearer ${t}`);
const bandeja = (q = '', t = token) => con(api().get(`/api/v1/notificaciones${q}`), t);
const leida = (id, t = token) => con(api().patch(`/api/v1/notificaciones/${id}/leida`), t);

/** 3 sin leer y 2 leídas del usuario, más 1 de otro usuario, en orden de creación. */
async function sembrar() {
  const base = Date.now() - 60_000;
  const creadas = [];
  for (let i = 0; i < 5; i += 1) {
    creadas.push(
      await f.crearNotificacion({
        usuario,
        titulo: `Aviso ficticio ${i}`,
        datos: { categoria: 'estados', enlace: `solicitudes/x${i}` },
        leidaEn: i < 2 ? new Date(base) : null,
        createdAt: new Date(base + i * 1000),
      }),
    );
  }
  await f.crearNotificacion({ usuario: otro });
  return creadas;
}

describe('GET /notificaciones', () => {
  test('bandeja propia con filtros, paginación y contador de no leídas', async () => {
    const creadas = await sembrar();
    const todas = await bandeja().expect(200);
    expect(todas.body.paginacion).toEqual({ page: 1, limit: 20, total: 5 });
    expect(todas.body.noLeidas).toBe(3);
    expect(todas.body.datos.map((n) => n.titulo)).toEqual(
      [4, 3, 2, 1, 0].map((i) => `Aviso ficticio ${i}`),
    );
    expect(todas.body.datos[0]).toEqual({
      id: creadas[4].id,
      tipo: 'CAMBIO_ESTADO',
      categoria: 'estados',
      titulo: 'Aviso ficticio 4',
      cuerpo: 'Cuerpo de prueba',
      enlace: 'solicitudes/x4',
      solicitudId: null,
      leidaEn: null,
      creadaEn: expect.any(String),
    });

    const noLeidas = await bandeja('?estado=no_leidas').expect(200);
    expect(noLeidas.body.datos.map((n) => n.id)).toEqual([4, 3, 2].map((i) => creadas[i].id));
    expect(noLeidas.body.noLeidas).toBe(3);
    const leidas = await bandeja('?estado=leidas').expect(200);
    expect(leidas.body.datos.map((n) => n.id)).toEqual([1, 0].map((i) => creadas[i].id));

    const pagina2 = await bandeja('?page=2&limit=2').expect(200);
    expect(pagina2.body.paginacion).toEqual({ page: 2, limit: 2, total: 5 });
    expect(pagina2.body.datos.map((n) => n.id)).toEqual([2, 1].map((i) => creadas[i].id));

    expect((await bandeja('?estado=archivadas').expect(400)).body.campos).toEqual({
      'query.estado': 'VALOR_NO_PERMITIDO',
    });
    await bandeja('?limit=101').expect(400);
  });

  test('una notificación real de core/notificaciones aparece con su enlace a la pantalla', async () => {
    const solicitud = await f.crearSolicitud({ estado: 'EN_REVISION' });
    await notificar({
      usuarioIds: [usuario.id],
      tipo: 'MENSAJE_NUEVO',
      variables: { codigo: solicitud.codigo, solicitudId: solicitud.id },
    });
    const [n] = (await bandeja().expect(200)).body.datos;
    expect(n).toMatchObject({
      tipo: 'MENSAJE_NUEVO',
      categoria: 'mensajes',
      enlace: `solicitudes/${solicitud.id}/mensajes`,
      solicitudId: solicitud.id,
    });
  });

  test('todos los roles tienen su bandeja; sin token → 401', async () => {
    for (const rol of ['voluntario', 'coordinador', 'administrador']) {
      const u = await f.crearUsuario({ rol });
      await f.crearNotificacion({ usuario: u });
      const res = await bandeja('', await tokenPara(u)).expect(200);
      expect(res.body.paginacion.total).toBe(1);
    }
    await bandeja('', 'token-invalido').expect(401);
  });
});

describe('PATCH /notificaciones/:id/leida y POST /notificaciones/leer-todas', () => {
  test('marca una propia; si ya estaba leída conserva la fecha; la de otro → 404', async () => {
    const creadas = await sembrar();
    const res = await leida(creadas[4].id).expect(200);
    expect(res.body.noLeidas).toBe(2);
    expect(res.body.notificacion.leidaEn).toEqual(expect.any(String));
    const otraVez = await leida(creadas[4].id).expect(200);
    expect(otraVez.body.notificacion.leidaEn).toBe(res.body.notificacion.leidaEn);

    const ajena = await db.Notificacion.findOne({ where: { usuarioId: otro.id } });
    expect((await leida(ajena.id).expect(404)).body.codigo).toBe('NO_ENCONTRADO');
    expect((await ajena.reload()).leidaEn).toBeNull();
    await leida(crypto.randomUUID()).expect(404);
    await leida('no-es-uuid').expect(400);
  });

  test('leer todas marca solo las propias', async () => {
    await sembrar();
    const res = await con(api().post('/api/v1/notificaciones/leer-todas')).expect(200);
    expect(res.body).toEqual({ marcadas: 3, noLeidas: 0 });
    expect((await bandeja('?estado=no_leidas').expect(200)).body.datos).toEqual([]);
    expect(await db.Notificacion.count({ where: { usuarioId: otro.id, leidaEn: null } })).toBe(1);
    expect(
      (await con(api().post('/api/v1/notificaciones/leer-todas')).expect(200)).body.marcadas,
    ).toBe(0);
  });
});
