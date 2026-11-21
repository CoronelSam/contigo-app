'use strict';

// Controladores de /me*.

const servicio = require('./perfil.service');

module.exports = {
  async obtener(req, res) {
    res.json(await servicio.obtenerPerfil(req.usuario));
  },

  async actualizar(req, res) {
    res.json(await servicio.actualizarPerfil(req.usuario, req.validado.body));
  },

  async cambiarContrasena(req, res) {
    await servicio.cambiarContrasena(req.usuario, req.validado.body);
    res.status(204).end();
  },

  async obtenerPreferencias(req, res) {
    res.json(await servicio.obtenerPreferencias(req.usuario));
  },

  async guardarPreferencias(req, res) {
    res.json(await servicio.guardarPreferencias(req.usuario, req.validado.body));
  },

  async registrarDispositivo(req, res) {
    res.json(await servicio.registrarDispositivo(req.usuario, req.validado.body));
  },
};
