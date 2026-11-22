'use strict';

const s = require('./extracciones.service');

async function obtener(req, res) {
  res.json(await s.obtenerExtraccion(req.usuario, req.validado.params.id));
}

async function revisarCampo(req, res) {
  const { id, campoId } = req.validado.params;
  res.json(await s.revisarCampo(req.usuario, id, campoId, req.validado.body));
}

async function confirmarEnBloque(req, res) {
  res.json(await s.confirmarEnBloque(req.usuario, req.validado.params.id, req.validado.body));
}

async function confirmar(req, res) {
  res.json(await s.confirmarRevision(req.usuario, req.validado.params.id));
}

module.exports = { obtener, revisarCampo, confirmarEnBloque, confirmar };
