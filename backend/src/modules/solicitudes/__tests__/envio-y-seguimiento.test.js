'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { actualizarCamposRuta } = require('../../../core/estados');
const { COMPLETAS, conToken, familiaConSolicitud, avanzar, enviar } = require('./ayudantes');

describe('GET /solicitudes/:id (resumen del expediente)', () => {
  let ctx;

  beforeEach(async () => {
    await limpiarBase();
    ctx = await familiaConSolicitud();
  });

  const resumen = (t = ctx.token) =>
    conToken(api().get(`/api/v1/solicitudes/${ctx.solicitud.id}`), t);

  test('la familia ve secciones, documentos, profesional, consentimientos y faltantes', async () => {
    await conToken(
      api().put(`/api/v1/solicitudes/${ctx.solicitud.id}/secciones/informacion_medica`),
      ctx.token,
    )
      .send({ datos: COMPLETAS.informacion_medica })
      .expect(200);

    const res = await resumen().expect(200);
    expect(res.body).toMatchObject({
      id: ctx.solicitud.id,
      estado: 'CAPTURA',
      modalidad: 'app',
      paciente: { id: ctx.paciente.id },
      profesional: { estado: 'vacia', obligatorio: true },
      faltantesAlEnviar: [],
      rutaDecidida: null,
      acciones: [{ accion: 'enviar', a: 'EN_REVISION' }],
    });
    expect(res.body.secciones.map((s) => s.codigo)).toEqual([
      'informacion_medica',
      'embarazo_nacimiento',
      'antecedentes_medicos',
      'medicamentos_alergias',
      'crecimiento_movilidad',
      'educacion',
      'profesional_salud',
      'consentimientos',
    ]);
    expect(res.body.secciones[0]).toEqual({
      codigo: 'informacion_medica',
      orden: 1,
      titulo: 'Información médica',
      estado: 'completa',
      obligatoria: true,
      version: 1,
    });
    expect(res.body.secciones.find((s) => s.codigo === 'profesional_salud').version).toBeNull();
    expect(res.body.documentos.map((d) => d.codigo)).toEqual([
      'fotos_condicion',
      'radiografias_informes',
      'certificacion_medica',
    ]);
    expect(res.body.consentimientos).toHaveLength(4);
    expect(res.body.faltantes).toEqual(
      expect.arrayContaining([
        { tipo: 'seccion', codigo: 'antecedentes_medicos', motivo: 'falta' },
        { tipo: 'profesional', codigo: 'profesional_salud', motivo: 'falta' },
        { tipo: 'documento', codigo: 'fotos_condicion', motivo: 'falta' },
      ]),
    );
    expect(res.body).not.toHaveProperty('rutaSugerida');
    expect(res.body).not.toHaveProperty('listoParaConfirmar');
    expect(await db.RegistroAcceso.count()).toBe(0);
  });

  test('el personal ve la ruta sugerida y su acceso queda registrado', async () => {
    const coordinador = await f.crearUsuario({ rol: 'coordinador', idioma: 'en' });
    const res = await resumen(await tokenPara(coordinador)).expect(200);
    expect(res.body).toMatchObject({ rutaSugerida: null, listoParaConfirmar: false });
    expect(res.body.secciones[0].titulo).toBe('Medical information');
    const acceso = await db.RegistroAcceso.findOne();
    expect(acceso).toMatchObject({
      usuarioId: coordinador.id,
      solicitudId: ctx.solicitud.id,
      recurso: 'expediente',
      recursoId: ctx.solicitud.id,
    });

    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await resumen(await tokenPara(voluntario)).expect(404);
    await f.crearAsignacion({ solicitud: ctx.solicitud, voluntario });
    await resumen(await tokenPara(voluntario)).expect(200);
    const admin = await tokenPara(await f.crearUsuario({ rol: 'administrador' }));
    await resumen(admin).expect(403);
    await resumen(await tokenPara(await f.crearUsuario())).expect(404);
  });
});

describe('POST /solicitudes/:id/enviar', () => {
  let ctx;
  let coordinador;

  beforeEach(async () => {
    await limpiarBase();
    coordinador = await f.crearUsuario({ rol: 'coordinador' });
    ctx = await familiaConSolicitud();
  });

  test('se envía con faltantes: los guarda, los devuelve y avisa a la familia y al coordinador', async () => {
    const res = await enviar(ctx.solicitud, ctx.token).expect(200);
    expect(res.body.solicitud).toMatchObject({ estado: 'EN_REVISION', acciones: [] });
    expect(res.body.solicitud.enviadaEn).toEqual(expect.any(String));
    expect(res.body.faltantes.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/aceptad|aprobad/i);

    const fila = await ctx.solicitud.reload();
    expect(fila.faltantesAlEnviar).toEqual(res.body.faltantes);
    expect(fila.enviadaEn).toBeInstanceOf(Date);

    const aFamilia = await db.Notificacion.findOne({ where: { usuarioId: ctx.usuario.id } });
    expect(aFamilia.tipo).toBe('SOLICITUD_ENVIADA');
    expect(aFamilia.cuerpo).toMatch(/no es una aceptación médica/);
    const aCoordinador = await db.Notificacion.findOne({ where: { usuarioId: coordinador.id } });
    expect(aCoordinador.tipo).toBe('SOLICITUD_EN_REVISION');
  });

  test('misma Idempotency-Key → misma respuesta, sin un segundo cambio de estado', async () => {
    const clave = crypto.randomUUID();
    const primera = await enviar(ctx.solicitud, ctx.token, clave).expect(200);
    const segunda = await enviar(ctx.solicitud, ctx.token, clave).expect(200);
    expect(segunda.headers['idempotency-replayed']).toBe('true');
    expect(segunda.body).toEqual(primera.body);
    expect(
      await db.HistorialEstado.count({
        where: { solicitudId: ctx.solicitud.id, estadoNuevo: 'EN_REVISION' },
      }),
    ).toBe(1);

    const otraVez = await enviar(ctx.solicitud, ctx.token).expect(409);
    expect(otraVez.body.codigo).toBe('SOLICITUD_TRANSICION_INVALIDA');
  });

  test('exige Idempotency-Key; desde BORRADOR la transición es inválida; acceso', async () => {
    await conToken(api().post(`/api/v1/solicitudes/${ctx.solicitud.id}/enviar`), ctx.token).expect(
      428,
    );
    const borrador = await familiaConSolicitud({ modalidad: null });
    const res = await enviar(borrador.solicitud, borrador.token).expect(409);
    expect(res.body.codigo).toBe('SOLICITUD_TRANSICION_INVALIDA');

    await enviar(ctx.solicitud, await tokenPara(await f.crearUsuario())).expect(404);
    await enviar(ctx.solicitud, await tokenPara(coordinador)).expect(403);
  });

  test('la familia reenvía después de una corrección (INFO_ADICIONAL → EN_REVISION)', async () => {
    await enviar(ctx.solicitud, ctx.token).expect(200);
    await avanzar(ctx.solicitud, 'INFO_ADICIONAL', coordinador);
    await enviar(ctx.solicitud, ctx.token).expect(200);
    expect((await ctx.solicitud.reload()).estado).toBe('EN_REVISION');
  });
});

describe('GET /solicitudes/:id/seguimiento', () => {
  let ctx;
  let coordinador;

  beforeEach(async () => {
    await limpiarBase();
    coordinador = await f.crearUsuario({ rol: 'coordinador' });
    ctx = await familiaConSolicitud();
  });

  const seguimiento = async (t = ctx.token) =>
    (
      await conToken(api().get(`/api/v1/solicitudes/${ctx.solicitud.id}/seguimiento`), t).expect(
        200,
      )
    ).body;
  const resumen = (pasos) => pasos.map((p) => [p.codigo, p.estado]);
  const sinFechasFuturas = (pasos) => {
    for (const p of pasos) {
      if (p.estado === 'pendiente') expect(p.fecha).toBeNull();
      else expect(new Date(p.fecha).getTime()).toBeLessThanOrEqual(Date.now());
    }
  };

  test('sin ruta decidida: un único paso pendiente según la ruta', async () => {
    await enviar(ctx.solicitud, ctx.token).expect(200);
    await avanzar(ctx.solicitud, 'INFO_ADICIONAL', coordinador);
    const s = await seguimiento();
    expect(s).toMatchObject({ estado: 'INFO_ADICIONAL', ruta: null });
    expect(resumen(s.pasos)).toEqual([
      ['SOLICITUD_CREADA', 'completado'],
      ['CAPTURA', 'completado'],
      ['EN_REVISION', 'actual'],
      ['EVALUACION_RUTA', 'pendiente'],
      ['SIGUIENTE_PASO_SEGUN_RUTA', 'pendiente'],
    ]);
    expect(s.pasos[2].eventos).toEqual([{ codigo: 'INFO_ADICIONAL', fecha: expect.any(String) }]);
    sinFechasFuturas(s.pasos);
  });

  test('ruta Honduras: derivación con la cita registrada y atención', async () => {
    await enviar(ctx.solicitud, ctx.token).expect(200);
    await avanzar(ctx.solicitud, 'EN_EVALUACION', coordinador);
    await db.sequelize.transaction(async (transaction) => {
      const solicitud = await db.Solicitud.findByPk(ctx.solicitud.id, { transaction });
      await actualizarCamposRuta({
        solicitud,
        usuario: { id: coordinador.id, rol: 'coordinador' },
        campos: { rutaDecidida: 'HONDURAS' },
        transaction,
      });
    });
    let s = await seguimiento();
    expect(resumen(s.pasos).slice(3)).toEqual([
      ['EVALUACION_RUTA', 'actual'],
      ['DERIVADA_HN', 'pendiente'],
      ['ATENDIDA_HN', 'pendiente'],
    ]);

    const derivacion = await f.crearDerivacion({ solicitud: ctx.solicitud });
    await avanzar(ctx.solicitud, 'DERIVADA_HN', coordinador);
    s = await seguimiento();
    expect(s.ruta).toBe('HONDURAS');
    const derivada = s.pasos.find((p) => p.codigo === 'DERIVADA_HN');
    expect(derivada).toMatchObject({
      estado: 'actual',
      cita: { fecha: derivacion.fechaCita, hora: null },
    });
    sinFechasFuturas(s.pasos);

    await avanzar(ctx.solicitud, 'ATENDIDA_HN', coordinador);
    s = await seguimiento();
    expect(s.pasos.every((p) => p.estado === 'completado')).toBe(true);
  });

  test('ruta al exterior: paquete, completa, envío y respuesta', async () => {
    await enviar(ctx.solicitud, ctx.token).expect(200);
    await avanzar(ctx.solicitud, 'EN_EVALUACION', coordinador);
    await avanzar(ctx.solicitud, 'PAQUETE_EXTERIOR', coordinador, {
      rutaDecidida: 'INTERNACIONAL',
    });
    let s = await seguimiento();
    expect(s.ruta).toBe('EXTERIOR');
    expect(resumen(s.pasos).slice(3)).toEqual([
      ['EVALUACION_RUTA', 'completado'],
      ['PAQUETE_EXTERIOR', 'actual'],
      ['COMPLETA', 'pendiente'],
      ['ENVIADA', 'pendiente'],
      ['RESPUESTA', 'pendiente'],
    ]);

    // La familia envía el paquete: la revisión del paquete sigue en el paso PAQUETE_EXTERIOR.
    await enviar(ctx.solicitud, ctx.token).expect(200);
    s = await seguimiento();
    expect(s.pasos.find((p) => p.codigo === 'PAQUETE_EXTERIOR').estado).toBe('actual');

    await avanzar(ctx.solicitud, 'COMPLETA', coordinador);
    await avanzar(ctx.solicitud, 'ENVIADA', coordinador);
    await avanzar(ctx.solicitud, 'INFO_ADICIONAL', coordinador);
    s = await seguimiento();
    const enviada = s.pasos.find((p) => p.codigo === 'ENVIADA');
    expect(enviada).toMatchObject({ estado: 'actual', eventos: [{ codigo: 'INFO_ADICIONAL' }] });

    await enviar(ctx.solicitud, ctx.token).expect(200);
    await avanzar(ctx.solicitud, 'COMPLETA', coordinador);
    await avanzar(ctx.solicitud, 'ENVIADA', coordinador);
    await avanzar(ctx.solicitud, 'ACEPTADA', coordinador);
    s = await seguimiento(await tokenPara(coordinador));
    expect(s.pasos.every((p) => p.estado === 'completado')).toBe(true);
    expect(s.pasos.at(-1)).toMatchObject({ codigo: 'RESPUESTA', resultado: 'ACEPTADA' });
    sinFechasFuturas(s.pasos);
  });

  test('solo familia y coordinador', async () => {
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud: ctx.solicitud, voluntario });
    const ruta = `/api/v1/solicitudes/${ctx.solicitud.id}/seguimiento`;
    await conToken(api().get(ruta), await tokenPara(voluntario)).expect(403);
    await conToken(api().get(ruta), await tokenPara(await f.crearUsuario())).expect(404);
    await api().get(ruta).expect(401);
  });
});
