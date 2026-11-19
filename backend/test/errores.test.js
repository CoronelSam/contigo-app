'use strict';

const express = require('express');
const request = require('supertest');
const { z } = require('../src/openapi/zod');
const { conflicto, noEncontrado, NoImplementado } = require('../src/core/errores');
const { manejadorErrores, rutaNoEncontrada } = require('../src/core/errores/manejador');
const { validar } = require('../src/core/http/validar');
const { api } = require('./helpers/app');

function appDePrueba() {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.get('/conflicto', async () => {
    throw conflicto('PRUEBA_BLOQUEADA', 'Bloqueado por faltantes', { documento: 'FALTA' });
  });
  app.get('/no-encontrado', async () => {
    throw noEncontrado();
  });
  app.get('/no-implementado', async () => {
    throw new NoImplementado('La prueba');
  });
  app.get('/fallo', async () => {
    throw new Error('secreto interno de la base');
  });
  app.get('/zod-suelto', () => {
    z.object({ a: z.string() }).parse({ a: 1 });
  });
  app.post(
    '/validar/:id',
    validar({
      params: z.object({ id: z.uuid() }),
      query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
      body: z.strictObject({
        correo: z.email(),
        nombres: z.string().min(2),
        edad: z.number().int().min(0),
      }),
    }),
    (req, res) => res.json(req.validado),
  );
  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return request(app);
}

describe('formato común de errores', () => {
  test('un AppError lanzado en un handler async llega como { codigo, mensaje, campos }', async () => {
    const res = await appDePrueba().get('/conflicto').expect(409);
    expect(res.body).toEqual({
      codigo: 'PRUEBA_BLOQUEADA',
      mensaje: 'Bloqueado por faltantes',
      campos: { documento: 'FALTA' },
    });
  });

  test('sin campos no se envía la propiedad campos', async () => {
    const res = await appDePrueba().get('/no-encontrado').expect(404);
    expect(res.body).toEqual({ codigo: 'NO_ENCONTRADO', mensaje: 'Recurso no encontrado' });
  });

  test('NoImplementado responde 501', async () => {
    const res = await appDePrueba().get('/no-implementado').expect(501);
    expect(res.body.codigo).toBe('NO_IMPLEMENTADO');
  });

  test('un error inesperado responde 500 sin detalles internos', async () => {
    const res = await appDePrueba().get('/fallo').expect(500);
    expect(res.body).toEqual({ codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado' });
  });

  test('un ZodError suelto se convierte en 400 VALIDACION', async () => {
    const res = await appDePrueba().get('/zod-suelto').expect(400);
    expect(res.body.codigo).toBe('VALIDACION');
    expect(res.body.campos).toEqual({ a: 'TIPO_INVALIDO' });
  });

  test('validar() devuelve códigos por campo de params, query y body', async () => {
    const res = await appDePrueba()
      .post('/validar/no-es-uuid?page=0')
      .send({ correo: 'mal', edad: 'diez', extra: true })
      .expect(400);
    expect(res.body.codigo).toBe('VALIDACION');
    expect(res.body.campos).toEqual({
      'params.id': 'FORMATO_INVALIDO',
      'query.page': 'MUY_PEQUENO',
      correo: 'FORMATO_INVALIDO',
      nombres: 'REQUERIDO',
      edad: 'TIPO_INVALIDO',
      extra: 'CAMPO_NO_PERMITIDO',
    });
  });

  test('validar() deja los datos parseados en req.validado', async () => {
    const id = '7d4f3c0e-6f1a-4b8e-9a51-2a3c4d5e6f70';
    const res = await appDePrueba()
      .post(`/validar/${id}`)
      .send({ correo: 'familia.demo@vanguardia.test', nombres: 'Ana', edad: 7 })
      .expect(200);
    expect(res.body).toEqual({
      params: { id },
      query: { page: 1 },
      body: { correo: 'familia.demo@vanguardia.test', nombres: 'Ana', edad: 7 },
    });
  });

  test('JSON mal formado responde 400 JSON_INVALIDO', async () => {
    const res = await appDePrueba()
      .post('/validar/x')
      .set('Content-Type', 'application/json')
      .send('{mal')
      .expect(400);
    expect(res.body.codigo).toBe('JSON_INVALIDO');
  });

  test('un cuerpo demasiado grande responde 413', async () => {
    const res = await appDePrueba()
      .post('/validar/x')
      .send({ texto: 'x'.repeat(5000) })
      .expect(413);
    expect(res.body.codigo).toBe('CUERPO_DEMASIADO_GRANDE');
  });

  test('una ruta inexistente de la API responde 404 con el formato común', async () => {
    const res = await api().get('/api/v1/no-existe').expect(404);
    expect(res.body).toEqual({
      codigo: 'RUTA_NO_ENCONTRADA',
      mensaje: 'La ruta solicitada no existe',
    });
  });
});
