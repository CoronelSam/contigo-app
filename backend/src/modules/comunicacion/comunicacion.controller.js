'use strict';

const mensajes = require('./mensajes.service');
const notificaciones = require('./notificaciones.service');

const id = (req) => req.validado.params.id;

// --- Chat del caso

async function listarMensajes(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(await mensajes.listar(req.usuario, id(req), req.validado.query));
}

async function enviarMensaje(req, res) {
  res
    .status(201)
    .json(await mensajes.enviar(req.usuario, id(req), req.validado.body, req.file?.buffer));
}

async function marcarLeidos(req, res) {
  res.json(await mensajes.marcarLeidos(req.usuario, id(req), req.validado.body));
}

// --- Bandeja de notificaciones

async function listarNotificaciones(req, res) {
  res.json(await notificaciones.listar(req.usuario, req.validado.query));
}

async function marcarLeida(req, res) {
  res.json(await notificaciones.marcarLeida(req.usuario, id(req)));
}

async function leerTodas(req, res) {
  res.json(await notificaciones.leerTodas(req.usuario));
}

module.exports = {
  listarMensajes,
  enviarMensaje,
  marcarLeidos,
  listarNotificaciones,
  marcarLeida,
  leerTodas,
};
