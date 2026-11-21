'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

const TUTOR = Object.freeze({
  nombres: 'Abuela',
  apellidos: 'Prueba',
  parentesco: 'abuela',
  telefono: '9999-1111',
  esResponsableLegal: false,
});

describe('tutores y responsable legal', () => {
  let familia;
  let token;
  let paciente;

  beforeEach(async () => {
    await limpiarBase();
    familia = await f.crearFamilia();
    token = await tokenPara(familia.usuario);
    paciente = familia.paciente;
  });

  const conToken = (req, t = token) => req.set('Authorization', `Bearer ${t}`);
  const agregar = (datos, t = token, id = paciente.id) =>
    conToken(api().post(`/api/v1/pacientes/${id}/tutores`), t).send(datos);

  test('la cuenta completa su propio perfil y se confirma como responsable legal', async () => {
    const sinConfirmar = await agregar({
      ...TUTOR,
      esLaCuentaActual: true,
      parentesco: 'madre',
      esResponsableLegal: true,
    }).expect(400);
    expect(sinConfirmar.body.campos).toEqual({
      confirmoResponsableLegal: 'CONFIRMACION_REQUERIDA',
    });

    const res = await agregar({
      esLaCuentaActual: true,
      nombres: 'Madre Confirmada',
      apellidos: 'Prueba',
      parentesco: 'madre',
      esResponsableLegal: true,
      confirmoResponsableLegal: true,
    }).expect(201);
    expect(res.body).toMatchObject({
      id: familia.tutor.id,
      esLaCuentaActual: true,
      esResponsableLegal: true,
      parentesco: 'madre',
    });
    expect(res.body.confirmadoEn).toEqual(expect.any(String));
    const vinculo = await db.PacienteTutor.findOne({
      where: { pacienteId: paciente.id, tutorId: familia.tutor.id },
    });
    expect(vinculo.confirmadoPor).toBe(familia.usuario.id);
    expect(await db.Tutor.count({ where: { usuarioId: familia.usuario.id } })).toBe(1);
  });

  test('agrega otro tutor sin cuenta y valida el parentesco', async () => {
    const res = await agregar(TUTOR).expect(201);
    expect(res.body).toMatchObject({
      nombres: 'Abuela',
      telefono: '+50499991111',
      tieneCuenta: false,
      esLaCuentaActual: false,
    });
    const detalle = await conToken(api().get(`/api/v1/pacientes/${paciente.id}`)).expect(200);
    expect(detalle.body.tutores).toHaveLength(2);

    const malo = await agregar({ ...TUTOR, parentesco: 'vecina' }).expect(400);
    expect(malo.body.campos).toEqual({ parentesco: 'VALOR_NO_PERMITIDO' });
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    const ajeno = await agregar({ ...TUTOR, esLaCuentaActual: true }, coordinador).expect(400);
    expect(ajeno.body.campos).toEqual({ esLaCuentaActual: 'CAMPO_NO_PERMITIDO' });
    expect((await agregar(TUTOR, await tokenPara(await f.crearUsuario()))).status).toBe(404);
  });

  test('editar un tutor: la familia no toca el perfil de otra cuenta', async () => {
    const abuela = (await agregar(TUTOR).expect(201)).body;
    const editada = await conToken(api().patch(`/api/v1/tutores/${abuela.id}`))
      .send({ telefono: '+504 8888-2222' })
      .expect(200);
    expect(editada.body).toMatchObject({ telefono: '+50488882222' });
    expect(editada.body).not.toHaveProperty('esResponsableLegal');

    const otraCuenta = await f.crearUsuario();
    const tutorOtraCuenta = await f.crearTutor({ usuarioId: otraCuenta.id });
    await f.vincularTutor({ paciente, tutor: tutorOtraCuenta });
    const res = await conToken(api().patch(`/api/v1/tutores/${tutorOtraCuenta.id}`))
      .send({ nombres: 'Cambio' })
      .expect(409);
    expect(res.body.codigo).toBe('TUTOR_DE_OTRA_CUENTA');

    const ajeno = await f.crearTutor();
    expect(
      (await conToken(api().patch(`/api/v1/tutores/${ajeno.id}`)).send({ nombres: 'X' })).status,
    ).toBe(404);
  });

  test('quitar vínculos sin dejar al niño sin acceso ni sin responsable legal', async () => {
    const quitar = (tutorId, t = token) =>
      conToken(api().delete(`/api/v1/pacientes/${paciente.id}/tutores/${tutorId}`), t);

    const propio = await quitar(familia.tutor.id).expect(409);
    expect(propio.body.codigo).toBe('TUTOR_VINCULO_PROPIO');

    // La cuenta deja de ser responsable legal: la abuela será la única.
    await db.PacienteTutor.update(
      { esResponsableLegal: false },
      { where: { pacienteId: paciente.id } },
    );

    const abuela = (
      await agregar({ ...TUTOR, esResponsableLegal: true, confirmoResponsableLegal: true }).expect(
        201,
      )
    ).body;
    const ultimo = await quitar(abuela.id).expect(409);
    expect(ultimo.body.codigo).toBe('TUTOR_ULTIMO_RESPONSABLE');

    const tia = (await agregar({ ...TUTOR, nombres: 'Tía', parentesco: 'tia' }).expect(201)).body;
    await quitar(tia.id).expect(204);
    expect(await db.Tutor.findByPk(tia.id)).not.toBeNull();
    expect(await db.Bitacora.count({ where: { accion: 'pacientes.desvincular_tutor' } })).toBe(1);

    const otraCuenta = await f.crearTutor({ usuarioId: (await f.crearUsuario()).id });
    await f.vincularTutor({ paciente, tutor: otraCuenta, esResponsableLegal: false });
    expect((await quitar(otraCuenta.id)).body.codigo).toBe('TUTOR_DE_OTRA_CUENTA');
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    await quitar(otraCuenta.id, coordinador).expect(204);
  });
});

describe('GET /me/resumen', () => {
  beforeEach(() => limpiarBase());

  test('contadores e hijos con el estado de su última solicitud para la familia', async () => {
    const familia = await f.crearFamilia({ hijos: 3 });
    const [a, b] = familia.pacientes;
    await f.crearSolicitud({ paciente: a, estado: 'ACEPTADA' });
    await f.crearSolicitud({ paciente: a, estado: 'CAPTURA' });
    const enRevision = await f.crearSolicitud({ paciente: b, estado: 'EN_REVISION' });
    await f.crearDocumento({ solicitud: enRevision, tipo: 'fotos_condicion', estado: 'VALIDADO' });
    await f.crearDocumento({
      solicitud: enRevision,
      tipo: 'radiografias_informes',
      estado: 'RECHAZADO',
    });
    await f.crearNotificacion({ usuario: familia.usuario });
    await f.crearNotificacion({ usuario: familia.usuario, leidaEn: new Date() });
    await f.crearSolicitud({ estado: 'CAPTURA' });

    const res = await api()
      .get('/api/v1/me/resumen')
      .set('Authorization', `Bearer ${await tokenPara(familia.usuario)}`)
      .expect(200);
    // CAPTURA: 3 obligatorios en falta. EN_REVISION: 1 rechazado + 1 en falta (certificación).
    expect(res.body.contadores).toEqual({
      ninos: 3,
      solicitudesAbiertas: 2,
      documentosPendientes: 5,
      notificacionesNoLeidas: 1,
    });
    const estados = Object.fromEntries(
      res.body.ninos.map((n) => [n.id, n.ultimaSolicitud?.estadoFamilia ?? null]),
    );
    expect(estados).toEqual({
      [a.id]: 'DOCUMENTOS_PENDIENTES',
      [b.id]: 'EN_REVISION',
      [familia.pacientes[2].id]: null,
    });
  });

  test('solo para cuentas de familia', async () => {
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    expect(
      (await api().get('/api/v1/me/resumen').set('Authorization', `Bearer ${coordinador}`)).status,
    ).toBe(403);
    await api().get('/api/v1/me/resumen').expect(401);
  });
});
