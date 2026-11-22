'use strict';

const documentos = require('./documentos.service');
const paginas = require('./paginas.service');
const correcciones = require('./correcciones.service');
const { urlDeArchivo } = require('./archivos.service');

const p = (req) => req.validado.params;
const b = (req) => req.validado.body;

// --- Documentos

async function requisitos(req, res) {
  res.json(await documentos.listarRequisitos(req.usuario, p(req).id));
}

async function tipo(req, res) {
  res.set('Cache-Control', 'private, max-age=3600');
  res.json(await documentos.obtenerTipo(req.usuario, p(req).id));
}

async function crear(req, res) {
  const { creado, documento } = await documentos.crearDocumento(req.usuario, p(req).id, b(req));
  res.status(creado ? 201 : 200).json(documento);
}

async function obtener(req, res) {
  res.json(await documentos.obtenerDocumento(req.usuario, p(req).id));
}

async function finalizar(req, res) {
  res.json(await documentos.finalizar(req.usuario, p(req).id, b(req)));
}

async function cancelar(req, res) {
  res.json(await documentos.cancelar(req.usuario, p(req).id));
}

async function validar(req, res) {
  res.json(await documentos.validar(req.usuario, p(req).id));
}

// --- Páginas

async function agregarPagina(req, res) {
  const { creada, pagina } = await paginas.agregarPagina(
    req.usuario,
    p(req).id,
    req.file?.buffer,
    b(req),
  );
  res.status(creada ? 201 : 200).json(pagina);
}

async function borrarPagina(req, res) {
  await paginas.borrarPagina(req.usuario, p(req).id, p(req).pid);
  res.status(204).end();
}

async function reordenar(req, res) {
  res.json(await paginas.reordenar(req.usuario, p(req).id, b(req)));
}

// --- Correcciones

async function rechazar(req, res) {
  res
    .status(201)
    .json(await correcciones.pedirNuevaCaptura(req.usuario, p(req).id, b(req), { rechazo: true }));
}

async function nuevaCaptura(req, res) {
  res.status(201).json(await correcciones.pedirNuevaCaptura(req.usuario, p(req).id, b(req)));
}

async function listarCorrecciones(req, res) {
  res.json(await correcciones.listar(req.usuario, p(req).id, req.validado.query));
}

async function corregirSeccion(req, res) {
  res.status(201).json(await correcciones.corregirSeccion(req.usuario, p(req).id, b(req)));
}

// --- Archivos

async function urlArchivo(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(await urlDeArchivo(req.usuario, p(req).id));
}

module.exports = {
  requisitos,
  tipo,
  crear,
  obtener,
  finalizar,
  cancelar,
  validar,
  agregarPagina,
  borrarPagina,
  reordenar,
  rechazar,
  nuevaCaptura,
  listarCorrecciones,
  corregirSeccion,
  urlArchivo,
};
