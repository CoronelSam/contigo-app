'use strict';

const asignaciones = require('./asignaciones.service');
const casos = require('./casos.service');

async function crear(req, res) {
  res
    .status(201)
    .json(
      await asignaciones.crearAsignacion(req.usuario, req.validado.params.id, req.validado.body),
    );
}

async function cambiar(req, res) {
  res.json(
    await asignaciones.cambiarAsignacion(req.usuario, req.validado.params.id, req.validado.body),
  );
}

async function resumen(req, res) {
  res.json(await casos.resumen(req.usuario));
}

async function listar(req, res) {
  res.json(await casos.listarCasos(req.usuario, req.validado.query));
}

module.exports = { crear, cambiar, resumen, listar };
