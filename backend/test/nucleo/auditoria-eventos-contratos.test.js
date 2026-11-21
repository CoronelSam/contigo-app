'use strict';

const db = require('../../src/models');
const f = require('../factories');
const { limpiarBase } = require('../helpers/db');
const contexto = require('../../src/core/contexto');
const auditoria = require('../../src/core/auditoria');
const eventos = require('../../src/core/eventos');
const { NoImplementado } = require('../../src/core/errores');

const { sequelize } = db;

describe('auditoría', () => {
  beforeEach(() => limpiarBase());

  test('registrarBitacora guarda solo lo que cambió, sin secretos, con usuario e IP del contexto', async () => {
    const usuario = await f.crearUsuario();
    await contexto.ejecutarCon(
      { usuario: { id: usuario.id, rol: 'familia' }, ip: '10.1.1.1' },
      () =>
        auditoria.registrarBitacora({
          accion: 'usuarios.actualizar',
          entidad: 'usuarios',
          entidadId: usuario.id,
          antes: {
            nombres: 'Ana',
            telefono: '+50411111111',
            hashContrasena: 'h1',
            fecha: new Date('2026-01-01T00:00:00Z'),
          },
          despues: {
            nombres: 'Ana',
            telefono: '+50422222222',
            hashContrasena: 'h2',
            fecha: new Date('2026-01-01T00:00:00Z'),
          },
        }),
    );
    const [b] = await db.Bitacora.findAll();
    expect(b).toMatchObject({ usuarioId: usuario.id, ip: '10.1.1.1', entidadId: usuario.id });
    expect(b.antes).toEqual({ telefono: '+50411111111' });
    expect(b.despues).toEqual({ telefono: '+50422222222' });
    expect(JSON.stringify(b.toJSON())).not.toMatch(/h1|h2/);
  });

  test('sanear redacta claves sensibles anidadas', () => {
    expect(
      auditoria.sanear({ a: { token: 't', refreshToken: 'r', nombre: 'x' }, contrasena: 'c' }),
    ).toEqual({
      a: { token: '[REDACTADO]', refreshToken: '[REDACTADO]', nombre: 'x' },
      contrasena: '[REDACTADO]',
    });
  });

  test('auditarCambio aplica el cambio y lo registra; si nada cambia no escribe', async () => {
    const solicitud = await f.crearSolicitud();
    const paciente = await db.Paciente.findByPk(solicitud.pacienteId);
    await auditarYContar(paciente, { direccion: 'Nueva dirección ficticia' }, 1);
    await auditarYContar(paciente, { direccion: 'Nueva dirección ficticia' }, 1);
    const [b] = await db.Bitacora.findAll();
    expect(b).toMatchObject({
      accion: 'pacientes.actualizar',
      entidad: 'pacientes',
      entidadId: paciente.id,
    });
    expect(b.despues).toEqual({ direccion: 'Nueva dirección ficticia' });

    async function auditarYContar(instancia, cambios, total) {
      await sequelize.transaction((transaction) =>
        auditoria.auditarCambio(instancia, cambios, { transaction }),
      );
      expect(await db.Bitacora.count()).toBe(total);
    }
  });

  test('registrarAcceso exige un usuario en el contexto', async () => {
    await expect(auditoria.registrarAcceso({ recurso: 'expediente' })).rejects.toThrow(/usuario/);
    const u = await f.crearUsuario({ rol: 'coordinador' });
    const s = await f.crearSolicitud();
    await contexto.ejecutarCon({ usuario: { id: u.id, rol: 'coordinador' } }, () =>
      auditoria.registrarAcceso({ solicitudId: s.id, recurso: 'historia_clinica' }),
    );
    expect(
      await db.RegistroAcceso.count({ where: { usuarioId: u.id, recurso: 'historia_clinica' } }),
    ).toBe(1);
  });
});

describe('eventos de dominio', () => {
  afterEach(() => eventos.limpiarSuscripciones());

  test('se emiten solo después del commit, y nunca si la transacción se revierte', async () => {
    const recibidos = [];
    eventos.suscribir(eventos.EVENTOS.DOCUMENTO_CAPTURADO, (d) => recibidos.push(d));
    await sequelize.transaction(async (transaction) => {
      eventos.emitirTrasCommit(transaction, eventos.EVENTOS.DOCUMENTO_CAPTURADO, {
        documentoId: 'd1',
      });
      await eventos.esperarEventos();
      expect(recibidos).toEqual([]);
    });
    await expect(
      sequelize.transaction(async (transaction) => {
        eventos.emitirTrasCommit(transaction, eventos.EVENTOS.DOCUMENTO_CAPTURADO, {
          documentoId: 'd2',
        });
        throw new Error('revertir');
      }),
    ).rejects.toThrow('revertir');
    eventos.emitirTrasCommit(null, eventos.EVENTOS.DOCUMENTO_CAPTURADO, { documentoId: 'd3' });
    await eventos.esperarEventos();
    expect(recibidos).toEqual([{ documentoId: 'd1' }, { documentoId: 'd3' }]);
  });

  test('un suscriptor que falla no afecta a los demás; un evento desconocido es un error', async () => {
    const recibidos = [];
    eventos.suscribir(eventos.EVENTOS.SECCION_GUARDADA, () => {
      throw new Error('falla del suscriptor');
    });
    const cancelar = eventos.suscribir(eventos.EVENTOS.SECCION_GUARDADA, (d) => recibidos.push(d));
    eventos.emitirTrasCommit(null, eventos.EVENTOS.SECCION_GUARDADA, { seccion: 'educacion' });
    await eventos.esperarEventos();
    expect(recibidos).toEqual([{ seccion: 'educacion' }]);
    cancelar();
    expect(() => eventos.emitirTrasCommit(null, 'evento.inventado', {})).toThrow(/desconocido/);
    expect(() => eventos.suscribir('evento.inventado', () => {})).toThrow(/desconocido/);
  });

  test('la lista cerrada tiene los 8 eventos del brief', () => {
    expect(Object.values(eventos.EVENTOS).sort()).toEqual(
      [
        'asignacion.creada',
        'documento.capturado',
        'documento.estado_cambiado',
        'extraccion.confirmada',
        'extraccion.creada',
        'extraccion.lista_para_revision',
        'seccion.guardada',
        'solicitud.estado_cambiado',
      ].sort(),
    );
  });
});

describe('stubs de contratos entre módulos', () => {
  const contratos = {
    solicitudes: ['fusionarValoresOcr'],
    ocr: ['encolarExtraccion', 'cancelarExtraccion'],
  };

  test.each(Object.entries(contratos))(
    'modules/%s/contratos.js exporta sus funciones y lanzan NoImplementado',
    async (modulo, funciones) => {
      const m = require(`../../src/modules/${modulo}/contratos`);
      for (const nombre of funciones) {
        expect(typeof m[nombre]).toBe('function');
        await expect(m[nombre]({})).rejects.toBeInstanceOf(NoImplementado);
      }
    },
  );

  test('esquemaZonasOcr acepta cualquier valor mientras el agente 07 lo define', () => {
    const { esquemaZonasOcr } = require('../../src/modules/ocr/contratos');
    expect(esquemaZonasOcr.parse([{ campo: 'x' }])).toEqual([{ campo: 'x' }]);
  });
});
