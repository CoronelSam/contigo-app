'use strict';

const express = require('express');
const request = require('supertest');
const { crearApp } = require('../../src/app');
const { middlewareContexto } = require('../../src/core/contexto');
const { manejadorErrores, rutaNoEncontrada } = require('../../src/core/errores/manejador');

let app;

/** App compartida dentro del archivo de prueba. */
function obtenerApp() {
  app ??= crearApp();
  return app;
}

/** Cliente supertest: `await api().get('/health').expect(200)`. */
function api() {
  return request(obtenerApp());
}

/**
 * Cliente supertest sobre un router suelto con el mismo andamiaje que la API
 * (JSON, contexto de petición, 404 y manejador de errores). Útil para probar middlewares.
 * @param {import('express').Router} router
 */
function appDePrueba(router) {
  const aplicacion = express();
  aplicacion.use(express.json({ limit: '1mb' }));
  aplicacion.use(middlewareContexto);
  aplicacion.use(router);
  aplicacion.use(rutaNoEncontrada);
  aplicacion.use(manejadorErrores);
  return request(aplicacion);
}

module.exports = { api, obtenerApp, appDePrueba };
