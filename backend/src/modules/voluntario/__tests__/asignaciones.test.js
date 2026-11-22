'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const eventos = require('../../../core/eventos');
const { con, casos } = require('./ayudantes');

let solicitud;
let coordinador;
let tc;
let voluntario;

beforeEach(async () => {
  await limpiarBase();
  solicitud = await f.crearSolicitud({ estado: 'CAPTURA', modalidad: 'fotos' });
  coordinador = await f.crearUsuario({ rol: 'coordinador' });
  tc = await tokenPara(coordinador);
  voluntario = await f.crearUsuario({
    rol: 'voluntario',
    nombres: 'Voluntaria',
    apellidos: 'Prueba',
  });
});

const asignar = (cuerpo, t = tc, id = solicitud.id) =>
  con(api().post(`/api/v1/solicitudes/${id}/asignaciones`), t).send(cuerpo);
const cambiar = (id, cuerpo, t = tc) =>
  con(api().patch(`/api/v1/asignaciones/${id}`), t).send(cuerpo);

describe('POST /solicitudes/:id/asignaciones', () => {
  test('asigna, avisa al voluntario, deja bitácora y emite asignacion.creada', async () => {
    const creadas = [];
    const quitar = eventos.suscribir(eventos.EVENTOS.ASIGNACION_CREADA, (d) => creadas.push(d));
    let res;
    try {
      res = await asignar({ voluntarioId: voluntario.id, notas: 'Jornada de prueba' }).expect(201);
      await eventos.esperarEventos();
    } finally {
      quitar();
    }
    expect(res.body).toMatchObject({
      solicitudId: solicitud.id,
      voluntario: { id: voluntario.id, nombres: 'Voluntaria' },
      estado: 'asignado',
      activa: true,
      notas: 'Jornada de prueba',
    });
    const aviso = await db.Notificacion.findOne({ where: { usuarioId: voluntario.id } });
    expect(aviso.tipo).toBe('ASIGNACION_NUEVA');
    expect(aviso.cuerpo).toContain(solicitud.codigo);
    expect(await db.Bitacora.findOne({ where: { accion: 'asignaciones.asignar' } })).toMatchObject({
      solicitudId: solicitud.id,
      usuarioId: coordinador.id,
    });
    expect(creadas).toEqual([
      expect.objectContaining({ solicitudId: solicitud.id, voluntarioId: voluntario.id }),
    ]);
  });

  test('rol incorrecto, inactivo o inexistente → 400; duplicada → 409', async () => {
    const familia = await f.crearUsuario();
    expect((await asignar({ voluntarioId: familia.id }).expect(400)).body.campos).toEqual({
      voluntarioId: 'NO_ES_VOLUNTARIO',
    });
    const inactivo = await f.crearUsuario({ rol: 'voluntario', estado: 'inactivo' });
    expect((await asignar({ voluntarioId: inactivo.id }).expect(400)).body.campos).toEqual({
      voluntarioId: 'INACTIVO',
    });
    expect((await asignar({ voluntarioId: crypto.randomUUID() }).expect(400)).body.campos).toEqual({
      voluntarioId: 'NO_EXISTE',
    });

    await asignar({ voluntarioId: voluntario.id }).expect(201);
    const repetida = await asignar({ voluntarioId: voluntario.id }).expect(409);
    expect(repetida.body.codigo).toBe('ASIGNACION_DUPLICADA');
    // 2 peticiones a la vez para el mismo voluntario: solo una se crea.
    const nuevo = await f.crearUsuario({ rol: 'voluntario' });
    const simultaneas = await Promise.all([
      asignar({ voluntarioId: nuevo.id }),
      asignar({ voluntarioId: nuevo.id }),
    ]);
    expect(simultaneas.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  test('varios voluntarios por caso según la configuración; casos terminados no', async () => {
    await asignar({ voluntarioId: voluntario.id }).expect(201);
    const otro = await f.crearUsuario({ rol: 'voluntario' });
    await db.Configuracion.update(
      { valor: false },
      { where: { clave: 'asignaciones.varios_voluntarios' } },
    );
    const ocupado = await asignar({ voluntarioId: otro.id }).expect(409);
    expect(ocupado.body.codigo).toBe('ASIGNACION_CASO_OCUPADO');
    await db.Configuracion.update(
      { valor: true },
      { where: { clave: 'asignaciones.varios_voluntarios' } },
    );
    await asignar({ voluntarioId: otro.id }).expect(201);

    const terminada = await f.crearSolicitud({ estado: 'ACEPTADA' });
    const res = await asignar({ voluntarioId: voluntario.id }, tc, terminada.id).expect(409);
    expect(res.body.codigo).toBe('ASIGNACION_CASO_CERRADO');
  });

  test('solo el coordinador', async () => {
    await asignar({ voluntarioId: voluntario.id }, await tokenPara(voluntario)).expect(403);
    await asignar({ voluntarioId: voluntario.id }, await tokenPara(await f.crearUsuario())).expect(
      403,
    );
    await asignar({ voluntarioId: voluntario.id }, tc, crypto.randomUUID()).expect(404);
    await api().post(`/api/v1/solicitudes/${solicitud.id}/asignaciones`).expect(401);
  });
});

describe('PATCH /asignaciones/:id', () => {
  test('cerrarla quita al voluntario el acceso al caso y de su lista', async () => {
    const creada = (await asignar({ voluntarioId: voluntario.id }).expect(201)).body;
    const tv = await tokenPara(voluntario);
    await con(api().get(`/api/v1/solicitudes/${solicitud.id}`), tv).expect(200);
    expect((await casos(voluntario)).paginacion.total).toBe(1);

    const res = await cambiar(creada.id, { activa: false, notas: 'Cierre de la jornada' }).expect(
      200,
    );
    expect(res.body).toMatchObject({
      activa: false,
      notas: 'Cierre de la jornada',
      reemplazo: null,
    });
    await con(api().get(`/api/v1/solicitudes/${solicitud.id}`), tv).expect(404);
    expect((await casos(voluntario)).datos).toEqual([]);
    expect(await db.Bitacora.count({ where: { accion: 'asignaciones.cerrar' } })).toBe(1);

    // Cerrar otra vez no cambia nada; reasignar una cerrada, sí es un error.
    await cambiar(creada.id, { activa: false }).expect(200);
    const otro = await f.crearUsuario({ rol: 'voluntario' });
    expect(
      (await cambiar(creada.id, { activa: false, voluntarioId: otro.id }).expect(409)).body.codigo,
    ).toBe('ASIGNACION_CERRADA');
  });

  test('reasignar cierra la asignación y crea otra para el nuevo voluntario', async () => {
    const creada = (await asignar({ voluntarioId: voluntario.id }).expect(201)).body;
    const nuevo = await f.crearUsuario({ rol: 'voluntario' });
    const res = await cambiar(creada.id, { activa: false, voluntarioId: nuevo.id }).expect(200);
    expect(res.body).toMatchObject({
      activa: false,
      reemplazo: { voluntario: { id: nuevo.id }, activa: true },
    });
    expect(await db.Asignacion.count({ where: { solicitudId: solicitud.id, activa: true } })).toBe(
      1,
    );
    expect(await db.Notificacion.count({ where: { usuarioId: nuevo.id } })).toBe(1);
    expect(await db.Bitacora.count({ where: { accion: 'asignaciones.reasignar' } })).toBe(1);
  });

  test('validaciones', async () => {
    const creada = (await asignar({ voluntarioId: voluntario.id }).expect(201)).body;
    expect((await cambiar(creada.id, {}).expect(400)).body.campos).toEqual({
      cuerpo: 'SIN_CAMBIOS',
    });
    expect(
      (await cambiar(creada.id, { voluntarioId: voluntario.id }).expect(400)).body.campos,
    ).toEqual({ activa: 'REQUERIDO' });
    expect(
      (await cambiar(creada.id, { activa: false, voluntarioId: voluntario.id }).expect(400)).body
        .campos,
    ).toEqual({ voluntarioId: 'ES_EL_MISMO' });
    expect((await cambiar(creada.id, { activa: true }).expect(400)).body.campos).toEqual({
      activa: 'VALOR_NO_PERMITIDO',
    });
    await cambiar(crypto.randomUUID(), { activa: false }).expect(404);
    await cambiar(creada.id, { activa: false }, await tokenPara(voluntario)).expect(403);
  });
});

describe('integración con el agente 06', () => {
  test('el voluntario asignado captura en jornada; el no asignado recibe 404', async () => {
    const tipoDocumentoId = await f.idTipoDocumento('fotos_condicion');
    const capturar = async (usuario, estado) =>
      con(api().post(`/api/v1/solicitudes/${solicitud.id}/documentos`), await tokenPara(usuario))
        .set('Idempotency-Key', crypto.randomUUID())
        .send({ tipoDocumentoId, origen: 'jornada' })
        .expect(estado);

    await capturar(voluntario, 404);
    await asignar({ voluntarioId: voluntario.id }).expect(201);
    const res = await capturar(voluntario, 201);
    expect(res.body).toMatchObject({ origen: 'jornada' });
  });
});
