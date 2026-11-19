'use strict';

const { api } = require('./helpers/app');
const { registrarChequeo, quitarChequeo, ejecutarChequeos } = require('../src/core/salud');

describe('GET /health', () => {
  afterEach(() => {
    quitarChequeo('falla');
    quitarChequeo('lento');
  });

  test('responde 200 con base de datos, cola y almacenamiento operativos', async () => {
    const res = await api().get('/health').expect(200);
    expect(res.body.estado).toBe('operativo');
    expect(res.body.chequeos).toEqual(
      expect.objectContaining({
        db: { ok: true, ms: expect.any(Number) },
        cola: { ok: true, ms: expect.any(Number) },
        almacenamiento: { ok: true, ms: expect.any(Number) },
      }),
    );
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('responde 503 sin detalles internos cuando un componente falla', async () => {
    registrarChequeo('falla', async () => {
      throw new Error('detalle interno que no debe salir');
    });
    const res = await api().get('/health').expect(503);
    expect(res.body.estado).toBe('degradado');
    expect(res.body.chequeos.falla.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('detalle interno');
  });

  test('un chequeo que no responde se corta por tiempo', async () => {
    registrarChequeo('lento', () => new Promise(() => {}));
    const inicio = Date.now();
    const resultado = await ejecutarChequeos({ limiteMs: 50 });
    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(resultado.chequeos.lento.ok).toBe(false);
  });

  test('acepta un X-Request-Id válido y lo devuelve', async () => {
    const res = await api().get('/health').set('X-Request-Id', 'prueba-1234-abcd').expect(200);
    expect(res.headers['x-request-id']).toBe('prueba-1234-abcd');
  });
});
