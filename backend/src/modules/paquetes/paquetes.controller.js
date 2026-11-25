'use strict';

const paquetes = require('./paquetes.service');
const envios = require('./envios.service');
const plantillas = require('./plantillas.service');

const id = (req) => req.validado.params.id;
const body = (req) => req.validado.body;

// --- Paquete PDF

async function solicitar(req, res) {
  const creado = await paquetes.solicitarPaquete(req.usuario, id(req), body(req));
  res.status(202).location(`/api/v1/paquetes/${creado.id}`).json(creado);
}

async function obtener(req, res) {
  res.json(await paquetes.obtenerPaquete(req.usuario, id(req)));
}

async function pagina(req, res) {
  res.json(await paquetes.pagina(req.usuario, id(req), req.validado.params.n));
}

async function enlace(req, res) {
  res.json(await paquetes.enlace(req.usuario, id(req)));
}

// --- Envío y respuesta

async function registrarEnvio(req, res) {
  res.status(201).json(await envios.registrarEnvio(req.usuario, id(req), body(req)));
}

async function registrarRespuesta(req, res) {
  res.status(201).json(await envios.registrarRespuesta(req.usuario, id(req), body(req)));
}

// --- Plantillas (administración)

async function listarPlantillas(req, res) {
  res.json(await plantillas.listar(req.validado.query ?? {}));
}

async function registrarPlantilla(req, res) {
  res.status(201).json(await plantillas.registrar(req.file?.buffer, body(req)));
}

async function cambiarPlantilla(req, res) {
  res.json(await plantillas.cambiar(id(req), body(req)));
}

module.exports = {
  solicitar,
  obtener,
  pagina,
  enlace,
  registrarEnvio,
  registrarRespuesta,
  listarPlantillas,
  registrarPlantilla,
  cambiarPlantilla,
};
