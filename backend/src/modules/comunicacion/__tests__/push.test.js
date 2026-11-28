'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const cola = require('../../../core/cola');
const { notificar } = require('../../../core/notificaciones');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const enviarPush = require('../jobs/push');
const { simulado } = require('../push');

let usuario;

/** Logger falso que guarda lo que se registró. */
function loggerDePrueba() {
  const lineas = [];
  const guardar = (nivel) => (obj, msg) => lineas.push({ nivel, obj, msg });
  return { lineas, info: guardar('info'), warn: guardar('warn'), error: guardar('error') };
}

beforeEach(async () => {
  await limpiarBase();
  cola.vaciar();
  simulado.reiniciar();
  usuario = await f.crearUsuario({ rol: 'familia' });
});

const dispositivo = (tokenFcm, u = usuario) =>
  db.Dispositivo.create({ usuarioId: u.id, tokenFcm, plataforma: 'android' });

async function notificacion(tipo = 'MENSAJE_NUEVO', u = usuario) {
  const [n] = await notificar({
    usuarioIds: [u.id],
    tipo,
    variables: { codigo: 'HN-0001', solicitudId: null, nombre: 'Niña' },
  });
  return n;
}

describe('trabajo notificacion.push', () => {
  test('envía título, cuerpo y data (tipo, enlace, id) a todos los dispositivos y marca enviada', async () => {
    await dispositivo('token-ficticio-android-1');
    await dispositivo('token-ficticio-ios-2');
    const n = await notificacion();
    expect(cola.pendientes()).toEqual([
      expect.objectContaining({ nombre: 'notificacion.push', datos: { notificacionId: n.id } }),
    ]);
    await cola.procesarPendientes();

    expect(simulado.enviados).toHaveLength(2);
    expect(simulado.enviados[0]).toEqual({
      token: 'token-ficticio-android-1',
      titulo: n.titulo,
      cuerpo: n.cuerpo,
      datos: { tipo: 'MENSAJE_NUEVO', enlace: 'notificaciones', notificacionId: n.id },
    });
    expect((await n.reload()).enviadaPushEn).toBeInstanceOf(Date);
  });

  test('un reintento no reenvía', async () => {
    await dispositivo('token-ficticio-1');
    const n = await notificacion();
    const logger = loggerDePrueba();
    await enviarPush({ notificacionId: n.id }, { logger });
    await enviarPush({ notificacionId: n.id }, { logger });
    expect(simulado.enviados).toHaveLength(1);
  });

  test('respeta la preferencia apagada de la categoría', async () => {
    await dispositivo('token-ficticio-1');
    await db.Preferencia.create({
      usuarioId: usuario.id,
      notificaciones: { push: { mensajes: false } },
    });
    const mensaje = await notificacion('MENSAJE_NUEVO');
    const estado = await notificacion('CAMBIO_ESTADO');
    await cola.procesarPendientes();
    expect(simulado.enviados.map((e) => e.datos.notificacionId)).toEqual([estado.id]);
    expect((await mensaje.reload()).enviadaPushEn).toBeNull();
    // La notificación sigue en la bandeja aunque no salga por push.
    const bandeja = await api()
      .get('/api/v1/notificaciones')
      .set('Authorization', `Bearer ${await tokenPara(usuario)}`)
      .expect(200);
    expect(bandeja.body.paginacion.total).toBe(2);
  });

  test('borra el dispositivo con token inválido y envía a los demás', async () => {
    await dispositivo('invalido-token-ficticio');
    await dispositivo('token-ficticio-bueno');
    const n = await notificacion();
    await cola.procesarPendientes();
    expect(simulado.enviados.map((e) => e.token)).toEqual(['token-ficticio-bueno']);
    expect((await db.Dispositivo.findAll()).map((d) => d.tokenFcm)).toEqual([
      'token-ficticio-bueno',
    ]);
    expect((await n.reload()).enviadaPushEn).toBeInstanceOf(Date);
  });

  test('si todos los tokens son inválidos: se borran y no queda como enviada', async () => {
    await dispositivo('invalido-1');
    const n = await notificacion();
    await cola.procesarPendientes();
    expect(await db.Dispositivo.count()).toBe(0);
    expect((await n.reload()).enviadaPushEn).toBeNull();
  });

  test('error temporal sin ningún envío: falla para que la cola reintente y conserva el dispositivo', async () => {
    await dispositivo('caido-token-ficticio');
    const n = await notificacion();
    await expect(
      enviarPush({ notificacionId: n.id }, { logger: loggerDePrueba() }),
    ).rejects.toMatchObject({ codigo: 'PUSH_NO_ENVIADO' });
    expect(await db.Dispositivo.count()).toBe(1);
    expect((await n.reload()).enviadaPushEn).toBeNull();
  });

  test('sin dispositivos, usuario inactivo o notificación inexistente: no envía', async () => {
    const sinDispositivos = await notificacion();
    const logger = loggerDePrueba();
    await enviarPush({ notificacionId: sinDispositivos.id }, { logger });

    const inactivo = await f.crearUsuario({ rol: 'familia' });
    await dispositivo('token-ficticio-inactivo', inactivo);
    const deInactivo = await notificacion('CAMBIO_ESTADO', inactivo);
    await inactivo.update({ estado: 'inactivo' });
    await enviarPush({ notificacionId: deInactivo.id }, { logger });

    await enviarPush({ notificacionId: crypto.randomUUID() }, { logger });
    expect(simulado.enviados).toHaveLength(0);
  });

  test('el push y el log no llevan el cuerpo del mensaje del chat', async () => {
    const coord = await f.crearUsuario({ rol: 'coordinador' });
    const familia = await f.crearFamilia();
    const solicitud = await f.crearSolicitud({ paciente: familia.paciente, estado: 'EN_REVISION' });
    await dispositivo('token-ficticio-familia', familia.usuario);
    await api()
      .post(`/api/v1/solicitudes/${solicitud.id}/mensajes`)
      .set('Authorization', `Bearer ${await tokenPara(coord)}`)
      .send({ cuerpo: 'Resultado ficticio confidencial' })
      .expect(201);
    const [trabajo] = cola.pendientes().filter((t) => t.nombre === 'notificacion.push');
    const logger = loggerDePrueba();
    await enviarPush(trabajo.datos, { logger });

    expect(simulado.enviados).toHaveLength(1);
    const enviado = JSON.stringify(simulado.enviados[0]);
    expect(enviado).not.toContain('confidencial');
    expect(simulado.enviados[0].datos.enlace).toBe(`solicitudes/${solicitud.id}/mensajes`);
    const log = JSON.stringify(logger.lineas);
    expect(log).not.toContain('confidencial');
    expect(log).not.toContain(simulado.enviados[0].cuerpo);
    expect(logger.lineas[0].obj).toMatchObject({
      enviados: 1,
      invalidos: 0,
      categoria: 'mensajes',
    });
  });
});
