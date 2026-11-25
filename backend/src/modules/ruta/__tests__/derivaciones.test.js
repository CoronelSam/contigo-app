'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { con, caso, coordinador, derivar, enDias } = require('./ayudantes');

let coord;
let proveedor;

beforeEach(async () => {
  await limpiarBase();
  coord = await coordinador();
  proveedor = await f.crearProveedorLocal({
    nombre: 'Clínica Ficticia del Valle',
    especialidades: ['ortopedia_pediatrica'],
    contacto: { telefono: '+504 0000-0000', direccion: 'Calle ficticia 1' },
  });
});

const tipos = async (usuario) =>
  (
    await db.Notificacion.findAll({
      where: { usuarioId: usuario.id },
      order: [['createdAt', 'ASC']],
    })
  ).map((n) => n.tipo);
const cambiar = (id, cuerpo) =>
  con(api().patch(`/api/v1/derivaciones-locales/${id}`), coord.token).send(cuerpo);

describe('POST /solicitudes/:id/derivaciones-locales', () => {
  test('con ruta Honduras: cita programada, DERIVADA_HN y aviso con la cita', async () => {
    const { solicitud, familia, tokenFamilia } = await caso({ rutaDecidida: 'HONDURAS' });
    const res = await derivar(solicitud, coord.token, {
      proveedorId: proveedor.id,
      horaCita: '08:30',
    }).expect(201);
    expect(res.body).toMatchObject({
      solicitud: { estado: 'DERIVADA_HN' },
      derivacion: {
        proveedor: { id: proveedor.id, nombre: 'Clínica Ficticia del Valle' },
        especialidad: 'ortopedia_pediatrica',
        fechaCita: enDias(7),
        horaCita: '08:30',
        estado: 'programada',
        reemplazaA: null,
      },
    });
    const [aviso] = await db.Notificacion.findAll({ where: { usuarioId: familia.usuario.id } });
    expect(aviso.tipo).toBe('CITA_PROGRAMADA');
    expect(aviso.cuerpo).toContain('Clínica Ficticia del Valle');

    // La familia ve su cita en lenguaje claro.
    const ruta = await con(
      api().get(`/api/v1/solicitudes/${solicitud.id}/ruta`),
      tokenFamilia,
    ).expect(200);
    expect(ruta.body).toEqual({
      rutaDecidida: 'HONDURAS',
      siguientePaso: 'ASISTIR_A_CITA',
      cita: {
        fecha: enDias(7),
        hora: '08:30',
        proveedor: {
          nombre: 'Clínica Ficticia del Valle',
          direccion: 'Calle ficticia 1',
          telefono: '+504 0000-0000',
        },
        especialidad: 'ortopedia_pediatrica',
        estado: 'programada',
      },
    });
  });

  test('sin ruta Honduras, proveedor inválido, fecha pasada o requisitos pendientes → 409', async () => {
    const sinRuta = await caso();
    expect(
      (await derivar(sinRuta.solicitud, coord.token, { proveedorId: proveedor.id }).expect(409))
        .body.codigo,
    ).toBe('DERIVACION_SIN_RUTA_HONDURAS');
    const exterior = await caso({ estado: 'PAQUETE_EXTERIOR', rutaDecidida: 'MEXICO' });
    expect(
      (await derivar(exterior.solicitud, coord.token, { proveedorId: proveedor.id }).expect(409))
        .body.codigo,
    ).toBe('DERIVACION_NO_PERMITIDA');

    const { solicitud } = await caso({ rutaDecidida: 'HONDURAS' });
    const inactivo = await f.crearProveedorLocal({ activo: false });
    const otraEspecialidad = await f.crearProveedorLocal({ especialidades: ['neurocirugia'] });
    for (const p of [inactivo, otraEspecialidad]) {
      const res = await derivar(solicitud, coord.token, { proveedorId: p.id }).expect(409);
      expect(res.body.codigo).toBe('DERIVACION_PROVEEDOR_INVALIDO');
    }
    const pasada = await derivar(solicitud, coord.token, {
      proveedorId: proveedor.id,
      fechaCita: enDias(-1),
    }).expect(409);
    expect(pasada.body.codigo).toBe('DERIVACION_FECHA_PASADA');
    const catalogo = await derivar(solicitud, coord.token, {
      proveedorId: proveedor.id,
      especialidad: 'magia_blanca',
    }).expect(400);
    expect(catalogo.body.campos).toEqual({ especialidad: 'VALOR_NO_PERMITIDO' });

    // Un requisito obligatorio de Honduras sin cumplir bloquea la derivación.
    await db.RequisitoRuta.create({
      ruta: 'HONDURAS',
      tipoDocumentoId: await f.idTipoDocumento('inmunizaciones'),
      obligatorio: true,
    });
    const requisitos = await derivar(solicitud, coord.token, { proveedorId: proveedor.id }).expect(
      409,
    );
    expect(requisitos.body).toMatchObject({
      codigo: 'DERIVACION_REQUISITOS_PENDIENTES',
      campos: { 'documento.inmunizaciones': 'PENDIENTE' },
    });
    expect((await solicitud.reload()).estado).toBe('EN_EVALUACION');
  });

  test('reprogramar en DERIVADA_HN cancela la anterior y avisa, sin cambiar el estado', async () => {
    const { solicitud, familia } = await caso({ rutaDecidida: 'HONDURAS' });
    const primera = (
      await derivar(solicitud, coord.token, { proveedorId: proveedor.id }).expect(201)
    ).body.derivacion;
    const segunda = await derivar(solicitud, coord.token, {
      proveedorId: proveedor.id,
      fechaCita: enDias(14),
    }).expect(201);
    expect(segunda.body).toMatchObject({
      solicitud: { estado: 'DERIVADA_HN' },
      derivacion: { reemplazaA: primera.id, fechaCita: enDias(14), estado: 'programada' },
    });
    expect((await db.DerivacionLocal.findByPk(primera.id)).estado).toBe('cancelada');
    expect(await tipos(familia.usuario)).toEqual(['CITA_PROGRAMADA', 'CITA_ACTUALIZADA']);
    // La cita reemplazada ya no se cambia.
    expect((await cambiar(primera.id, { estado: 'atendida' }).expect(409)).body.codigo).toBe(
      'DERIVACION_NO_VIGENTE',
    );
  });
});

describe('PATCH /derivaciones-locales/:id', () => {
  async function derivado() {
    const c = await caso({ rutaDecidida: 'HONDURAS' });
    const d = (await derivar(c.solicitud, coord.token, { proveedorId: proveedor.id }).expect(201))
      .body.derivacion;
    return { ...c, derivacion: d };
  }

  test('cambiar fecha u hora avisa a la familia', async () => {
    const { derivacion, familia } = await derivado();
    const res = await cambiar(derivacion.id, { fechaCita: enDias(10), horaCita: '10:00' }).expect(
      200,
    );
    expect(res.body.derivacion).toMatchObject({ fechaCita: enDias(10), horaCita: '10:00' });
    expect(await tipos(familia.usuario)).toEqual(['CITA_PROGRAMADA', 'CITA_ACTUALIZADA']);
    expect((await cambiar(derivacion.id, { fechaCita: enDias(-2) }).expect(409)).body.codigo).toBe(
      'DERIVACION_FECHA_PASADA',
    );
  });

  test('atendida → ATENDIDA_HN', async () => {
    const { derivacion, solicitud, tokenFamilia } = await derivado();
    const res = await cambiar(derivacion.id, { estado: 'atendida' }).expect(200);
    expect(res.body).toMatchObject({
      solicitud: { estado: 'ATENDIDA_HN' },
      derivacion: { estado: 'atendida' },
    });
    const ruta = await con(
      api().get(`/api/v1/solicitudes/${solicitud.id}/ruta`),
      tokenFamilia,
    ).expect(200);
    expect(ruta.body.siguientePaso).toBe('ATENDIDO');
  });

  test('no asistió: queda en DERIVADA_HN para reprogramar, o vuelve a evaluación si se pide', async () => {
    const a = await derivado();
    const sinVolver = await cambiar(a.derivacion.id, {
      estado: 'no_asistio',
      observaciones: 'No llegó (prueba)',
    }).expect(200);
    expect(sinVolver.body).toMatchObject({
      solicitud: { estado: 'DERIVADA_HN' },
      derivacion: { estado: 'no_asistio' },
    });
    const ruta = await con(
      api().get(`/api/v1/solicitudes/${a.solicitud.id}/ruta`),
      a.tokenFamilia,
    ).expect(200);
    expect(ruta.body.siguientePaso).toBe('REPROGRAMANDO_CITA');
    // Se reprograma con una cita nueva.
    const nueva = await derivar(a.solicitud, coord.token, { proveedorId: proveedor.id }).expect(
      201,
    );
    expect(nueva.body.derivacion.reemplazaA).toBe(a.derivacion.id);

    const b = await derivado();
    const volver = await cambiar(b.derivacion.id, {
      estado: 'cancelada',
      volverAEvaluacion: true,
    }).expect(200);
    expect(volver.body.solicitud.estado).toBe('EN_EVALUACION');
    expect(await b.solicitud.reload()).toMatchObject({ rutaDecidida: null, etapa: 'evaluacion' });
  });

  test('validaciones y acceso', async () => {
    const { derivacion, tokenFamilia } = await derivado();
    expect((await cambiar(derivacion.id, {}).expect(400)).body.campos).toEqual({
      cuerpo: 'SIN_CAMBIOS',
    });
    expect(
      (await cambiar(derivacion.id, { estado: 'atendida', fechaCita: enDias(3) }).expect(400)).body
        .campos,
    ).toEqual({ fechaCita: 'NO_SE_COMBINA_CON_ESTADO' });
    expect(
      (await cambiar(derivacion.id, { volverAEvaluacion: true }).expect(400)).body.campos,
    ).toEqual({
      volverAEvaluacion: 'SOLO_CON_NO_ASISTIO_O_CANCELADA',
    });
    await con(api().patch(`/api/v1/derivaciones-locales/${derivacion.id}`), tokenFamilia)
      .send({ estado: 'atendida' })
      .expect(403);
  });
});

describe('GET /proveedores-locales', () => {
  test('solo activos, con filtros por especialidad, departamento y municipio', async () => {
    await f.crearProveedorLocal({
      nombre: 'Hospital Ficticio Norte',
      departamentoCodigo: '05',
      municipioCodigo: '0501',
      especialidades: ['neurocirugia'],
    });
    await f.crearProveedorLocal({ nombre: 'Inactivo Ficticio', activo: false });
    const nombres = async (q = '') =>
      (await con(api().get(`/api/v1/proveedores-locales${q}`), coord.token).expect(200)).body.map(
        (p) => p.nombre,
      );
    expect(await nombres()).toEqual(['Clínica Ficticia del Valle', 'Hospital Ficticio Norte']);
    expect(await nombres('?especialidad=neurocirugia')).toEqual(['Hospital Ficticio Norte']);
    expect(await nombres('?departamento=08')).toEqual(['Clínica Ficticia del Valle']);
    expect(await nombres('?municipio=0501')).toEqual(['Hospital Ficticio Norte']);
    const [p] = (await con(api().get('/api/v1/proveedores-locales?departamento=08'), coord.token))
      .body;
    expect(p).toMatchObject({
      departamento: { codigo: '08', nombre: 'Francisco Morazán' },
      activo: true,
    });
    await con(
      api().get('/api/v1/proveedores-locales'),
      await tokenPara(await f.crearUsuario()),
    ).expect(403);
  });
});
