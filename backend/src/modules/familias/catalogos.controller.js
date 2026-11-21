'use strict';

// Controladores de catálogos, contactos oficiales y ayuda.

const servicio = require('./catalogos.service');

const CACHE = 'private, max-age=3600';
const idiomaDe = (req) => req.validado?.query?.idioma ?? req.usuario.idioma ?? 'es';

module.exports = {
  async departamentos(req, res) {
    res.set('Cache-Control', CACHE).json(await servicio.departamentos());
  },

  async municipios(req, res) {
    res.set('Cache-Control', CACHE).json(await servicio.municipiosDe(req.validado.params.id));
  },

  async catalogo(req, res) {
    res
      .set('Cache-Control', CACHE)
      .json(await servicio.catalogo(req.validado.params.tipo, idiomaDe(req)));
  },

  async contactos(req, res) {
    res.json(await servicio.contactos(idiomaDe(req)));
  },

  async ayuda(req, res) {
    res.json(await servicio.articulosAyuda(idiomaDe(req)));
  },
};
