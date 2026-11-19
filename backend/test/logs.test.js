'use strict';

const { Writable } = require('node:stream');
const request = require('supertest');
const { crearApp } = require('../src/app');
const { crearLogger } = require('../src/core/logger');

function capturarLogs() {
  const lineas = [];
  const destino = new Writable({
    write(chunk, _encoding, listo) {
      lineas.push(chunk.toString());
      listo();
    },
  });
  return { lineas, logger: crearLogger({ nivel: 'debug', destino }) };
}

const esperarLogs = () => new Promise((r) => setTimeout(r, 20));

describe('redacción de logs', () => {
  test('no registra el header Authorization, la contraseña ni la query string', async () => {
    const { lineas, logger } = capturarLogs();
    await request(crearApp({ logger }))
      .post('/api/v1/auth/login?q=Jose%20Ficticio')
      .set('Authorization', 'Bearer token-super-secreto-123')
      .set('Cookie', 'sesion=galleta-secreta')
      .send({ correo: 'familia.demo@vanguardia.test', contrasena: 'ContrasenaSecreta99' });
    await esperarLogs();

    const salida = lineas.join('\n');
    expect(salida).toContain('/api/v1/auth/login');
    expect(salida).not.toContain('token-super-secreto-123');
    expect(salida).not.toContain('galleta-secreta');
    expect(salida).not.toContain('ContrasenaSecreta99');
    expect(salida).not.toContain('Jose');
  });

  test('redacta campos sensibles aunque alguien los registre a mano', async () => {
    const { lineas, logger } = capturarLogs();
    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc-secreto' } },
        contrasena: 'clave-1',
        usuario: { token: 'tok-2', refreshToken: 'ref-3', nombres: 'Ana' },
      },
      'prueba',
    );
    await esperarLogs();

    const salida = lineas.join('\n');
    for (const secreto of ['abc-secreto', 'clave-1', 'tok-2', 'ref-3']) {
      expect(salida).not.toContain(secreto);
    }
    expect(salida).toContain('[REDACTADO]');
  });
});
