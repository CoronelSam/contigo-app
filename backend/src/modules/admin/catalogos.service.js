'use strict';

// Catálogo de documentos (54), requisitos por ruta y catálogos bilingües.
// Nada se borra: `activo = false`. La obligatoriedad vive en `requisitos_ruta`, no en el tipo.
// Desactivar un requisito solo cambia la lista que se pide desde ese momento; los documentos ya
// capturados no cambian.

const { UniqueConstraintError } = require('sequelize');
const { registrarBitacora, auditarCambio } = require('../../core/auditoria');
const { esUuid } = require('../../core/acceso');
const { validacion } = require('../../core/errores');
const { LISTA_RUTAS_REQUISITO } = require('../../core/estados/constantes');
const errores = require('./admin.errores');

const modelos = () => require('../../models');

const iso = (fecha) => (fecha ? fecha.toISOString() : null);

/** Cambiar estos campos de un tipo de documento sube su `version`. */
const CAMPOS_VERSIONADOS = Object.freeze([
  'nombreEs',
  'nombreEn',
  'paraQueSirveEs',
  'paraQueSirveEn',
  'comoFotografiarEs',
  'comoFotografiarEn',
  'plantillaId',
]);

/** Textos de ayuda que van en los dos idiomas o en ninguno. */
const PARES_BILINGUES = Object.freeze([
  ['paraQueSirveEs', 'paraQueSirveEn'],
  ['comoFotografiarEs', 'comoFotografiarEn'],
]);

// --- Tipos de documento

function formatearTipo(t) {
  return {
    id: t.id,
    codigo: t.codigo,
    nombreEs: t.nombreEs,
    nombreEn: t.nombreEn,
    categoria: t.categoria,
    paraQueSirveEs: t.paraQueSirveEs ?? null,
    paraQueSirveEn: t.paraQueSirveEn ?? null,
    comoFotografiarEs: t.comoFotografiarEs ?? null,
    comoFotografiarEn: t.comoFotografiarEn ?? null,
    admiteVariasPaginas: t.admiteVariasPaginas,
    paginasEsperadas: t.paginasEsperadas ?? null,
    plantillaId: t.plantillaId ?? null,
    version: t.version,
    activo: t.activo,
    actualizadoEn: iso(t.updatedAt),
  };
}

/** Reglas que dependen de varios campos, sobre el tipo ya combinado con los cambios. */
async function validarTipo(tipo, transaction) {
  const campos = {};
  for (const [es, en] of PARES_BILINGUES) {
    if (tipo[es] && !tipo[en]) campos[en] = 'REQUERIDO';
    if (tipo[en] && !tipo[es]) campos[es] = 'REQUERIDO';
  }
  if (Object.keys(campos).length) {
    throw validacion(campos, 'Los textos de ayuda van en español y en inglés');
  }
  if (tipo.admiteVariasPaginas === false && tipo.paginasEsperadas > 1) {
    throw errores.paginasIncompatibles();
  }
  if (tipo.plantillaId) {
    const { PlantillaFormulario } = modelos();
    const existe = await PlantillaFormulario.findByPk(tipo.plantillaId, {
      attributes: ['id'],
      transaction,
    });
    if (!existe) throw errores.plantillaNoExiste();
  }
}

/** GET /admin/tipos-documento: también los inactivos. */
async function listarTipos({ categoria, activo } = {}) {
  const { TipoDocumento } = modelos();
  const where = {};
  if (categoria) where.categoria = categoria;
  if (activo !== undefined) where.activo = activo;
  const filas = await TipoDocumento.findAll({ where, order: [['codigo', 'ASC']] });
  return filas.map(formatearTipo);
}

/** POST /admin/tipos-documento */
async function crearTipo(datos) {
  const { sequelize, TipoDocumento } = modelos();
  try {
    return await sequelize.transaction(async (transaction) => {
      const nuevo = { admiteVariasPaginas: true, ...datos };
      await validarTipo(nuevo, transaction);
      if (await TipoDocumento.findOne({ where: { codigo: datos.codigo }, transaction })) {
        throw errores.tipoCodigoExiste();
      }
      const tipo = await TipoDocumento.create(
        { ...nuevo, version: 1, activo: true },
        { transaction },
      );
      await registrarBitacora({
        accion: 'tipos_documento.crear',
        entidad: 'tipos_documento',
        entidadId: tipo.id,
        despues: { codigo: tipo.codigo, categoria: tipo.categoria },
        transaction,
      });
      return formatearTipo(tipo);
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw errores.tipoCodigoExiste();
    throw err;
  }
}

/** PATCH /admin/tipos-documento/:id */
async function cambiarTipo(id, cambios) {
  if (!esUuid(id)) throw errores.tipoNoEncontrado();
  const { sequelize, TipoDocumento, RequisitoRuta } = modelos();
  return sequelize.transaction(async (transaction) => {
    const tipo = await TipoDocumento.findByPk(id, { lock: transaction.LOCK.UPDATE, transaction });
    if (!tipo) throw errores.tipoNoEncontrado();
    await validarTipo({ ...tipo.get(), ...cambios }, transaction);

    if (cambios.activo === false && tipo.activo) {
      const activos = await RequisitoRuta.findAll({
        where: { tipoDocumentoId: tipo.id, activo: true },
        attributes: ['ruta'],
        transaction,
      });
      if (activos.length) throw errores.tipoConRequisitos(activos.map((r) => r.ruta).sort());
    }

    const datos = { ...cambios };
    const versionado = CAMPOS_VERSIONADOS.some(
      (campo) => campo in cambios && (cambios[campo] ?? null) !== (tipo.get(campo) ?? null),
    );
    if (versionado) datos.version = tipo.version + 1;
    await auditarCambio(tipo, datos, { transaction, accion: 'tipos_documento.actualizar' });
    return formatearTipo(tipo);
  });
}

// --- Requisitos por ruta

const ordenRuta = (ruta) => LISTA_RUTAS_REQUISITO.indexOf(ruta);

function formatearRequisito(r) {
  return {
    id: r.id,
    ruta: r.ruta,
    tipoDocumento: {
      id: r.tipoDocumento.id,
      codigo: r.tipoDocumento.codigo,
      nombreEs: r.tipoDocumento.nombreEs,
      nombreEn: r.tipoDocumento.nombreEn,
      activo: r.tipoDocumento.activo,
    },
    obligatorio: r.obligatorio,
    orden: r.orden,
    cubiertoPorSecciones: r.cubiertoPorSecciones ?? [],
    activo: r.activo,
    actualizadoEn: iso(r.updatedAt),
  };
}

const INCLUIR_TIPO = [
  { association: 'tipoDocumento', attributes: ['id', 'codigo', 'nombreEs', 'nombreEn', 'activo'] },
];

async function requisitoFormateado(id, transaction) {
  const { RequisitoRuta } = modelos();
  return formatearRequisito(
    await RequisitoRuta.findByPk(id, { include: INCLUIR_TIPO, transaction }),
  );
}

/** GET /admin/requisitos-ruta: en el orden de las rutas y, dentro de cada una, por `orden`. */
async function listarRequisitos({ ruta, tipoDocumentoId, activo } = {}) {
  const { RequisitoRuta } = modelos();
  const where = {};
  if (ruta) where.ruta = ruta;
  if (tipoDocumentoId) where.tipoDocumentoId = tipoDocumentoId;
  if (activo !== undefined) where.activo = activo;
  const filas = await RequisitoRuta.findAll({
    where,
    include: INCLUIR_TIPO,
    order: [
      ['orden', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return filas.sort((a, b) => ordenRuta(a.ruta) - ordenRuta(b.ruta)).map(formatearRequisito);
}

/** POST /admin/requisitos-ruta */
async function crearRequisito(datos) {
  const { sequelize, TipoDocumento, RequisitoRuta } = modelos();
  try {
    return await sequelize.transaction(async (transaction) => {
      const tipo = await TipoDocumento.findByPk(datos.tipoDocumentoId, { transaction });
      if (!tipo) throw errores.tipoDocumentoNoExiste();
      if (!tipo.activo) throw errores.requisitoTipoInactivo();
      const repetido = await RequisitoRuta.findOne({
        where: { ruta: datos.ruta, tipoDocumentoId: tipo.id },
        attributes: ['id'],
        transaction,
      });
      if (repetido) throw errores.requisitoExiste();
      const requisito = await RequisitoRuta.create({ ...datos, activo: true }, { transaction });
      await registrarBitacora({
        accion: 'requisitos_ruta.crear',
        entidad: 'requisitos_ruta',
        entidadId: requisito.id,
        despues: {
          ruta: requisito.ruta,
          tipoDocumento: tipo.codigo,
          obligatorio: requisito.obligatorio,
        },
        transaction,
      });
      return requisitoFormateado(requisito.id, transaction);
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw errores.requisitoExiste();
    throw err;
  }
}

/** PATCH /admin/requisitos-ruta/:id */
async function cambiarRequisito(id, cambios) {
  if (!esUuid(id)) throw errores.requisitoNoEncontrado();
  const { sequelize, RequisitoRuta, TipoDocumento } = modelos();
  return sequelize.transaction(async (transaction) => {
    const requisito = await RequisitoRuta.findByPk(id, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!requisito) throw errores.requisitoNoEncontrado();
    if (cambios.activo === true && !requisito.activo) {
      const tipo = await TipoDocumento.findByPk(requisito.tipoDocumentoId, { transaction });
      if (!tipo.activo) throw errores.requisitoTipoInactivo();
    }
    await auditarCambio(requisito, cambios, { transaction, accion: 'requisitos_ruta.actualizar' });
    return requisitoFormateado(requisito.id, transaction);
  });
}

// --- Catálogos

function formatearItem(i) {
  return {
    id: i.id,
    tipo: i.tipo,
    codigo: i.codigo,
    etiquetaEs: i.etiquetaEs,
    etiquetaEn: i.etiquetaEn,
    orden: i.orden,
    activo: i.activo,
    metadatos: i.metadatos ?? {},
    actualizadoEn: iso(i.updatedAt),
  };
}

/** GET /admin/catalogos: también los inactivos. */
async function listarItems({ tipo, activo } = {}) {
  const { CatalogoItem } = modelos();
  const where = {};
  if (tipo) where.tipo = tipo;
  if (activo !== undefined) where.activo = activo;
  const filas = await CatalogoItem.findAll({
    where,
    order: [
      ['tipo', 'ASC'],
      ['orden', 'ASC'],
      ['codigo', 'ASC'],
    ],
  });
  return filas.map(formatearItem);
}

/** POST /admin/catalogos: solo en un catálogo que ya existe (los tipos los lee el código). */
async function crearItem(datos) {
  const { sequelize, CatalogoItem } = modelos();
  try {
    return await sequelize.transaction(async (transaction) => {
      if (!(await CatalogoItem.count({ where: { tipo: datos.tipo }, transaction }))) {
        throw errores.catalogoTipoNoExiste();
      }
      const repetido = await CatalogoItem.findOne({
        where: { tipo: datos.tipo, codigo: datos.codigo },
        attributes: ['id'],
        transaction,
      });
      if (repetido) throw errores.catalogoCodigoExiste();
      const item = await CatalogoItem.create({ ...datos, activo: true }, { transaction });
      await registrarBitacora({
        accion: 'catalogos_items.crear',
        entidad: 'catalogos_items',
        entidadId: item.id,
        despues: { tipo: item.tipo, codigo: item.codigo },
        transaction,
      });
      return formatearItem(item);
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw errores.catalogoCodigoExiste();
    throw err;
  }
}

/** PATCH /admin/catalogos/:id: el tipo y el código no cambian (los datos guardan el código). */
async function cambiarItem(id, cambios) {
  if (!esUuid(id)) throw errores.catalogoItemNoEncontrado();
  const { sequelize, CatalogoItem } = modelos();
  return sequelize.transaction(async (transaction) => {
    const item = await CatalogoItem.findByPk(id, { lock: transaction.LOCK.UPDATE, transaction });
    if (!item) throw errores.catalogoItemNoEncontrado();
    await auditarCambio(item, cambios, { transaction, accion: 'catalogos_items.actualizar' });
    return formatearItem(item);
  });
}

module.exports = {
  listarTipos,
  crearTipo,
  cambiarTipo,
  listarRequisitos,
  crearRequisito,
  cambiarRequisito,
  listarItems,
  crearItem,
  cambiarItem,
  CAMPOS_VERSIONADOS,
};
