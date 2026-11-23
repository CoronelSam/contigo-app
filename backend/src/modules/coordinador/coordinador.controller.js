'use strict';

const tablero = require('./tablero.service');
const expediente = require('./expediente.service');

const id = (req) => req.validado.params.id;

async function resumen(req, res) {
  res.json(await tablero.resumen(req.usuario));
}

async function actividad(req, res) {
  res.json(await tablero.actividad(req.usuario, req.validado.query));
}

async function listar(req, res) {
  res.json(await tablero.tablero(req.usuario, req.validado.query));
}

async function historiaClinica(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(await expediente.historiaClinica(req.usuario, id(req)));
}

async function bitacora(req, res) {
  res.json(await expediente.bitacora(req.usuario, id(req), req.validado.query));
}

async function validacion(req, res) {
  res.json(await expediente.validacion(req.usuario, id(req)));
}

async function confirmar(req, res) {
  res.json(await expediente.confirmarCompleto(req.usuario, id(req), req.validado.body));
}

module.exports = { resumen, actividad, listar, historiaClinica, bitacora, validacion, confirmar };
