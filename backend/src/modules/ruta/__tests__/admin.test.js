'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { con, caso, coordinador, evaluar } = require('./ayudantes');

let admin;

beforeEach(async () => {
  await limpiarBase();
  admin = await tokenPara(await f.crearUsuario({ rol: 'administrador' }));
});

const PROVEEDOR = Object.freeze({
  nombre: 'Hospital Ficticio de Prueba',
  tipo: 'hospital_publico',
  departamentoCodigo: '08',
  municipioCodigo: '0801',
  especialidades: ['ortopedia_pediatrica', 'pediatria'],
  contacto: {
    telefono: '+504 0000-0001',
    correo: 'Hospital@Pruebas.test',
    direccion: 'Dirección ficticia',
  },
});

describe('proveedores locales (administrador)', () => {
  const crear = (cuerpo = PROVEEDOR, t = admin) =>
    con(api().post('/api/v1/admin/proveedores-locales'), t).send(cuerpo);

  test('alta, validaciones, edición y desactivación sin borrar', async () => {
    const res = await crear().expect(201);
    expect(res.body).toMatchObject({
      nombre: 'Hospital Ficticio de Prueba',
      departamento: { codigo: '08', nombre: 'Francisco Morazán' },
      municipio: { codigo: '0801', nombre: 'Distrito Central' },
      contacto: { correo: 'hospital@pruebas.test' },
      activo: true,
    });

    expect(
      (await crear({ ...PROVEEDOR, municipioCodigo: '0501' }).expect(400)).body.campos,
    ).toEqual({
      municipioCodigo: 'NO_PERTENECE_AL_DEPARTAMENTO',
    });
    expect(
      (await crear({ ...PROVEEDOR, especialidades: ['brujeria'] }).expect(400)).body.campos,
    ).toEqual({
      especialidades: 'VALOR_NO_PERMITIDO',
    });
    expect(
      (await crear({ ...PROVEEDOR, departamentoCodigo: '99' }).expect(400)).body.campos,
    ).toEqual({
      departamentoCodigo: 'NO_EXISTE',
    });

    const ruta = `/api/v1/admin/proveedores-locales/${res.body.id}`;
    const editado = await con(api().patch(ruta), admin)
      .send({ nombre: 'Hospital Ficticio Renombrado', activo: false })
      .expect(200);
    expect(editado.body).toMatchObject({ nombre: 'Hospital Ficticio Renombrado', activo: false });
    expect(await db.ProveedorLocal.count()).toBe(1);
    expect(await db.Bitacora.count({ where: { entidad: 'proveedores_locales' } })).toBe(2);

    const lista = async (q) =>
      (await con(api().get(`/api/v1/admin/proveedores-locales${q}`), admin).expect(200)).body
        .length;
    expect(await lista('')).toBe(1);
    expect(await lista('?activo=true')).toBe(0);
    await con(api().patch(`/api/v1/admin/proveedores-locales/${crypto.randomUUID()}`), admin)
      .send({ activo: false })
      .expect(404);
  });

  test('solo el administrador', async () => {
    const { token } = await coordinador();
    await crear(PROVEEDOR, token).expect(403);
    await con(api().get('/api/v1/admin/proveedores-locales'), token).expect(403);
  });
});

describe('reglas de ruta versionadas', () => {
  const REGLA = Object.freeze({
    version: 2,
    nombre: 'pie_zambo_honduras',
    prioridad: 10,
    condicion: { in: ['pie_zambo', { var: 'tiposAtencion' }] },
    rutaSugerida: 'HONDURAS',
    motivoEs: 'Ejemplo ficticio: pie zambo se atiende en el país.',
    motivoEn: 'Fictitious example: clubfoot is treated in the country.',
  });
  const crearRegla = (cuerpo = REGLA) =>
    con(api().post('/api/v1/admin/reglas-ruta'), admin).send(cuerpo);
  const activar = (v) => con(api().post(`/api/v1/admin/reglas-ruta/versiones/${v}/activar`), admin);

  test('lista versiones y reglas con los hechos disponibles', async () => {
    const res = await con(api().get('/api/v1/admin/reglas-ruta'), admin).expect(200);
    expect(res.body).toMatchObject({
      versiones: [{ version: 1, activa: true, reglas: 2, usada: false }],
      version: 1,
    });
    expect(res.body.hechosDisponibles).toContain('proveedoresLocalesEnDepartamento');
    expect(res.body.reglas.map((r) => r.nombre)).toEqual([
      'proveedor_local_en_departamento',
      'sin_proveedor_local',
    ]);
  });

  test('una condición con una variable desconocida o inválida se rechaza al guardar', async () => {
    const desconocida = await crearRegla({
      ...REGLA,
      condicion: { '==': [{ var: 'diagnostico' }, 'x'] },
    }).expect(400);
    expect(desconocida.body.campos).toEqual({ condicion: 'VARIABLE_DESCONOCIDA' });
    expect(desconocida.body.mensaje).toContain('diagnostico');
    const invalida = await crearRegla({ ...REGLA, condicion: { magia: [1] } }).expect(400);
    expect(invalida.body.campos).toEqual({ condicion: 'CONDICION_INVALIDA' });
  });

  test('una versión usada no se edita; activar otra cambia la sugerencia', async () => {
    const coord = await coordinador();
    const { solicitud } = await caso();
    await f.crearSeccion({
      solicitud,
      seccion: 'informacion_medica',
      datos: { atencionSolicitada: 'pie_zambo' },
    });
    const sugerida = async () =>
      (
        await con(
          api().get(`/api/v1/solicitudes/${solicitud.id}/ruta-sugerida`),
          coord.token,
        ).expect(200)
      ).body;

    // La versión 1 se usa en una evaluación: queda inmutable.
    await evaluar(solicitud, coord.token, { rutaDecidida: 'HONDURAS' }).expect(201);
    const [v1] = await db.ReglaRuta.findAll({ where: { version: 1 } });
    const usada = await con(api().patch(`/api/v1/admin/reglas-ruta/${v1.id}`), admin)
      .send({ prioridad: 99 })
      .expect(409);
    expect(usada.body.codigo).toBe('REGLAS_VERSION_USADA');
    expect((await crearRegla({ ...REGLA, version: 1 }).expect(409)).body.codigo).toBe(
      'REGLAS_VERSION_USADA',
    );

    // Versión 2: nueva, inactiva hasta activarla.
    const nueva = await crearRegla().expect(201);
    expect(nueva.body).toMatchObject({ version: 2, activa: false });
    expect((await crearRegla().expect(409)).body.codigo).toBe('REGLAS_NOMBRE_REPETIDO');
    await con(api().patch(`/api/v1/admin/reglas-ruta/${nueva.body.id}`), admin)
      .send({ prioridad: 5 })
      .expect(200);
    expect((await sugerida()).rutaSugerida).toBe('POR_EVALUAR');

    const activada = await activar(2).expect(200);
    expect(activada.body.versiones).toEqual([
      { version: 1, activa: false, reglas: 2, usada: true },
      { version: 2, activa: true, reglas: 1, usada: false },
    ]);
    expect(await sugerida()).toMatchObject({ rutaSugerida: 'HONDURAS', versionReglas: 2 });

    expect((await activar(7).expect(409)).body.codigo).toBe('REGLAS_VERSION_VACIA');
  });

  test('solo el administrador', async () => {
    const { token } = await coordinador();
    await con(api().get('/api/v1/admin/reglas-ruta'), token).expect(403);
    await con(api().post('/api/v1/admin/reglas-ruta/versiones/1/activar'), token).expect(403);
  });
});
