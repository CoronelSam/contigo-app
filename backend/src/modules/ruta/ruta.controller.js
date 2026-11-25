'use strict';

const evaluaciones = require('./evaluaciones.service');
const derivaciones = require('./derivaciones.service');
const admin = require('./admin.service');

const id = (req) => req.validado.params.id;
const body = (req) => req.validado.body;
const query = (req) => req.validado.query ?? {};

// --- Decisión de ruta

async function rutaSugerida(req, res) {
  res.json(await evaluaciones.rutaSugerida(req.usuario, id(req)));
}

async function registrarEvaluacion(req, res) {
  res.status(201).json(await evaluaciones.registrarEvaluacion(req.usuario, id(req), body(req)));
}

async function listarEvaluaciones(req, res) {
  res.json(await evaluaciones.listarEvaluaciones(req.usuario, id(req)));
}

async function reabrir(req, res) {
  res.json(await evaluaciones.reabrirEvaluacion(req.usuario, id(req), body(req)));
}

async function rutaFamilia(req, res) {
  res.json(await evaluaciones.rutaParaFamilia(req.usuario, id(req)));
}

// --- Honduras

async function proveedores(req, res) {
  res.json(await derivaciones.proveedoresDisponibles(query(req)));
}

async function derivar(req, res) {
  res.status(201).json(await derivaciones.derivar(req.usuario, id(req), body(req)));
}

async function cambiarDerivacion(req, res) {
  res.json(await derivaciones.cambiarDerivacion(req.usuario, id(req), body(req)));
}

// --- Administración

async function listarProveedoresAdmin(req, res) {
  res.json(await admin.listarProveedores(query(req)));
}

async function crearProveedor(req, res) {
  res.status(201).json(await admin.crearProveedor(body(req)));
}

async function cambiarProveedor(req, res) {
  res.json(await admin.cambiarProveedor(id(req), body(req)));
}

async function listarReglas(req, res) {
  res.json(await admin.listarReglas(query(req)));
}

async function crearRegla(req, res) {
  res.status(201).json(await admin.crearRegla(body(req)));
}

async function cambiarRegla(req, res) {
  res.json(await admin.cambiarRegla(id(req), body(req)));
}

async function activarVersion(req, res) {
  res.json(await admin.activarVersion(req.validado.params.version));
}

module.exports = {
  rutaSugerida,
  registrarEvaluacion,
  listarEvaluaciones,
  reabrir,
  rutaFamilia,
  proveedores,
  derivar,
  cambiarDerivacion,
  listarProveedoresAdmin,
  crearProveedor,
  cambiarProveedor,
  listarReglas,
  crearRegla,
  cambiarRegla,
  activarVersion,
};
