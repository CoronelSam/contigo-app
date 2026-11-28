'use strict';

const crypto = require('node:crypto');
const f = require('../../../../test/factories');
const { registrarBitacora } = require('../../../core/auditoria');
const salud = require('../../../core/salud');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

let admin;
let token;

beforeEach(async () => {
  await limpiarBase();
  admin = await f.crearUsuario({ rol: 'administrador', nombres: 'Admin', apellidos: 'Panel' });
  token = await tokenPara(admin);
});

const con = (req, t = token) => req.set('Authorization', `Bearer ${t}`);

describe('GET /admin/resumen', () => {
  test('cifras por rol, estado y documentos procesados, con el estado del sistema', async () => {
    await f.crearUsuario({ rol: 'voluntario' });
    await f.crearUsuario({ rol: 'voluntario', estado: 'invitado', hashContrasena: null });
    await f.crearUsuario({ rol: 'coordinador', estado: 'inactivo' });
    const familia = await f.crearFamilia();
    const solicitud = await f.crearSolicitud({ paciente: familia.paciente, estado: 'EN_REVISION' });
    await f.crearSolicitud({ estado: 'BORRADOR' });
    await f.crearSolicitud({ estado: 'BORRADOR' });
    await f.crearExtraccion({ estado: 'confirmada' });
    await f.crearExtraccion({ estado: 'por_confirmar' });

    // Una invitación del administrador y una acción de un coordinador en un expediente.
    await con(api().post('/api/v1/admin/usuarios'))
      .send({
        correo: 'nueva@pruebas.test',
        nombres: 'Nueva',
        apellidos: 'Persona',
        rol: 'voluntario',
      })
      .expect(201);
    await registrarBitacora({
      accion: 'documentos.validar',
      entidad: 'documentos',
      entidadId: crypto.randomUUID(),
      solicitudId: solicitud.id,
    });

    const res = await con(api().get('/api/v1/admin/resumen')).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { usuarios, solicitudes } = res.body;
    expect(usuarios.porRol.voluntario).toEqual({ invitado: 2, activo: 1, inactivo: 0, total: 3 });
    expect(usuarios.porRol.coordinador).toEqual({ invitado: 0, activo: 0, inactivo: 1, total: 1 });
    expect(usuarios.porRol.administrador.activo).toBe(1);
    expect(usuarios.total).toBe(Object.values(usuarios.porRol).reduce((s, r) => s + r.total, 0));
    // Las extracciones de la factory crean sus propias solicitudes.
    expect(solicitudes.porEstado.EN_REVISION).toBe(1);
    expect(solicitudes.porEstado.BORRADOR).toBeGreaterThanOrEqual(2);
    expect(solicitudes.porEstado.ACEPTADA).toBe(0);
    expect(res.body.documentosProcesados).toBe(1);
    expect(res.body.sistema.estado).toBe('operativo');
    expect(res.body.sistema.chequeos.db.ok).toBe(true);

    expect(res.body.actividad).toEqual([
      {
        id: expect.any(String),
        accion: 'usuarios.invitar',
        entidad: 'usuarios',
        entidadId: expect.any(String),
        usuario: { id: admin.id, nombre: 'Admin Panel' },
        fecha: expect.any(String),
      },
    ]);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toContain(solicitud.codigo);
    expect(texto).not.toContain(familia.paciente.nombres);
    expect(texto).not.toContain(solicitud.id);
  });

  test('un chequeo caído se ve como degradado sin dar error', async () => {
    salud.registrarChequeo('prueba_caida', async () => {
      throw new Error('caído (prueba)');
    });
    try {
      const res = await con(api().get('/api/v1/admin/resumen')).expect(200);
      expect(res.body.sistema.estado).toBe('degradado');
      expect(res.body.sistema.chequeos.prueba_caida.ok).toBe(false);
    } finally {
      salud.quitarChequeo('prueba_caida');
    }
  });
});

describe('acceso al módulo', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  const ENDPOINTS = [
    ['get', '/admin/resumen'],
    ['get', '/admin/usuarios'],
    [
      'post',
      '/admin/usuarios',
      { correo: 'x@pruebas.test', nombres: 'X', apellidos: 'Y', rol: 'voluntario' },
    ],
    ['patch', `/admin/usuarios/${id}`, { nombres: 'X' }],
    ['get', '/admin/roles'],
    ['get', '/admin/tipos-documento'],
    ['post', '/admin/tipos-documento', {}],
    ['patch', `/admin/tipos-documento/${id}`, { activo: false }],
    ['get', '/admin/requisitos-ruta'],
    ['post', '/admin/requisitos-ruta', {}],
    ['patch', `/admin/requisitos-ruta/${id}`, { activo: false }],
    ['get', '/admin/catalogos'],
    ['post', '/admin/catalogos', {}],
    ['patch', `/admin/catalogos/${id}`, { activo: false }],
    ['get', '/admin/configuracion'],
    ['patch', '/admin/configuracion/ocr.umbral_confianza', { valor: 0.5 }],
    ['get', '/admin/reportes'],
  ];

  test('son 17 endpoints', () => {
    expect(ENDPOINTS).toHaveLength(17);
  });

  test.each(['coordinador', 'voluntario', 'familia'])(
    'ninguno responde a %s (403) ni sin sesión (401)',
    async (rol) => {
      const ajeno = await tokenPara(await f.crearUsuario({ rol }));
      for (const [metodo, ruta, cuerpo] of ENDPOINTS) {
        const res = await con(api()[metodo](`/api/v1${ruta}`), ajeno).send(cuerpo);
        expect([ruta, res.status, res.body.codigo]).toEqual([ruta, 403, 'SIN_PERMISO']);
        const anonimo = await api()[metodo](`/api/v1${ruta}`).send(cuerpo);
        expect([ruta, anonimo.status]).toEqual([ruta, 401]);
      }
    },
  );
});
