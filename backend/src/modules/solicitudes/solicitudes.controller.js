'use strict';

const solicitudes = require('./solicitudes.service');
const secciones = require('./secciones.service');
const { guardarProfesional } = require('./profesional.service');
const consentimientos = require('./consentimientos.service');
const { obtenerSeguimiento } = require('./seguimiento.service');
const { idiomaDe } = require('./solicitudes.util');

// --- Solicitud

async function crear(req, res) {
  res.status(201).json(await solicitudes.crearSolicitud(req.usuario, req.validado.body));
}

async function modalidad(req, res) {
  res.json(
    await solicitudes.elegirModalidad(req.usuario, req.validado.params.id, req.validado.body),
  );
}

async function obtener(req, res) {
  res.json(await solicitudes.obtenerResumen(req.usuario, req.validado.params.id));
}

async function enviar(req, res) {
  res.json(await solicitudes.enviar(req.usuario, req.validado.params.id));
}

async function seguimiento(req, res) {
  res.json(await obtenerSeguimiento(req.usuario, req.validado.params.id));
}

async function profesional(req, res) {
  res.json(await guardarProfesional(req.usuario, req.validado.params.id, req.validado.body));
}

// --- Secciones

async function obtenerSeccion(req, res) {
  const { id, seccion } = req.validado.params;
  const resultado = await secciones.obtenerSeccion(req.usuario, id, seccion);
  res.set('ETag', secciones.etag(resultado.version)).json(resultado);
}

async function guardarSeccion(req, res) {
  const { id, seccion } = req.validado.params;
  try {
    const resultado = await secciones.guardarSeccion(
      req.usuario,
      id,
      seccion,
      req.validado.body,
      req.get('if-match'),
    );
    res.set('ETag', secciones.etag(resultado.version)).json(resultado);
  } catch (err) {
    // 412 con la versión actual para que la app recargue la sección.
    if (err.codigo !== 'SECCION_VERSION_CONFLICTO') throw err;
    res
      .status(412)
      .set('ETag', secciones.etag(err.versionActual))
      .json({ codigo: err.codigo, mensaje: err.message, versionActual: err.versionActual });
  }
}

// --- Consentimientos

async function textos(req, res) {
  const idioma = req.validado.query.idioma ?? idiomaDe(req.usuario);
  res.json(await consentimientos.textosVigentes(idioma));
}

async function abrirTexto(req, res) {
  res.json(
    await consentimientos.registrarApertura(req.usuario, req.validado.params.id, req.validado.body),
  );
}

async function decidir(req, res) {
  const { id, tipo } = req.validado.params;
  res.json(await consentimientos.decidir(req.usuario, id, tipo, req.validado.body));
}

module.exports = {
  crear,
  modalidad,
  obtener,
  enviar,
  seguimiento,
  profesional,
  obtenerSeccion,
  guardarSeccion,
  textos,
  abrirTexto,
  decidir,
};
