'use strict';

// Controladores de /auth/*: leen req.validado, llaman al servicio y responden.

const servicio = require('./auth.service');

const meta = (req) => ({ ip: req.ip ?? null, dispositivo: req.contexto?.dispositivo ?? null });

const RESPUESTA_RECUPERACION = {
  mensaje: 'Si el correo está registrado, enviaremos las instrucciones para recuperar el acceso',
};

module.exports = {
  async registrar(req, res) {
    res.status(201).json(await servicio.registrar(req.validado.body, meta(req)));
  },

  async iniciarSesion(req, res) {
    res.json(await servicio.iniciarSesion(req.validado.body, meta(req)));
  },

  async refrescar(req, res) {
    res.json(await servicio.refrescar(req.validado.body, meta(req)));
  },

  async cerrarSesion(req, res) {
    await servicio.cerrarSesion(req.usuario, req.validado.body);
    res.status(204).end();
  },

  async olvidarContrasena(req, res) {
    await servicio.olvidarContrasena(req.validado.body);
    res.status(202).json(RESPUESTA_RECUPERACION);
  },

  async restablecerContrasena(req, res) {
    await servicio.restablecerContrasena(req.validado.body);
    res.status(204).end();
  },

  async verificarCorreo(req, res) {
    await servicio.verificarCorreo(req.validado.body);
    res.status(204).end();
  },

  async reenviarVerificacion(req, res) {
    await servicio.reenviarVerificacion(req.usuario);
    res.status(202).json({ mensaje: 'Enviamos un nuevo enlace de verificación a tu correo' });
  },
};
