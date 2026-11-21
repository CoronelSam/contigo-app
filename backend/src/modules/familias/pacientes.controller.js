'use strict';

// Controladores de pacientes, tutores y resumen de la familia.

const pacientes = require('./pacientes.service');
const tutores = require('./tutores.service');

module.exports = {
  async resumen(req, res) {
    res.json(await pacientes.resumenFamilia(req.usuario));
  },

  async listar(req, res) {
    res.json(await pacientes.listarPacientes(req.usuario, req.validado.query));
  },

  async crear(req, res) {
    res.status(201).json(await pacientes.crearPaciente(req.usuario, req.validado.body));
  },

  async obtener(req, res) {
    res.json(await pacientes.obtenerPaciente(req.usuario, req.validado.params.id));
  },

  async actualizar(req, res) {
    res.json(
      await pacientes.actualizarPaciente(req.usuario, req.validado.params.id, req.validado.body),
    );
  },

  async foto(req, res) {
    res.json(await pacientes.actualizarFoto(req.usuario, req.validado.params.id, req.file));
  },

  async agregarTutor(req, res) {
    res
      .status(201)
      .json(await tutores.agregarTutor(req.usuario, req.validado.params.id, req.validado.body));
  },

  async actualizarTutor(req, res) {
    res.json(await tutores.actualizarTutor(req.usuario, req.validado.params.id, req.validado.body));
  },

  async quitarTutor(req, res) {
    await tutores.quitarVinculo(req.usuario, req.validado.params.id, req.validado.params.tutorId);
    res.status(204).end();
  },
};
