'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { z } = require('../src/openapi/zod');
const { MODULOS } = require('../src/routes');
const { registrarRuta, generarDocumento } = require('../src/openapi/registro');
const { api } = require('./helpers/app');
const almacenamiento = require('../src/core/almacenamiento');

describe('estructura de módulos', () => {
  test('los 11 módulos de negocio más salud existen y exportan un router', () => {
    expect(MODULOS).toHaveLength(11);
    for (const modulo of [...MODULOS, 'salud']) {
      const router = require(path.join('..', 'src', 'modules', modulo));
      expect(typeof router).toBe('function');
      expect(fs.existsSync(path.join(__dirname, '..', 'src', 'modules', modulo, 'README.md'))).toBe(
        true,
      );
    }
  });
});

describe('OpenAPI', () => {
  test('registrarRuta convierte la ruta y agrega los errores comunes', () => {
    registrarRuta({
      metodo: 'get',
      ruta: '/prueba/:id/hijos/:hijoId',
      resumen: 'Ruta de prueba',
      etiquetas: ['Prueba'],
      params: z.object({ id: z.uuid(), hijoId: z.uuid() }),
      respuestas: { 200: { descripcion: 'Bien', esquema: z.object({ ok: z.boolean() }) } },
      errores: [409],
    });
    const doc = generarDocumento();
    const operacion = doc.paths['/api/v1/prueba/{id}/hijos/{hijoId}'].get;
    expect(Object.keys(operacion.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
    ]);
    expect(operacion.security).toEqual([{ bearerAuth: [] }]);
  });

  test('el documento es OpenAPI 3.1 con /health, error común y seguridad JWT', () => {
    const doc = generarDocumento();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/health'].get.security).toEqual([]);
    expect(doc.components.schemas.Error).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth).toEqual(
      expect.objectContaining({ type: 'http', scheme: 'bearer' }),
    );
  });

  test('GET /openapi.json y GET /docs responden cuando están habilitados', async () => {
    const res = await api().get('/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    await api().get('/docs/').expect(200);
  });
});

describe('almacenamiento en memoria (pruebas)', () => {
  test('sube, comprueba, lee y firma URL', async () => {
    await almacenamiento.subirObjeto({ clave: 'prueba/a.txt', cuerpo: 'hola', mime: 'text/plain' });
    expect(await almacenamiento.existeObjeto('prueba/a.txt')).toBe(true);
    expect(await almacenamiento.existeObjeto('prueba/no.txt')).toBe(false);
    let texto = '';
    for await (const parte of await almacenamiento.leerObjeto('prueba/a.txt')) texto += parte;
    expect(texto).toBe('hola');
    expect(await almacenamiento.urlFirmadaGet('prueba/a.txt')).toMatch(/^memoria:\/\/.*expira=\d+/);
  });
});
