'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { con, casoAsignado, resumen, casos } = require('./ayudantes');

let voluntario;
let otroVoluntario;
let jose;
let maria;
let ajeno;

beforeEach(async () => {
  await limpiarBase();
  voluntario = await f.crearUsuario({ rol: 'voluntario' });
  otroVoluntario = await f.crearUsuario({ rol: 'voluntario' });

  const familiaJose = await f.crearFamilia({
    paciente: { nombres: 'José Ángel', apellidoPaterno: 'Núñez', fechaNacimiento: '2015-03-10' },
  });
  jose = await casoAsignado({ voluntario, paciente: familiaJose.paciente });
  // Captura empezada y una revisión de OCR pendiente.
  const d = await f.crearDocumento({ solicitud: jose.solicitud, tipo: 'fotos_condicion' });
  await f.crearExtraccion({ documento: d });

  const familiaMaria = await f.crearFamilia({
    paciente: { nombres: 'María', apellidoPaterno: 'López' },
  });
  maria = await casoAsignado({ voluntario, paciente: familiaMaria.paciente });

  // Un caso de otro voluntario, que nunca debe aparecer.
  ajeno = await casoAsignado({ voluntario: otroVoluntario });
  await f.crearDocumento({
    solicitud: ajeno.solicitud,
    tipo: 'fotos_condicion',
    estado: 'RECHAZADO',
  });
});

describe('GET /voluntario/resumen', () => {
  test('cuenta solo los casos propios con asignación activa', async () => {
    expect(await resumen(voluntario)).toEqual({
      casosAsignados: 2,
      pendientesRevision: 1,
      capturasPendientes: 1,
      revisados: 0,
    });
    expect(await resumen(otroVoluntario)).toEqual({
      casosAsignados: 1,
      pendientesRevision: 0,
      capturasPendientes: 1,
      revisados: 0,
    });

    await maria.asignacion.update({ activa: false });
    expect((await resumen(voluntario)).casosAsignados).toBe(1);
  });
});

describe('GET /voluntario/casos', () => {
  test('lista solo sus casos con lo mínimo para trabajar', async () => {
    const lista = await casos(voluntario);
    expect(lista.paginacion).toEqual({ page: 1, limit: 20, total: 2 });
    expect(lista.datos.map((c) => c.solicitudId).sort()).toEqual(
      [jose.solicitud.id, maria.solicitud.id].sort(),
    );
    const caso = lista.datos.find((c) => c.solicitudId === jose.solicitud.id);
    expect(caso).toMatchObject({
      codigo: jose.solicitud.codigo,
      estadoSolicitud: 'CAPTURA',
      estadoAsignacion: 'en_revision',
      paciente: {
        nombreCompleto: expect.stringContaining('José Ángel Núñez'),
        edad: { anios: expect.any(Number), meses: expect.any(Number) },
        municipio: { codigo: expect.any(String), nombre: expect.any(String) },
      },
      pendientes: { documentos: 2, revisionesOcr: 1 },
    });
    expect(Object.keys(caso).sort()).toEqual([
      'asignacionId',
      'asignadaEn',
      'codigo',
      'estadoAsignacion',
      'estadoSolicitud',
      'paciente',
      'pendientes',
      'solicitudId',
    ]);
    expect(JSON.stringify(lista)).not.toContain(ajeno.solicitud.codigo);
  });

  test('busca por nombre sin acentos o por código, y filtra por estado', async () => {
    const porNombre = await casos(voluntario, '?q=jose%20angel%20nunez');
    expect(porNombre.datos.map((c) => c.solicitudId)).toEqual([jose.solicitud.id]);
    const porCodigo = await casos(voluntario, `?q=${maria.solicitud.codigo.toLowerCase()}`);
    expect(porCodigo.datos.map((c) => c.solicitudId)).toEqual([maria.solicitud.id]);
    const soloNumero = await casos(voluntario, `?q=${maria.solicitud.codigo.slice(3)}`);
    expect(soloNumero.datos.map((c) => c.solicitudId)).toEqual([maria.solicitud.id]);
    // Buscar el código de un caso ajeno no lo revela.
    expect((await casos(voluntario, `?q=${ajeno.solicitud.codigo}`)).datos).toEqual([]);

    const enRevision = await casos(voluntario, '?estado=en_revision');
    expect(enRevision.datos.map((c) => c.solicitudId)).toEqual([jose.solicitud.id]);
    const paginada = await casos(voluntario, '?limit=1&page=2');
    expect(paginada).toMatchObject({ paginacion: { page: 2, limit: 1, total: 2 } });
    expect(paginada.datos).toHaveLength(1);
  });

  test('solo voluntarios; validación de filtros', async () => {
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    await con(api().get('/api/v1/voluntario/casos'), coordinador).expect(403);
    await con(api().get('/api/v1/voluntario/resumen'), coordinador).expect(403);
    await con(
      api().get('/api/v1/voluntario/casos'),
      await tokenPara(await f.crearUsuario()),
    ).expect(403);
    const malo = await con(
      api().get('/api/v1/voluntario/casos?estado=terminado'),
      await tokenPara(voluntario),
    ).expect(400);
    expect(malo.body.campos).toEqual({ 'query.estado': 'VALOR_NO_PERMITIDO' });
    await api().get('/api/v1/voluntario/casos').expect(401);
    expect(await db.Asignacion.count()).toBe(3);
  });
});
