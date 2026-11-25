'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { hoyIso } = require('../paquetes.util');
const { con } = require('./ayudantes');

let coord;
let tc;

beforeEach(async () => {
  await limpiarBase();
  coord = await f.crearUsuario({ rol: 'coordinador' });
  tc = await tokenPara(coord);
});

const ayer = () => {
  const d = new Date(`${hoyIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const manana = () => {
  const d = new Date(`${hoyIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const enviar = (solicitud, cuerpo) =>
  con(api().post(`/api/v1/solicitudes/${solicitud.id}/envios`), tc).send(cuerpo);
const responder = (solicitud, cuerpo) =>
  con(api().post(`/api/v1/solicitudes/${solicitud.id}/respuestas`), tc).send(cuerpo);
const cuerpoEnvio = (paquete, extra = {}) => ({
  paqueteId: paquete.id,
  destino: 'INTERNACIONAL',
  fecha: hoyIso(),
  metodo: 'mensajeria',
  guia: 'GUIA-FICTICIA-001',
  ...extra,
});

/** Avisos a la familia del caso, en orden. */
async function avisosFamilia(solicitud) {
  const ids = (
    await db.PacienteTutor.findAll({
      where: { pacienteId: solicitud.pacienteId },
      include: [{ association: 'tutor' }],
    })
  ).map((v) => v.tutor.usuarioId);
  return db.Notificacion.findAll({ where: { usuarioId: ids }, order: [['createdAt', 'ASC']] });
}

describe('POST /solicitudes/:id/envios', () => {
  test('con el paquete final revisado: ENVIADA, envío guardado y aviso sin promesas', async () => {
    const { solicitud, paquete } = await f.crearPaqueteCompleto({ coordinador: coord });
    const res = await enviar(solicitud, cuerpoEnvio(paquete)).expect(201);
    expect(res.body).toEqual({
      solicitud: {
        id: solicitud.id,
        codigo: solicitud.codigo,
        estado: 'ENVIADA',
        etapa: 'paquete',
      },
      envio: {
        id: expect.any(String),
        solicitudId: solicitud.id,
        paqueteId: paquete.id,
        destino: 'INTERNACIONAL',
        fecha: hoyIso(),
        metodo: 'mensajeria',
        guia: 'GUIA-FICTICIA-001',
        observaciones: null,
        registradoPor: { id: coord.id, nombre: expect.any(String) },
        creadoEn: expect.any(String),
      },
    });
    expect(await db.Envio.count({ where: { solicitudId: solicitud.id } })).toBe(1);
    expect(
      await db.HistorialEstado.count({
        where: { solicitudId: solicitud.id, estadoAnterior: 'COMPLETA', estadoNuevo: 'ENVIADA' },
      }),
    ).toBe(1);
    expect(await db.Bitacora.count({ where: { accion: 'envio.registrar' } })).toBe(1);
    const [aviso] = await avisosFamilia(solicitud);
    expect(aviso.tipo).toBe('CAMBIO_ESTADO');
    expect(aviso.cuerpo).toContain('Shriners revisará el caso y tomará la decisión');
    expect(aviso.cuerpo).not.toMatch(/acept|aprob/i);
  });

  test('sin paquete final listo y revisado de esta solicitud → 409 ENVIO_SIN_PAQUETE_FINAL', async () => {
    const { solicitud, paquete } = await f.crearPaqueteCompleto({ coordinador: coord });
    const otro = await f.crearPaqueteCompleto({ coordinador: coord });
    const sinRevisar = await f.crearPaquetePdf({ solicitud });
    const borrador = await f.crearPaquetePdf({
      solicitud,
      tipo: 'borrador',
      revisadoPor: coord.id,
      revisadoEn: new Date(),
    });
    const fallido = await f.crearPaquetePdf({
      solicitud,
      estado: 'fallido',
      revisadoPor: coord.id,
      revisadoEn: new Date(),
    });
    for (const p of [sinRevisar, borrador, fallido, otro.paquete]) {
      const res = await enviar(solicitud, cuerpoEnvio(p)).expect(409);
      expect(res.body.codigo).toBe('ENVIO_SIN_PAQUETE_FINAL');
    }
    // Un paquete de antes de que la solicitud volviera a COMPLETA puede estar desactualizado.
    await solicitud.update({ ultimoCambioEstado: new Date(Date.now() + 1000) });
    expect((await enviar(solicitud, cuerpoEnvio(paquete)).expect(409)).body.codigo).toBe(
      'ENVIO_SIN_PAQUETE_FINAL',
    );
    expect((await solicitud.reload()).estado).toBe('COMPLETA');
    expect(await db.Envio.count()).toBe(0);
  });

  test('destino distinto del paquete → 409; solicitud fuera de COMPLETA → 409', async () => {
    const { solicitud, paquete } = await f.crearPaqueteCompleto({ coordinador: coord });
    const res = await enviar(solicitud, cuerpoEnvio(paquete, { destino: 'MEXICO' })).expect(409);
    expect(res.body).toMatchObject({
      codigo: 'ENVIO_DESTINO_DISTINTO',
      campos: { destino: 'DISTINTO_DEL_PAQUETE' },
    });
    await solicitud.update({ estado: 'EN_REVISION' });
    expect((await enviar(solicitud, cuerpoEnvio(paquete)).expect(409)).body.codigo).toBe(
      'ENVIO_ESTADO_INVALIDO',
    );
  });

  test('validación: fecha futura, método fuera de la lista y campos de más → 400', async () => {
    const { solicitud, paquete } = await f.crearPaqueteCompleto({ coordinador: coord });
    expect(
      (await enviar(solicitud, cuerpoEnvio(paquete, { fecha: manana() })).expect(400)).body.campos,
    ).toEqual({ fecha: 'FECHA_FUTURA' });
    expect(
      (await enviar(solicitud, cuerpoEnvio(paquete, { metodo: 'paloma' })).expect(400)).body.campos,
    ).toEqual({ metodo: 'VALOR_NO_PERMITIDO' });
    expect(
      (await enviar(solicitud, cuerpoEnvio(paquete, { aceptado: true })).expect(400)).body.campos,
    ).toEqual({ aceptado: 'CAMPO_NO_PERMITIDO' });
  });
});

describe('POST /solicitudes/:id/respuestas', () => {
  async function enviada() {
    const caso = await f.crearPaqueteCompleto({ coordinador: coord });
    const envio = (
      await enviar(caso.solicitud, cuerpoEnvio(caso.paquete, { fecha: ayer() })).expect(201)
    ).body.envio;
    return { ...caso, envio };
  }

  test.each([
    ['informacion_adicional', 'INFO_ADICIONAL', []],
    ['aceptada', 'ACEPTADA', []],
    ['denegada', 'DENEGADA', ['reabrir_evaluacion']],
  ])('%s → %s con aviso neutral a la familia', async (resultado, estado, acciones) => {
    const { solicitud, envio } = await enviada();
    const res = await responder(solicitud, {
      fecha: hoyIso(),
      resultado,
      observaciones: 'Observación ficticia',
    }).expect(201);
    expect(res.body).toEqual({
      solicitud: expect.objectContaining({ id: solicitud.id, estado }),
      respuesta: {
        id: expect.any(String),
        solicitudId: solicitud.id,
        envioId: envio.id,
        fecha: hoyIso(),
        resultado,
        observaciones: 'Observación ficticia',
        registradoPor: { id: coord.id, nombre: expect.any(String) },
        creadoEn: expect.any(String),
      },
      acciones,
    });
    const avisos = await avisosFamilia(solicitud);
    const ultimo = avisos.at(-1);
    expect(ultimo.tipo).toBe('RESPUESTA_REGISTRADA');
    expect(ultimo.cuerpo).toContain('coordinador del caso');
    expect(ultimo.cuerpo).not.toMatch(/acept|deneg|rechaz/i);
    expect(await db.Bitacora.count({ where: { accion: 'respuesta.registrar' } })).toBe(1);
  });

  test('fuera de ENVIADA → 409; fecha anterior al envío o futura → 400', async () => {
    const { solicitud } = await enviada();
    expect(
      (await responder(solicitud, { fecha: '2020-01-01', resultado: 'aceptada' }).expect(400)).body
        .campos,
    ).toEqual({ fecha: 'ANTERIOR_AL_ENVIO' });
    expect(
      (await responder(solicitud, { fecha: manana(), resultado: 'aceptada' }).expect(400)).body
        .campos,
    ).toEqual({ fecha: 'FECHA_FUTURA' });
    expect(
      (await responder(solicitud, { fecha: hoyIso(), resultado: 'quiza' }).expect(400)).body.campos,
    ).toEqual({ resultado: 'VALOR_NO_PERMITIDO' });

    await responder(solicitud, { fecha: hoyIso(), resultado: 'aceptada' }).expect(201);
    const otra = await responder(solicitud, { fecha: hoyIso(), resultado: 'denegada' }).expect(409);
    expect(otra.body.codigo).toBe('RESPUESTA_ESTADO_INVALIDO');
    const completa = await f.crearSolicitud({ estado: 'COMPLETA', rutaDecidida: 'MEXICO' });
    expect(
      (await responder(completa, { fecha: hoyIso(), resultado: 'aceptada' }).expect(409)).body
        .codigo,
    ).toBe('RESPUESTA_ESTADO_INVALIDO');
    expect(await db.RespuestaShriners.count()).toBe(1);
  });

  test('solicitud inexistente → 404', async () => {
    await con(api().post(`/api/v1/solicitudes/${crypto.randomUUID()}/respuestas`), tc)
      .send({ fecha: hoyIso(), resultado: 'aceptada' })
      .expect(404);
  });
});
