'use strict';

const usuarios = require('./usuarios.service');
const catalogos = require('./catalogos.service');
const configuracion = require('./configuracion.service');
const panel = require('./panel.service');
const reportes = require('./reportes.service');

const id = (req) => req.validado.params.id;
const body = (req) => req.validado.body;
const query = (req) => req.validado.query ?? {};

// --- Panel, usuarios y roles

async function resumen(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(await panel.resumen({ logger: req.log }));
}

async function listarUsuarios(req, res) {
  res.json(await usuarios.listar(query(req)));
}

async function invitarUsuario(req, res) {
  res.status(201).json(await usuarios.invitar(body(req)));
}

async function cambiarUsuario(req, res) {
  res.json(await usuarios.cambiar(req.usuario, id(req), body(req)));
}

async function roles(req, res) {
  res.json(await usuarios.roles());
}

// --- Tipos de documento, requisitos y catálogos

async function listarTipos(req, res) {
  res.json(await catalogos.listarTipos(query(req)));
}

async function crearTipo(req, res) {
  res.status(201).json(await catalogos.crearTipo(body(req)));
}

async function cambiarTipo(req, res) {
  res.json(await catalogos.cambiarTipo(id(req), body(req)));
}

async function listarRequisitos(req, res) {
  res.json(await catalogos.listarRequisitos(query(req)));
}

async function crearRequisito(req, res) {
  res.status(201).json(await catalogos.crearRequisito(body(req)));
}

async function cambiarRequisito(req, res) {
  res.json(await catalogos.cambiarRequisito(id(req), body(req)));
}

async function listarItems(req, res) {
  res.json(await catalogos.listarItems(query(req)));
}

async function crearItem(req, res) {
  res.status(201).json(await catalogos.crearItem(body(req)));
}

async function cambiarItem(req, res) {
  res.json(await catalogos.cambiarItem(id(req), body(req)));
}

// --- Configuración y reportes

async function listarConfiguracion(req, res) {
  res.json(await configuracion.listar());
}

async function cambiarConfiguracion(req, res) {
  res.json(await configuracion.cambiar(req.usuario, req.validado.params.clave, body(req).valor));
}

async function verReportes(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(await reportes.reportes(query(req)));
}

module.exports = {
  resumen,
  listarUsuarios,
  invitarUsuario,
  cambiarUsuario,
  roles,
  listarTipos,
  crearTipo,
  cambiarTipo,
  listarRequisitos,
  crearRequisito,
  cambiarRequisito,
  listarItems,
  crearItem,
  cambiarItem,
  listarConfiguracion,
  cambiarConfiguracion,
  verReportes,
};
