'use strict';

// Administración de la ruta: proveedores locales en Honduras y reglas de ruta versionadas.
// Nada se borra: un proveedor se desactiva; una versión de reglas usada no se edita (se crea otra).

const { registrarBitacora, auditarCambio } = require('../../core/auditoria');
const { esUuid } = require('../../core/acceso');
const errores = require('./ruta.errores');
const { problemaDeCondicion, versionActiva } = require('./motor');
const { HECHOS } = require('./hechos');
const { buscarProveedores, formatearProveedor, INCLUIR_LUGAR } = require('./derivaciones.service');

const modelos = () => require('../../models');

// --- Proveedores

/** Departamento y municipio existen y el municipio es del departamento. */
async function validarLugar(departamentoCodigo, municipioCodigo, transaction) {
  const { Departamento, Municipio } = modelos();
  if (!(await Departamento.findByPk(departamentoCodigo, { transaction }))) {
    throw errores.departamentoInvalido();
  }
  if (municipioCodigo) {
    const municipio = await Municipio.findByPk(municipioCodigo, { transaction });
    if (municipio?.departamentoCodigo !== departamentoCodigo) throw errores.municipioInvalido();
  }
}

/** Todas las especialidades son ítems activos del catálogo `especialidad_medica`. */
async function validarEspecialidades(especialidades, transaction) {
  const { CatalogoItem } = modelos();
  const existentes = await CatalogoItem.count({
    where: { tipo: 'especialidad_medica', codigo: especialidades, activo: true },
    transaction,
  });
  if (existentes !== new Set(especialidades).size) throw errores.catalogoInvalido('especialidades');
}

async function proveedorFormateado(id, transaction) {
  const { ProveedorLocal } = modelos();
  return formatearProveedor(
    await ProveedorLocal.findByPk(id, { include: INCLUIR_LUGAR, transaction }),
  );
}

/**
 * GET /admin/proveedores-locales: también los inactivos.
 * @param {{ especialidad?: string, departamento?: string, municipio?: string, activo?: boolean }} filtros
 */
const listarProveedores = (filtros) => buscarProveedores(filtros);

/**
 * POST /admin/proveedores-locales.
 * @param {object} cuerpo
 */
async function crearProveedor(cuerpo) {
  const { sequelize, ProveedorLocal } = modelos();
  return sequelize.transaction(async (transaction) => {
    await validarLugar(cuerpo.departamentoCodigo, cuerpo.municipioCodigo, transaction);
    await validarEspecialidades(cuerpo.especialidades, transaction);
    const proveedor = await ProveedorLocal.create(
      {
        nombre: cuerpo.nombre,
        tipo: cuerpo.tipo,
        departamentoCodigo: cuerpo.departamentoCodigo,
        municipioCodigo: cuerpo.municipioCodigo ?? null,
        especialidades: [...new Set(cuerpo.especialidades)],
        contacto: cuerpo.contacto ?? {},
        notas: cuerpo.notas ?? null,
        activo: true,
      },
      { transaction },
    );
    await registrarBitacora({
      accion: 'proveedores_locales.crear',
      entidad: 'proveedores_locales',
      entidadId: proveedor.id,
      despues: {
        nombre: proveedor.nombre,
        tipo: proveedor.tipo,
        departamento: proveedor.departamentoCodigo,
      },
      transaction,
    });
    return proveedorFormateado(proveedor.id, transaction);
  });
}

/**
 * PATCH /admin/proveedores-locales/:id. `activo: false` lo desactiva; no se borra.
 * @param {string} id
 * @param {object} cambios
 */
async function cambiarProveedor(id, cambios) {
  if (!esUuid(id)) throw errores.proveedorNoEncontrado();
  const { sequelize, ProveedorLocal } = modelos();
  return sequelize.transaction(async (transaction) => {
    const proveedor = await ProveedorLocal.findByPk(id, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!proveedor) throw errores.proveedorNoEncontrado();
    const departamento = cambios.departamentoCodigo ?? proveedor.departamentoCodigo;
    const municipio =
      cambios.municipioCodigo !== undefined ? cambios.municipioCodigo : proveedor.municipioCodigo;
    if (cambios.departamentoCodigo !== undefined || cambios.municipioCodigo !== undefined) {
      await validarLugar(departamento, municipio, transaction);
    }
    if (cambios.especialidades) await validarEspecialidades(cambios.especialidades, transaction);
    const datos = { ...cambios };
    if (datos.especialidades) datos.especialidades = [...new Set(datos.especialidades)];
    await auditarCambio(proveedor, datos, {
      transaction,
      accion: 'proveedores_locales.actualizar',
    });
    return proveedorFormateado(proveedor.id, transaction);
  });
}

// --- Reglas de ruta

function formatearRegla(r) {
  return {
    id: r.id,
    version: r.version,
    nombre: r.nombre,
    prioridad: r.prioridad,
    condicion: r.condicion,
    rutaSugerida: r.rutaSugerida,
    motivoEs: r.motivoEs,
    motivoEn: r.motivoEn,
    activa: r.activa,
  };
}

/** ¿Alguna evaluación usó esta versión? Entonces es inmutable. */
async function versionUsada(version, transaction) {
  const { Evaluacion } = modelos();
  return (await Evaluacion.count({ where: { versionReglas: version }, transaction })) > 0;
}

function exigirCondicion(condicion) {
  const problema = problemaDeCondicion(condicion);
  if (problema) throw errores.condicionInvalida(problema);
}

/**
 * GET /admin/reglas-ruta: resumen de las versiones y las reglas de una (por defecto, la activa).
 * @param {{ version?: number }} filtros
 */
async function listarReglas({ version }) {
  const { ReglaRuta, Evaluacion, sequelize } = modelos();
  const resumen = await ReglaRuta.findAll({
    attributes: [
      'version',
      [sequelize.fn('COUNT', sequelize.col('id')), 'reglas'],
      [sequelize.fn('BOOL_OR', sequelize.col('activa')), 'activa'],
    ],
    group: ['version'],
    order: [['version', 'ASC']],
    raw: true,
  });
  const usadas = await Evaluacion.findAll({
    attributes: [[sequelize.fn('DISTINCT', sequelize.col('version_reglas')), 'version']],
    raw: true,
  });
  const usadasSet = new Set(usadas.map((u) => u.version));
  const elegida = version ?? (await versionActiva());
  const reglas =
    elegida === null
      ? []
      : await ReglaRuta.findAll({
          where: { version: elegida },
          order: [
            ['prioridad', 'ASC'],
            ['nombre', 'ASC'],
          ],
        });
  return {
    versiones: resumen.map((v) => ({
      version: v.version,
      activa: v.activa === true,
      reglas: Number(v.reglas),
      usada: usadasSet.has(v.version),
    })),
    version: elegida,
    hechosDisponibles: [...HECHOS],
    reglas: reglas.map(formatearRegla),
  };
}

/**
 * POST /admin/reglas-ruta: agrega una regla a una versión (la crea si no existe). Una versión
 * nueva queda inactiva hasta activarla.
 * @param {object} cuerpo
 */
async function crearRegla(cuerpo) {
  exigirCondicion(cuerpo.condicion);
  const { sequelize, ReglaRuta } = modelos();
  return sequelize.transaction(async (transaction) => {
    if (await versionUsada(cuerpo.version, transaction)) throw errores.versionUsada(cuerpo.version);
    const repetida = await ReglaRuta.findOne({
      where: { version: cuerpo.version, nombre: cuerpo.nombre },
      transaction,
    });
    if (repetida) throw errores.nombreRepetido();
    const activa = (await versionActiva(transaction)) === cuerpo.version;
    const regla = await ReglaRuta.create({ ...cuerpo, activa }, { transaction });
    await registrarBitacora({
      accion: 'reglas_ruta.crear',
      entidad: 'reglas_ruta',
      entidadId: regla.id,
      despues: formatearRegla(regla),
      transaction,
    });
    return formatearRegla(regla);
  });
}

/**
 * PATCH /admin/reglas-ruta/:id: solo en una versión que ninguna evaluación usó.
 * @param {string} id
 * @param {object} cambios
 */
async function cambiarRegla(id, cambios) {
  if (!esUuid(id)) throw errores.reglaNoEncontrada();
  if (cambios.condicion !== undefined) exigirCondicion(cambios.condicion);
  const { sequelize, ReglaRuta } = modelos();
  return sequelize.transaction(async (transaction) => {
    const regla = await ReglaRuta.findByPk(id, { lock: transaction.LOCK.UPDATE, transaction });
    if (!regla) throw errores.reglaNoEncontrada();
    if (await versionUsada(regla.version, transaction)) throw errores.versionUsada(regla.version);
    if (cambios.nombre && cambios.nombre !== regla.nombre) {
      const repetida = await ReglaRuta.findOne({
        where: { version: regla.version, nombre: cambios.nombre },
        transaction,
      });
      if (repetida) throw errores.nombreRepetido();
    }
    await auditarCambio(regla, cambios, { transaction, accion: 'reglas_ruta.actualizar' });
    return formatearRegla(regla);
  });
}

/**
 * POST /admin/reglas-ruta/versiones/:version/activar: activa esa versión y desactiva las demás.
 * @param {number} version
 */
async function activarVersion(version) {
  const { sequelize, ReglaRuta } = modelos();
  await sequelize.transaction(async (transaction) => {
    const reglas = await ReglaRuta.count({ where: { version }, transaction });
    if (!reglas) throw errores.versionVacia(version);
    const anterior = await versionActiva(transaction);
    await ReglaRuta.update({ activa: false }, { where: { activa: true }, transaction });
    await ReglaRuta.update({ activa: true }, { where: { version }, transaction });
    await registrarBitacora({
      accion: 'reglas_ruta.activar_version',
      entidad: 'reglas_ruta',
      entidadId: String(version),
      antes: { versionActiva: anterior },
      despues: { versionActiva: version },
      transaction,
    });
  });
  // Después del commit, para que el resumen vea la versión ya activa.
  return listarReglas({ version });
}

module.exports = {
  listarProveedores,
  crearProveedor,
  cambiarProveedor,
  listarReglas,
  crearRegla,
  cambiarRegla,
  activarVersion,
};
