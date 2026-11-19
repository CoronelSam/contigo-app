'use strict';

const jwt = require('jsonwebtoken');
const { cargarConfig, config } = require('../src/config/env');
const { firmarAcceso, verificarAcceso } = require('../src/core/auth/jwt');
const { leerPaginacion, respuestaPaginada } = require('../src/core/http/paginar');

const SECRETO = 'x'.repeat(40);

describe('config/env', () => {
  test('falla con un mensaje claro cuando faltan variables', () => {
    expect(() => cargarConfig({ NODE_ENV: 'development' })).toThrow(
      /Configuración inválida\. Revisa tu \.env[\s\S]*JWT_SECRET/,
    );
    expect(() =>
      cargarConfig({
        NODE_ENV: 'development',
        JWT_SECRET: SECRETO,
        ALMACENAMIENTO_PROVEEDOR: 'memoria',
      }),
    ).toThrow(/DATABASE_URL: obligatorio fuera de pruebas/);
  });

  test('un JWT_SECRET corto no se acepta', () => {
    expect(() =>
      cargarConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://l/db',
        JWT_SECRET: 'corto',
      }),
    ).toThrow(/JWT_SECRET: debe tener al menos 32 caracteres/);
  });

  test('exige credenciales de S3 cuando el proveedor es s3', () => {
    expect(() =>
      cargarConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://l/db',
        JWT_SECRET: SECRETO,
        ALMACENAMIENTO_PROVEEDOR: 's3',
      }),
    ).toThrow(/S3_BUCKET/);
  });

  test('no permite almacenamiento ni cola en memoria en producción', () => {
    expect(() =>
      cargarConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://l/db',
        JWT_SECRET: SECRETO,
        ALMACENAMIENTO_PROVEEDOR: 'memoria',
        COLA_PROVEEDOR: 'memoria',
      }),
    ).toThrow(/ALMACENAMIENTO_PROVEEDOR[\s\S]*COLA_PROVEEDOR/);
  });

  test('en pruebas usa DATABASE_URL_TEST y la cola en memoria', () => {
    const cfg = cargarConfig({
      NODE_ENV: 'test',
      DATABASE_URL_TEST: 'postgres://l/test',
      JWT_SECRET: SECRETO,
      ALMACENAMIENTO_PROVEEDOR: 'memoria',
      CORS_ORIGENES: 'https://a.test, https://b.test',
    });
    expect(cfg.baseDatosUrl).toBe('postgres://l/test');
    expect(cfg.cola.proveedor).toBe('memoria');
    expect(cfg.http.corsOrigenes).toEqual(['https://a.test', 'https://b.test']);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  test('la configuración del proceso de pruebas es válida', () => {
    expect(config().esPrueba).toBe(true);
  });
});

describe('JWT de acceso', () => {
  test('firma y verifica sub, rol y sid', () => {
    const { token, expiraEn } = firmarAcceso({ sub: 'u1', rol: 'familia', sid: 's1' });
    const datos = verificarAcceso(token);
    expect(datos).toEqual(expect.objectContaining({ sub: 'u1', rol: 'familia', sid: 's1' }));
    const minutos = (new Date(expiraEn) - Date.now()) / 60000;
    expect(minutos).toBeGreaterThan(14);
    expect(minutos).toBeLessThanOrEqual(15);
  });

  test('un token alterado responde NO_AUTENTICADO', () => {
    const { token } = firmarAcceso({ sub: 'u1', rol: 'familia', sid: 's1' });
    expect(() => verificarAcceso(`${token}x`)).toThrow(
      expect.objectContaining({ status: 401, codigo: 'NO_AUTENTICADO' }),
    );
  });

  test('un token firmado con otro secreto no se acepta', () => {
    const ajeno = jwt.sign({ rol: 'administrador', sid: 's' }, 'otro-secreto-'.repeat(4), {
      subject: 'u1',
      issuer: 'vanguardia-api',
      audience: 'vanguardia-app',
    });
    expect(() => verificarAcceso(ajeno)).toThrow(
      expect.objectContaining({ codigo: 'NO_AUTENTICADO' }),
    );
  });

  test('un token vencido responde TOKEN_VENCIDO', () => {
    const vencido = jwt.sign(
      { rol: 'familia', sid: 's1', exp: Math.floor(Date.now() / 1000) - 10 },
      config().jwt.secreto,
      { subject: 'u1', issuer: 'vanguardia-api', audience: 'vanguardia-app' },
    );
    expect(() => verificarAcceso(vencido)).toThrow(
      expect.objectContaining({ status: 401, codigo: 'TOKEN_VENCIDO' }),
    );
  });
});

describe('paginación', () => {
  test('valores por defecto y offset', () => {
    expect(leerPaginacion({})).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(leerPaginacion({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, offset: 20 });
  });

  test('limit mayor a 100 es un error de validación', () => {
    expect(() => leerPaginacion({ limit: '500' })).toThrow(
      expect.objectContaining({ codigo: 'VALIDACION', campos: { 'query.limit': 'MUY_GRANDE' } }),
    );
  });

  test('respuesta paginada con el formato común', () => {
    expect(respuestaPaginada({ datos: [1], total: 30, page: 2, limit: 1 })).toEqual({
      datos: [1],
      paginacion: { page: 2, limit: 1, total: 30 },
    });
  });
});
