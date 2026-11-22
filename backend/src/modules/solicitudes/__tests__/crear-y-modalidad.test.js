'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { formatearCodigo } = require('../codigo');
const { conToken, familiaConSolicitud } = require('./ayudantes');

describe('POST /solicitudes', () => {
  let familia;
  let token;

  beforeEach(async () => {
    await limpiarBase();
    familia = await f.crearFamilia();
    token = await tokenPara(familia.usuario);
  });

  const crear = (pacienteId = familia.paciente.id, t = token) =>
    conToken(api().post('/api/v1/solicitudes'), t).send({ pacienteId });

  test('crea la solicitud en BORRADOR con su código, historial y bitácora', async () => {
    const res = await crear().expect(201);
    expect(res.body).toMatchObject({
      codigo: 'HN-0001',
      pacienteId: familia.paciente.id,
      estado: 'BORRADOR',
      etapa: 'evaluacion',
      modalidad: null,
      enviadaEn: null,
      acciones: [{ accion: 'elegir_modalidad', a: 'CAPTURA' }],
    });
    const historial = await db.HistorialEstado.findAll({ where: { solicitudId: res.body.id } });
    expect(historial.map((h) => [h.estadoAnterior, h.estadoNuevo])).toEqual([[null, 'BORRADOR']]);
    expect(await db.Bitacora.count({ where: { accion: 'solicitud.crear' } })).toBe(1);
    expect((await db.Solicitud.findByPk(res.body.id)).creadaPor).toBe(familia.usuario.id);
  });

  test('el código tiene al menos 4 dígitos', () => {
    expect(formatearCodigo(7)).toBe('HN-0007');
    expect(formatearCodigo(258)).toBe('HN-0258');
    expect(formatearCodigo(12345)).toBe('HN-12345');
  });

  test('20 solicitudes creadas a la vez reciben códigos distintos', async () => {
    const grande = await f.crearFamilia({ hijos: 20 });
    const t = await tokenPara(grande.usuario);
    const respuestas = await Promise.all(grande.pacientes.map((p) => crear(p.id, t)));
    expect(respuestas.map((r) => r.status)).toEqual(Array(20).fill(201));
    const codigos = respuestas.map((r) => r.body.codigo);
    expect(new Set(codigos).size).toBe(20);
    for (const c of codigos) expect(c).toMatch(/^HN-\d{4,}$/);
  });

  test('una segunda solicitud abierta se bloquea, salvo que la configuración lo permita', async () => {
    const primera = await crear().expect(201);
    const segunda = await crear().expect(409);
    expect(segunda.body.codigo).toBe('SOLICITUD_ABIERTA_EXISTENTE');

    // Con la primera cerrada, de 2 peticiones simultáneas para el mismo niño solo una se crea.
    await db.Solicitud.update({ estado: 'ACEPTADA' }, { where: { id: primera.body.id } });
    const simultaneas = await Promise.all([crear(), crear()]);
    expect(simultaneas.map((r) => r.status).sort()).toEqual([201, 409]);

    await db.Configuracion.update(
      { valor: true },
      { where: { clave: 'solicitudes.permitir_multiples_abiertas' } },
    );
    await crear().expect(201);
  });

  test('una solicitud cerrada no cuenta como abierta', async () => {
    for (const estado of ['ACEPTADA', 'ATENDIDA_HN', 'DENEGADA']) {
      await f.crearSolicitud({ paciente: familia.paciente, estado });
    }
    await crear().expect(201);
  });

  test('solo la familia vinculada al niño; validaciones', async () => {
    const ajena = await tokenPara(await f.crearUsuario());
    expect((await crear(familia.paciente.id, ajena)).status).toBe(404);
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    expect((await crear(familia.paciente.id, coordinador)).status).toBe(403);
    await api().post('/api/v1/solicitudes').send({ pacienteId: familia.paciente.id }).expect(401);
    const invalida = await crear('no-es-uuid').expect(400);
    expect(invalida.body.campos).toEqual({ pacienteId: 'FORMATO_INVALIDO' });
    const extra = await conToken(api().post('/api/v1/solicitudes'), token)
      .send({ pacienteId: familia.paciente.id, estado: 'COMPLETA' })
      .expect(400);
    expect(extra.body.campos).toEqual({ estado: 'CAMPO_NO_PERMITIDO' });
  });
});

describe('PUT /solicitudes/:id/modalidad', () => {
  beforeEach(() => limpiarBase());

  const modalidad = (id, valor, token) =>
    conToken(api().put(`/api/v1/solicitudes/${id}/modalidad`), token).send({ modalidad: valor });

  test('en BORRADOR la elige y pasa a CAPTURA; en CAPTURA la cambia sin cambiar de estado', async () => {
    const { solicitud, token } = await familiaConSolicitud({ modalidad: null });
    const res = await modalidad(solicitud.id, 'fotos', token).expect(200);
    expect(res.body).toMatchObject({ estado: 'CAPTURA', modalidad: 'fotos' });
    expect(res.body.acciones).toEqual([{ accion: 'enviar', a: 'EN_REVISION' }]);

    const cambio = await modalidad(solicitud.id, 'app', token).expect(200);
    expect(cambio.body).toMatchObject({ estado: 'CAPTURA', modalidad: 'app' });
    const historial = await db.HistorialEstado.count({ where: { solicitudId: solicitud.id } });
    expect(historial).toBe(2);
    const bitacora = await db.Bitacora.findAll({
      where: { accion: 'solicitud.cambiar_modalidad' },
      order: [['createdAt', 'ASC']],
    });
    expect(bitacora.map((b) => [b.antes.modalidad, b.despues.modalidad])).toEqual([
      [null, 'fotos'],
      ['fotos', 'app'],
    ]);
  });

  test('después de enviar ya no se cambia; otra familia recibe 404', async () => {
    const { solicitud, token } = await familiaConSolicitud();
    await db.Solicitud.update({ estado: 'EN_REVISION' }, { where: { id: solicitud.id } });
    const res = await modalidad(solicitud.id, 'fotos', token).expect(409);
    expect(res.body.codigo).toBe('SOLICITUD_MODALIDAD_BLOQUEADA');

    const ajena = await tokenPara(await f.crearUsuario());
    expect((await modalidad(solicitud.id, 'fotos', ajena)).status).toBe(404);
    const voluntario = await tokenPara(await f.crearUsuario({ rol: 'voluntario' }));
    expect((await modalidad(solicitud.id, 'fotos', voluntario)).status).toBe(403);
    const mala = await modalidad(solicitud.id, 'papel', token).expect(400);
    expect(mala.body.campos).toEqual({ modalidad: 'VALOR_NO_PERMITIDO' });
  });
});
