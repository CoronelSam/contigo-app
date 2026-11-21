'use strict';

const sharp = require('sharp');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

const NINO = Object.freeze({
  nombres: '  José  Ángel ',
  apellidoPaterno: 'Núñez',
  apellidoMaterno: 'Prueba',
  fechaNacimiento: '2016-05-10',
  sexo: 'masculino',
  departamentoCodigo: '08',
  municipioCodigo: '0801',
  direccion: 'Dirección ficticia',
});

describe('niños (pacientes)', () => {
  let familia;
  let token;

  beforeEach(async () => {
    await limpiarBase();
    familia = await f.crearUsuario({
      rol: 'familia',
      nombres: 'Madre',
      apellidos: 'Prueba',
      telefono: '+50433334444',
    });
    token = await tokenPara(familia);
  });

  const conToken = (req, t = token) => req.set('Authorization', `Bearer ${t}`);
  const crear = (datos = NINO, t = token) =>
    conToken(api().post('/api/v1/pacientes'), t).send(datos);

  test('registrar un niño lo vincula a la cuenta y calcula la edad', async () => {
    const res = await crear().expect(201);
    expect(res.body).toMatchObject({
      nombres: 'José Ángel',
      nombreCompleto: 'José Ángel Núñez Prueba',
      fechaNacimiento: '2016-05-10',
      edad: { anios: expect.any(Number), meses: expect.any(Number) },
      municipio: { codigo: '0801', nombre: 'Distrito Central' },
      departamento: { codigo: '08', nombre: 'Francisco Morazán' },
      fotoArchivoId: null,
    });
    expect(res.body.edad.anios).toBeGreaterThanOrEqual(10);
    expect(res.body).not.toHaveProperty('posibleDuplicado');
    expect(res.body.tutores).toEqual([
      expect.objectContaining({
        nombres: 'Madre',
        tieneCuenta: true,
        esLaCuentaActual: true,
        esResponsableLegal: false,
        telefono: '+50433334444',
      }),
    ]);
    expect(await db.Bitacora.count({ where: { accion: 'pacientes.crear' } })).toBe(1);

    // El segundo niño reutiliza el mismo perfil de tutor de la cuenta.
    await crear({ ...NINO, nombres: 'Otra Niña', sexo: 'femenino' }).expect(201);
    expect(await db.Tutor.count({ where: { usuarioId: familia.id } })).toBe(1);
  });

  test.each([
    [{ municipioCodigo: '0501' }, { municipioCodigo: 'NO_PERTENECE_AL_DEPARTAMENTO' }],
    [{ municipioCodigo: '9999' }, { municipioCodigo: 'NO_EXISTE' }],
    [{ fechaNacimiento: '2999-01-01' }, { fechaNacimiento: 'FECHA_FUTURA' }],
    [{ fechaNacimiento: '2016-02-30' }, { fechaNacimiento: 'FORMATO_INVALIDO' }],
    [{ sexo: 'otro' }, { sexo: 'VALOR_NO_PERMITIDO' }],
    [{ nombres: '' }, { nombres: 'MUY_CORTO' }],
  ])('valida %j', async (cambio, campos) => {
    const res = await crear({ ...NINO, ...cambio }).expect(400);
    expect(res.body.campos).toEqual(campos);
  });

  test('un duplicado en la misma cuenta pide confirmación', async () => {
    await crear().expect(201);
    const repetido = await crear({
      ...NINO,
      nombres: 'jose angel',
      apellidoPaterno: 'NUNEZ',
    }).expect(409);
    expect(repetido.body.codigo).toBe('PACIENTE_POSIBLE_DUPLICADO');
    await crear({ ...NINO, confirmarDuplicado: true }).expect(201);
    expect(await db.Paciente.count()).toBe(2);
  });

  test('un duplicado de otra cuenta no se revela: se crea y se marca para el coordinador', async () => {
    await crear().expect(201);
    const otraFamilia = await tokenPara(await f.crearUsuario());
    const res = await crear(NINO, otraFamilia).expect(201);
    expect(res.body).not.toHaveProperty('posibleDuplicado');
    expect(JSON.stringify(res.body)).not.toContain('Madre');

    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    const detalle = await conToken(
      api().get(`/api/v1/pacientes/${res.body.id}`),
      coordinador,
    ).expect(200);
    expect(detalle.body.posibleDuplicado).toBe(true);
  });

  test('solo las familias registran niños', async () => {
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    expect((await crear(NINO, coordinador)).status).toBe(403);
    const voluntario = await tokenPara(await f.crearUsuario({ rol: 'voluntario' }));
    expect((await crear(NINO, voluntario)).status).toBe(403);
    await api().post('/api/v1/pacientes').send(NINO).expect(401);
  });

  test('la familia lista solo sus niños; el coordinador busca por nombre sin acentos', async () => {
    const propio = (await crear().expect(201)).body;
    const ajena = await f.crearFamilia({
      paciente: { nombres: 'María', apellidoPaterno: 'López' },
    });

    const lista = await conToken(api().get('/api/v1/pacientes')).expect(200);
    expect(lista.body.paginacion).toEqual({ page: 1, limit: 20, total: 1 });
    expect(lista.body.datos.map((p) => p.id)).toEqual([propio.id]);
    expect(lista.body.datos[0]).toMatchObject({
      nombreCompleto: 'José Ángel Núñez Prueba',
      ultimaSolicitud: null,
    });

    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    const busqueda = await conToken(api().get('/api/v1/pacientes?q=nunez'), coordinador).expect(
      200,
    );
    expect(busqueda.body.datos.map((p) => p.id)).toEqual([propio.id]);
    const todos = await conToken(api().get('/api/v1/pacientes'), coordinador).expect(200);
    expect(todos.body.datos.map((p) => p.id).sort()).toEqual([propio.id, ajena.paciente.id].sort());
  });

  test('detalle: 404 para una familia ajena; el voluntario no tiene acceso', async () => {
    const propio = (await crear().expect(201)).body;
    const ajena = await tokenPara(await f.crearUsuario());
    expect((await conToken(api().get(`/api/v1/pacientes/${propio.id}`), ajena)).status).toBe(404);
    const voluntario = await tokenPara(await f.crearUsuario({ rol: 'voluntario' }));
    expect((await conToken(api().get(`/api/v1/pacientes/${propio.id}`), voluntario)).status).toBe(
      403,
    );
    expect((await conToken(api().get('/api/v1/pacientes/no-es-uuid'))).status).toBe(400);
  });

  test('la familia edita mientras ninguna solicitud pasó a revisión; el coordinador siempre', async () => {
    const propio = (await crear().expect(201)).body;
    const editar = (cambios, t = token) =>
      conToken(api().patch(`/api/v1/pacientes/${propio.id}`), t).send(cambios);

    const ok = await editar({
      direccion: 'Nueva dirección ficticia',
      municipioCodigo: '0802',
      departamentoCodigo: '08',
    }).expect(200);
    expect(ok.body.municipio).toEqual({ codigo: '0802', nombre: 'Alubarén' });

    await f.crearSolicitud({
      paciente: await db.Paciente.findByPk(propio.id),
      estado: 'EN_REVISION',
    });
    const bloqueada = await editar({ direccion: 'Otra dirección' }).expect(409);
    expect(bloqueada.body.codigo).toBe('PACIENTE_EDICION_BLOQUEADA');

    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    await editar(
      { direccion: 'Corregida por el coordinador', posibleDuplicado: false },
      coordinador,
    ).expect(200);
    const bitacora = await db.Bitacora.findAll({
      where: { accion: 'pacientes.actualizar' },
      order: [['createdAt', 'ASC']],
    });
    expect(bitacora.at(-1).despues).toEqual({ direccion: 'Corregida por el coordinador' });
  });

  test('la familia no cambia posibleDuplicado; validaciones de la edición', async () => {
    const propio = (await crear().expect(201)).body;
    const ruta = `/api/v1/pacientes/${propio.id}`;
    const r1 = await conToken(api().patch(ruta)).send({ posibleDuplicado: false }).expect(400);
    expect(r1.body.campos).toEqual({ posibleDuplicado: 'CAMPO_NO_PERMITIDO' });
    const r2 = await conToken(api().patch(ruta)).send({ departamentoCodigo: '05' }).expect(400);
    expect(r2.body.campos).toEqual({ municipioCodigo: 'REQUERIDO' });
    const r3 = await conToken(api().patch(ruta)).send({}).expect(400);
    expect(r3.body.campos).toEqual({ cuerpo: 'SIN_CAMBIOS' });
  });

  test('la foto acepta imágenes y rechaza otros archivos', async () => {
    const propio = (await crear().expect(201)).body;
    const ruta = `/api/v1/pacientes/${propio.id}/foto`;
    const imagen = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#a63' },
    })
      .png()
      .toBuffer();

    const res = await conToken(api().put(ruta)).attach('foto', imagen, 'foto.png').expect(200);
    expect(res.body.fotoArchivoId).toEqual(expect.any(String));
    expect((await db.Archivo.findByPk(res.body.fotoArchivoId)).mime).toBe('image/png');

    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
    const rechazo = await conToken(api().put(ruta)).attach('foto', pdf, 'foto.jpg').expect(400);
    expect(rechazo.body.codigo).toBe('ARCHIVO_TIPO_NO_PERMITIDO');
    const sinArchivo = await conToken(api().put(ruta)).expect(400);
    expect(sinArchivo.body.campos).toEqual({ foto: 'REQUERIDO' });

    const ajena = await tokenPara(await f.crearUsuario());
    expect((await conToken(api().put(ruta), ajena).attach('foto', imagen, 'foto.png')).status).toBe(
      404,
    );
  });
});
