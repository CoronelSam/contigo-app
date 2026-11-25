'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { con, caso, coordinador, evaluar, enDias } = require('./ayudantes');

let coord;

beforeEach(async () => {
  await limpiarBase();
  coord = await coordinador();
});

const avisos = (usuario) =>
  db.Notificacion.findAll({ where: { usuarioId: usuario.id }, order: [['createdAt', 'ASC']] });

describe('POST /solicitudes/:id/evaluaciones', () => {
  test('exterior: PAQUETE_EXTERIOR con el paquete fijado, requisitos nuevos y avisos a la familia', async () => {
    const { solicitud, familia, tokenFamilia } = await caso();
    const res = await evaluar(solicitud, coord.token, { rutaDecidida: 'MEXICO' }).expect(201);
    expect(res.body.solicitud).toEqual({
      id: solicitud.id,
      estado: 'PAQUETE_EXTERIOR',
      etapa: 'paquete',
      rutaDecidida: 'MEXICO',
      paquete: 'MEXICO',
    });
    expect(res.body.evaluacion).toMatchObject({
      rutaSugerida: 'POR_EVALUAR',
      rutaDecidida: 'MEXICO',
      versionReglas: 1,
      vigente: true,
      registradoPor: { id: coord.usuario.id },
    });
    expect(res.body.evaluacion.motivos[0].motivo).toMatch(/proveedores locales/);
    expect(res.body.evaluacion.hechos).toHaveProperty('proveedoresLocalesEnPais', 0);

    expect((await avisos(familia.usuario)).map((n) => n.tipo)).toEqual([
      'RUTA_DECIDIDA',
      'DOCUMENTOS_PENDIENTES',
    ]);
    const docs = await con(
      api().get(`/api/v1/solicitudes/${solicitud.id}/documentos`),
      tokenFamilia,
    ).expect(200);
    expect(docs.body.rutas).toEqual(['EVALUACION', 'MEXICO']);
    expect(docs.body.requisitos.map((r) => r.tipoDocumento.codigo)).toContain('seguros');
    expect((await db.Solicitud.findByPk(solicitud.id)).rutaSugerida).toBe('POR_EVALUAR');
  });

  test('Honduras: guarda la ruta sin cambiar de estado; la sugerencia y la decisión pueden diferir', async () => {
    const { solicitud, familia } = await caso();
    // Sugerencia Honduras (hay proveedor cerca), decisión internacional: se guardan las dos.
    await f.crearSeccion({
      solicitud,
      seccion: 'informacion_medica',
      datos: { atencionSolicitada: 'pie_zambo' },
    });
    const paciente = await db.Paciente.findByPk(solicitud.pacienteId);
    await f.crearProveedorLocal({
      departamentoCodigo: '08',
      especialidades: ['ortopedia_pediatrica'],
    });
    await paciente.update({ municipioCodigo: '0801' });

    const hn = await evaluar(solicitud, coord.token, { rutaDecidida: 'HONDURAS' }).expect(201);
    expect(hn.body.solicitud).toMatchObject({
      estado: 'EN_EVALUACION',
      rutaDecidida: 'HONDURAS',
      paquete: null,
    });
    expect(hn.body.evaluacion.rutaSugerida).toBe('HONDURAS');
    expect((await avisos(familia.usuario)).map((n) => n.tipo)).toEqual(['RUTA_DECIDIDA']);

    // Se puede registrar otra antes de derivar; la anterior deja de estar vigente.
    const intl = await evaluar(solicitud, coord.token, { rutaDecidida: 'INTERNACIONAL' }).expect(
      201,
    );
    expect(intl.body.evaluacion).toMatchObject({
      rutaSugerida: 'HONDURAS',
      rutaDecidida: 'INTERNACIONAL',
    });
    expect(intl.body.solicitud.estado).toBe('PAQUETE_EXTERIOR');
    const lista = await con(
      api().get(`/api/v1/solicitudes/${solicitud.id}/evaluaciones`),
      coord.token,
    ).expect(200);
    expect(lista.body.map((e) => [e.rutaDecidida, e.vigente])).toEqual([
      ['INTERNACIONAL', true],
      ['HONDURAS', false],
    ]);
  });

  test('validaciones: justificación corta, fecha futura y estado distinto de EN_EVALUACION', async () => {
    const { solicitud } = await caso();
    const corta = await evaluar(solicitud, coord.token, {
      rutaDecidida: 'HONDURAS',
      justificacion: 'Muy corta',
    }).expect(400);
    expect(corta.body.campos).toEqual({ justificacion: 'MUY_CORTO' });
    const futura = await evaluar(solicitud, coord.token, {
      rutaDecidida: 'HONDURAS',
      fechaDictamen: enDias(3),
    }).expect(400);
    expect(futura.body.campos).toEqual({ fechaDictamen: 'FECHA_FUTURA' });
    const sugerida = await evaluar(solicitud, coord.token, {
      rutaDecidida: 'HONDURAS',
      rutaSugerida: 'MEXICO',
    }).expect(400);
    expect(sugerida.body.campos).toEqual({ rutaSugerida: 'CAMPO_NO_PERMITIDO' });

    const otro = await caso({ estado: 'EN_REVISION' });
    const res = await evaluar(otro.solicitud, coord.token, { rutaDecidida: 'HONDURAS' }).expect(
      409,
    );
    expect(res.body.codigo).toBe('EVALUACION_ESTADO_INVALIDO');
    expect(await db.Evaluacion.count()).toBe(0);
  });

  test('solo el coordinador', async () => {
    const { solicitud, tokenFamilia } = await caso();
    await evaluar(solicitud, tokenFamilia, { rutaDecidida: 'HONDURAS' }).expect(403);
    const voluntario = await tokenPara(await f.crearUsuario({ rol: 'voluntario' }));
    await con(api().get(`/api/v1/solicitudes/${solicitud.id}/ruta-sugerida`), voluntario).expect(
      403,
    );
    const admin = await tokenPara(await f.crearUsuario({ rol: 'administrador' }));
    await con(api().get(`/api/v1/solicitudes/${solicitud.id}/evaluaciones`), admin).expect(403);
  });
});

describe('POST /solicitudes/:id/reabrir-evaluacion', () => {
  const reabrir = (s, motivo = 'Shriners no aceptó el caso (prueba)') =>
    con(api().post(`/api/v1/solicitudes/${s.id}/reabrir-evaluacion`), coord.token).send({ motivo });

  test.each(['PAQUETE_EXTERIOR', 'DERIVADA_HN', 'DENEGADA'])(
    'desde %s vuelve a evaluación sin ruta ni paquete',
    async (estado) => {
      const datos =
        estado === 'DERIVADA_HN' ? { rutaDecidida: 'HONDURAS' } : { rutaDecidida: 'INTERNACIONAL' };
      const { solicitud } = await caso({ estado, ...datos });
      await f.crearEvaluacion({ solicitud, rutaDecidida: datos.rutaDecidida });
      if (estado === 'DERIVADA_HN') await f.crearDerivacion({ solicitud });

      const res = await reabrir(solicitud).expect(200);
      expect(res.body).toEqual({
        id: solicitud.id,
        estado: 'EN_EVALUACION',
        etapa: 'evaluacion',
        rutaDecidida: null,
        paquete: null,
      });
      expect(await db.Evaluacion.count({ where: { vigente: true } })).toBe(0);
      expect(await db.DerivacionLocal.count({ where: { estado: 'programada' } })).toBe(0);
      const historial = await db.HistorialEstado.findOne({ where: { solicitudId: solicitud.id } });
      expect(historial.nota).toBe('Shriners no aceptó el caso (prueba)');
      expect(await db.Bitacora.count({ where: { accion: 'evaluaciones.reabrir' } })).toBe(1);
    },
  );

  test('desde otros estados → 409; motivo corto → 400', async () => {
    for (const estado of ['EN_EVALUACION', 'EN_REVISION', 'ATENDIDA_HN', 'ACEPTADA']) {
      const { solicitud } = await caso({ estado });
      const res = await reabrir(solicitud).expect(409);
      expect(res.body.codigo).toBe('SOLICITUD_TRANSICION_INVALIDA');
    }
    const { solicitud } = await caso({ estado: 'DENEGADA', rutaDecidida: 'MEXICO' });
    expect((await reabrir(solicitud, 'corto').expect(400)).body.campos).toEqual({
      motivo: 'MUY_CORTO',
    });
  });
});

describe('GET /solicitudes/:id/ruta (familia)', () => {
  test('ruta y siguiente paso en códigos, sin sugerencia, motivos ni evaluador', async () => {
    const { solicitud, tokenFamilia } = await caso();
    const ruta = (t = tokenFamilia) =>
      con(api().get(`/api/v1/solicitudes/${solicitud.id}/ruta`), t);

    expect((await ruta().expect(200)).body).toEqual({
      rutaDecidida: null,
      siguientePaso: 'PENDIENTE_DECISION',
    });
    await evaluar(solicitud, coord.token, { rutaDecidida: 'MEXICO' }).expect(201);
    const res = await ruta().expect(200);
    expect(res.body).toEqual({
      rutaDecidida: 'MEXICO',
      siguientePaso: 'COMPLETAR_DOCUMENTOS_PAQUETE',
    });
    const texto = JSON.stringify(res.body);
    for (const prohibido of ['rutaSugerida', 'motivo', 'justificacion', 'Evaluadora', 'hechos']) {
      expect(texto).not.toContain(prohibido);
    }

    await ruta(await tokenPara(await f.crearUsuario())).expect(404);
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud, voluntario });
    await ruta(await tokenPara(voluntario)).expect(403);
    await ruta(coord.token).expect(403);
  });
});
