'use strict';

// Catálogos, contactos oficiales y artículos de ayuda (lectura para todos los roles).

const { validacion } = require('../../core/errores');
const errores = require('./familias.errores');
const { localizar } = require('./familias.util');

const modelos = () => require('../../models');

/** 18 departamentos en orden de código. */
async function departamentos() {
  const filas = await modelos().Departamento.findAll({ order: [['codigo', 'ASC']] });
  return filas.map((d) => ({ codigo: d.codigo, nombre: d.nombre }));
}

/** Municipios de un departamento; 404 si el departamento no existe. */
async function municipiosDe(departamentoCodigo) {
  const { Departamento, Municipio } = modelos();
  if (!(await Departamento.findByPk(departamentoCodigo))) throw errores.departamentoNoEncontrado();
  const filas = await Municipio.findAll({
    where: { departamentoCodigo },
    order: [['codigo', 'ASC']],
  });
  return filas.map((m) => ({ codigo: m.codigo, nombre: m.nombre }));
}

/**
 * Ítems activos de un catálogo con la etiqueta en el idioma pedido.
 * @param {string} tipo
 * @param {'es' | 'en'} idioma
 */
async function catalogo(tipo, idioma) {
  const { CatalogoItem } = modelos();
  if (!(await CatalogoItem.count({ where: { tipo } }))) throw errores.catalogoNoEncontrado();
  const filas = await CatalogoItem.findAll({
    where: { tipo, activo: true },
    order: [
      ['orden', 'ASC'],
      ['codigo', 'ASC'],
    ],
  });
  return filas.map((i) => ({
    codigo: i.codigo,
    etiqueta: idioma === 'en' ? i.etiquetaEn : i.etiquetaEs,
    orden: i.orden,
    metadatos: i.metadatos ?? {},
  }));
}

async function configuracion(clave) {
  return (await modelos().Configuracion.findByPk(clave))?.valor ?? null;
}

/** Contactos oficiales (pantalla 33) con los textos en el idioma pedido. */
async function contactos(idioma) {
  return localizar((await configuracion('contactos.oficiales')) ?? {}, idioma);
}

/** Artículos de ayuda (pantalla 33) en el idioma pedido. */
async function articulosAyuda(idioma) {
  const valor = (await configuracion('ayuda.articulos')) ?? {};
  return valor[idioma] ?? valor.es ?? [];
}

/**
 * Comprueba que el municipio exista y, si se envía, que sea del departamento.
 * @returns {Promise<object>} El municipio.
 */
async function validarMunicipio(departamentoCodigo, municipioCodigo, { transaction } = {}) {
  const municipio = await modelos().Municipio.findByPk(municipioCodigo, { transaction });
  if (!municipio) throw validacion({ municipioCodigo: 'NO_EXISTE' }, 'El municipio no existe');
  if (departamentoCodigo && municipio.departamentoCodigo !== departamentoCodigo) {
    throw errores.municipioInvalido();
  }
  return municipio;
}

/** El parentesco debe ser un código activo del catálogo. */
async function validarParentesco(codigo, { transaction } = {}) {
  const item = await modelos().CatalogoItem.findOne({
    where: { tipo: 'parentesco', codigo, activo: true },
    transaction,
  });
  if (!item) throw errores.parentescoInvalido();
}

module.exports = {
  departamentos,
  municipiosDe,
  catalogo,
  contactos,
  articulosAyuda,
  validarMunicipio,
  validarParentesco,
};
