'use strict';

// Integración real con pg-boss sobre la base de pruebas.

const { crearCola } = require('../src/core/cola');
const { crearLogger } = require('../src/core/logger');
const T = require('../src/core/cola/trabajos');

const url = process.env.DATABASE_URL_TEST;
const log = crearLogger({ nivel: 'silent' });

describe('cola con pg-boss', () => {
  const productor = crearCola({ proveedor: 'pgboss', url, log });
  const trabajador = crearCola({ proveedor: 'pgboss', url, log });

  afterAll(async () => {
    await trabajador.detener();
    await productor.detener();
  });

  test('el productor encola y el trabajador procesa', async () => {
    await productor.iniciar({ modo: 'productor' });
    await productor.iniciar({ modo: 'productor' }); // idempotente
    expect(await productor.verificar()).toBe(true);

    let recibir;
    const recibido = new Promise((r) => {
      recibir = r;
    });
    await trabajador.registrar(T.CORREO_ENVIAR, async (datos, { trabajo }) =>
      recibir({ datos, trabajo }),
    );
    await trabajador.iniciar({ modo: 'trabajador', intervaloSegundos: 0.5 });

    const id = await productor.enviar(T.CORREO_ENVIAR, { plantilla: 'prueba' });
    expect(id).toEqual(expect.any(String));

    const { datos, trabajo } = await recibido;
    expect(datos).toEqual({ plantilla: 'prueba' });
    expect(trabajo.id).toBe(id);
  });

  test('no permite encolar sin iniciar', async () => {
    const sinIniciar = crearCola({ proveedor: 'pgboss', url, log });
    await expect(sinIniciar.enviar(T.CORREO_ENVIAR, {})).rejects.toThrow('no está iniciada');
  });
});
