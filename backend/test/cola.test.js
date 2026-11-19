'use strict';

const cola = require('../src/core/cola');
const T = require('../src/core/cola/trabajos');
const trabajos = require('../src/jobs');
const { NoImplementado } = require('../src/core/errores');
const { sequelize } = require('../src/models');

describe('cola en memoria (pruebas)', () => {
  afterEach(() => cola.vaciar());

  test('encola y ejecuta con procesarPendientes()', async () => {
    const recibidos = [];
    await cola.registrar(T.CORREO_ENVIAR, async (datos) => recibidos.push(datos));
    await cola.enviar(T.CORREO_ENVIAR, { plantilla: 'prueba' });

    expect(cola.pendientes()).toHaveLength(1);
    const { procesados } = await cola.procesarPendientes();
    expect(procesados).toHaveLength(1);
    expect(recibidos).toEqual([{ plantilla: 'prueba' }]);
    expect(cola.pendientes()).toHaveLength(0);
  });

  test('procesa también los trabajos encolados por otro trabajo', async () => {
    const orden = [];
    await cola.registrar(T.OCR_PROCESAR, async () => {
      orden.push('ocr');
      await cola.enviar(T.NOTIFICACION_PUSH, { notificacionId: 'n1' });
    });
    await cola.registrar(T.NOTIFICACION_PUSH, async () => orden.push('push'));
    await cola.enviar(T.OCR_PROCESAR, { extraccionId: 'e1' });
    await cola.procesarPendientes();
    expect(orden).toEqual(['ocr', 'push']);
  });

  test('rechaza nombres de trabajo desconocidos', async () => {
    await expect(cola.enviar('trabajo.inventado', {})).rejects.toThrow('Trabajo desconocido');
  });

  test('encolarTrasCommit encola solo si la transacción hace commit', async () => {
    await sequelize.transaction(async (transaction) => {
      await cola.encolarTrasCommit(transaction, T.CORREO_ENVIAR, { caso: 'commit' });
      expect(cola.pendientes()).toHaveLength(0);
    });
    await new Promise((r) => setImmediate(r));
    expect(cola.pendientes().map((t) => t.datos)).toEqual([{ caso: 'commit' }]);

    await expect(
      sequelize.transaction(async (transaction) => {
        await cola.encolarTrasCommit(transaction, T.CORREO_ENVIAR, { caso: 'rollback' });
        throw new Error('forzar rollback');
      }),
    ).rejects.toThrow('forzar rollback');
    await new Promise((r) => setImmediate(r));
    expect(cola.pendientes().map((t) => t.datos)).toEqual([{ caso: 'commit' }]);
  });

  test('sin handler registrado usa el del módulo dueño (hoy, stubs NoImplementado)', async () => {
    await cola.enviar(T.PAQUETE_GENERAR, { paqueteId: 'p1' });
    await expect(cola.procesarPendientes()).rejects.toBeInstanceOf(NoImplementado);
  });
});

describe('src/jobs.js', () => {
  test('tiene un handler para cada trabajo de la lista cerrada', () => {
    expect(Object.keys(trabajos).sort()).toEqual([...T.NOMBRES].sort());
  });

  test.each(T.NOMBRES.filter((n) => n !== T.CORREO_ENVIAR))(
    'el stub de %s lanza NoImplementado',
    async (nombre) => {
      const handler = trabajos[nombre]();
      await expect(handler({}, { trabajo: {}, logger: console })).rejects.toBeInstanceOf(
        NoImplementado,
      );
    },
  );
});
