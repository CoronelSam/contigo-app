'use strict';

const request = require('supertest');
const { crearApp } = require('../../src/app');

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

module.exports = { api, obtenerApp };
