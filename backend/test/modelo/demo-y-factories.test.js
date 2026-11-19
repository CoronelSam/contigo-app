'use strict';

const db = require('../../src/models');
const f = require('../factories');
const { sembrarDemo, CASOS, USUARIOS } = require('../../src/db/semillas/demo');
const { limpiarBase } = require('../helpers/db');
const { tokenPara } = require('../helpers/auth');
const { verificarAcceso } = require('../../src/core/auth/jwt');

const { sequelize } = db;
const sembrar = (contrasena) =>
  sequelize.transaction((transaction) =>
    sembrarDemo({ queryInterface: sequelize.getQueryInterface(), transaction, contrasena }),
  );

describe('datos de demostración', () => {
  beforeEach(() => limpiarBase());

  test('carga una vez y es idempotente', async () => {
    await expect(sembrar('ContrasenaDemo-123')).resolves.toEqual({ creado: true });
    const conteo = async () => ({
      usuarios: await db.Usuario.count(),
      solicitudes: await db.Solicitud.count(),
      proveedores: await db.ProveedorLocal.count(),
    });
    const primera = await conteo();
    expect(primera).toEqual({
      usuarios: USUARIOS.length,
      solicitudes: CASOS.length,
      proveedores: 3,
    });

    await expect(sembrar('ContrasenaDemo-123')).resolves.toEqual({ creado: false });
    expect(await conteo()).toEqual(primera);
  });

  test('los casos quedan en sus estados con historial coherente y datos ficticios', async () => {
    await sembrar('ContrasenaDemo-123');
    const solicitudes = await db.Solicitud.findAll({ include: ['historial', 'paciente'] });
    expect(solicitudes.map((s) => s.estado).sort()).toEqual(CASOS.map((c) => c.estado).sort());
    for (const s of solicitudes) {
      const ultimo = [...s.historial].sort((a, b) => a.createdAt - b.createdAt).at(-1);
      expect(ultimo.estadoNuevo).toBe(s.estado);
      expect(s.paciente.nombres).toMatch(/Demo/);
    }
    for (const u of await db.Usuario.findAll())
      expect(u.correo).toMatch(/\.demo@vanguardia\.test$/);
  });

  test('exige una contraseña y se niega en producción', async () => {
    await expect(sembrar(undefined)).rejects.toThrow(/SEED_DEMO_CONTRASENA/);
    const entorno = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(sembrar('ContrasenaDemo-123')).rejects.toThrow(/producción/);
    } finally {
      process.env.NODE_ENV = entorno;
    }
  });
});

describe('factories', () => {
  beforeEach(() => limpiarBase());

  test('crean registros válidos y relacionados', async () => {
    const familia = await f.crearFamilia({ hijos: 2 });
    expect(familia.pacientes).toHaveLength(2);
    expect(familia.tutor.usuarioId).toBe(familia.usuario.id);
    expect(await db.PacienteTutor.count({ where: { tutorId: familia.tutor.id } })).toBe(2);

    const solicitud = await f.crearSolicitud({ paciente: familia.paciente, estado: 'EN_REVISION' });
    expect(solicitud.codigo).toMatch(/^HN-\d{4,}$/);
    expect(solicitud.etapa).toBe('evaluacion');

    const exterior = await f.crearSolicitud({ estado: 'PAQUETE_EXTERIOR', rutaDecidida: 'MEXICO' });
    expect([exterior.etapa, exterior.paquete]).toEqual(['paquete', 'MEXICO']);

    const documento = await f.crearDocumento({ solicitud, paginas: 3, estado: 'VALIDADO' });
    expect(await db.DocumentoPagina.count({ where: { documentoId: documento.id } })).toBe(3);

    const extraccion = await f.crearExtraccion({ documento });
    expect(await db.CampoExtraido.count({ where: { extraccionId: extraccion.id } })).toBe(2);

    // En serie: crear en paralelo deja inserciones vivas si una falla.
    const resto = [];
    resto.push(await f.crearSeccion({ solicitud }));
    resto.push(await f.crearPlantilla());
    resto.push(await f.crearAsignacion({ solicitud }));
    resto.push(await f.crearCorreccion());
    resto.push(await f.crearCorreccion({ solicitud, seccion: 'educacion' }));
    resto.push(await f.crearDerivacion());
    resto.push(await f.crearEvaluacion());
    resto.push(await f.crearMensaje({ solicitud, autor: familia.usuario }));
    resto.push(await f.crearNotificacion({ usuario: familia.usuario }));
    expect(resto.every((r) => r.id)).toBe(true);

    const { solicitud: completa, paquete } = await f.crearPaqueteCompleto();
    expect([completa.estado, paquete.tipo, paquete.estado]).toEqual(['COMPLETA', 'final', 'listo']);
    expect(paquete.revisadoPor).toBe(completa.coordinadorId);
  });

  test('tokenPara crea una sesión y firma un token válido', async () => {
    const coordinador = await f.crearUsuario({ rol: 'coordinador' });
    const datos = verificarAcceso(await tokenPara(coordinador));
    expect(datos).toEqual(expect.objectContaining({ sub: coordinador.id, rol: 'coordinador' }));
    expect(await db.Sesion.findByPk(datos.sid)).not.toBeNull();
  });
});
