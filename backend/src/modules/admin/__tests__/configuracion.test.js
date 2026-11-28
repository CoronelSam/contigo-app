'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { LISTA_CLAVES } = require('../configuracion.claves');
const sembrada = require('../../../db/seeders/data/configuracion.json');

let admin;
let token;

beforeEach(async () => {
  await limpiarBase();
  admin = await f.crearUsuario({ rol: 'administrador', nombres: 'Admin', apellidos: 'Ficticio' });
  token = await tokenPara(admin);
});

const listar = () =>
  api().get('/api/v1/admin/configuracion').set('Authorization', `Bearer ${token}`);
const cambiar = (clave, cuerpo) =>
  api()
    .patch(`/api/v1/admin/configuracion/${encodeURIComponent(clave)}`)
    .set('Authorization', `Bearer ${token}`)
    .send(cuerpo);

describe('GET /admin/configuracion', () => {
  test('todas las claves conocidas con su valor sembrado', async () => {
    const res = await listar().expect(200);
    expect(res.body.map((c) => c.clave)).toEqual([...LISTA_CLAVES].sort());
    expect([...LISTA_CLAVES].sort()).toEqual(Object.keys(sembrada).sort());
    const umbral = res.body.find((c) => c.clave === 'ocr.umbral_confianza');
    expect(umbral).toEqual({
      clave: 'ocr.umbral_confianza',
      valor: 0.8,
      descripcion: sembrada['ocr.umbral_confianza'].descripcion,
      actualizadoPor: null,
      actualizadoEn: expect.any(String),
    });
  });
});

describe('PATCH /admin/configuracion/:clave', () => {
  test('guarda el valor, quién lo cambió y el antes y el después en la bitácora', async () => {
    const res = await cambiar('ocr.umbral_confianza', { valor: 0.9 }).expect(200);
    expect(res.body).toMatchObject({
      valor: 0.9,
      actualizadoPor: { id: admin.id, nombre: 'Admin Ficticio' },
    });
    expect((await db.Configuracion.findByPk('ocr.umbral_confianza')).valor).toBe(0.9);
    const entrada = await db.Bitacora.findOne({ where: { accion: 'configuracion.actualizar' } });
    expect(entrada).toMatchObject({
      usuarioId: admin.id,
      entidad: 'configuracion',
      entidadId: 'ocr.umbral_confianza',
      antes: { valor: 0.8 },
      despues: { valor: 0.9 },
    });

    // El mismo valor no deja otra entrada.
    await cambiar('ocr.umbral_confianza', { valor: 0.9 }).expect(200);
    expect(await db.Bitacora.count({ where: { accion: 'configuracion.actualizar' } })).toBe(1);

    const listado = (await listar().expect(200)).body;
    expect(listado.find((c) => c.clave === 'ocr.umbral_confianza').actualizadoPor.id).toBe(
      admin.id,
    );
  });

  test('el cambio aplica en el módulo que lo lee', async () => {
    await cambiar('tablero.estados_ocultos', { valor: ['BORRADOR'] }).expect(200);
    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    await f.crearSolicitud({ estado: 'ACEPTADA' });
    const tablero = await api()
      .get('/api/v1/solicitudes')
      .set('Authorization', `Bearer ${coordinador}`)
      .expect(200);
    expect(tablero.body.datos.map((s) => s.estado)).toEqual(['ACEPTADA']);
  });

  test('una clave conocida que falta en la base se crea', async () => {
    await db.Configuracion.destroy({ where: { clave: 'auth.exigir_correo_verificado' } });
    const res = await cambiar('auth.exigir_correo_verificado', { valor: true }).expect(200);
    expect(res.body.valor).toBe(true);
    expect(res.body.descripcion).toMatch(/correo verificado/);
    const entrada = await db.Bitacora.findOne({ where: { accion: 'configuracion.actualizar' } });
    expect(entrada.antes).toEqual({ valor: null });
  });

  test('clave desconocida → 404', async () => {
    for (const clave of ['clave.inventada', '__proto__', 'constructor']) {
      expect((await cambiar(clave, { valor: true }).expect(404)).body.codigo).toBe('NO_ENCONTRADO');
    }
  });

  test.each([
    ['ocr.umbral_confianza', 'alto', { valor: 'TIPO_INVALIDO' }],
    ['ocr.umbral_confianza', 1.5, { valor: 'MUY_GRANDE' }],
    ['solicitudes.permitir_multiples_abiertas', 'sí', { valor: 'TIPO_INVALIDO' }],
    ['consentimientos.requieren_firma', ['marketing', 'marketing'], { valor: 'REPETIDO' }],
    ['consentimientos.requieren_firma', ['inventado'], { 'valor.0': 'VALOR_NO_PERMITIDO' }],
    [
      'contactos.oficiales',
      { organizacion: 'Prueba', telefono: '+504 0000-0000', correo: 'c@pruebas.test' },
      { 'valor.horario': 'REQUERIDO' },
    ],
    [
      'contactos.oficiales',
      {
        organizacion: 'Prueba',
        telefono: '+504 0000-0000',
        correo: 'c@pruebas.test',
        horario: { es: 'Lunes' },
      },
      { 'valor.horario.en': 'REQUERIDO' },
    ],
    [
      'ayuda.articulos',
      {
        es: [{ codigo: 'uno', titulo: 'Uno', cuerpo: 'Texto' }],
        en: [{ codigo: 'dos', titulo: 'Two', cuerpo: 'Text' }],
      },
      { valor: 'IDIOMAS_DISTINTOS' },
    ],
    [
      'paquete.consentimiento_secciones',
      { educacion: 'divulgacion_informacion_medica', firma: 'marketing' },
      { 'valor.firma': 'CAMPO_NO_PERMITIDO' },
    ],
    [
      'tablero.estados_ocultos',
      require('../../../core/estados/constantes').LISTA_ESTADOS_SOLICITUD,
      { valor: 'OCULTA_TODOS' },
    ],
  ])('%s con un valor inválido → 400', async (clave, valor, campos) => {
    const res = await cambiar(clave, { valor }).expect(400);
    expect(res.body).toMatchObject({ codigo: 'VALIDACION', campos });
  });

  test('sin valor o con campos de más → 400', async () => {
    expect((await cambiar('ocr.umbral_confianza', {}).expect(400)).body.campos).toEqual({
      valor: 'REQUERIDO',
    });
    expect(
      (await cambiar('ocr.umbral_confianza', { valor: 0.5, clave: 'x' }).expect(400)).body.campos,
    ).toEqual({ clave: 'CAMPO_NO_PERMITIDO' });
  });
});
