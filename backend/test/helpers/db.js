'use strict';

const { sequelize } = require('../../src/models');
const { sembrarDatosEditables } = require('../../src/db/semillas');

/** Tablas que solo cambian con seeders y que ninguna prueba debe modificar. */
const TABLAS_FIJAS = ['roles', 'permisos', 'rol_permiso', 'departamentos', 'municipios'];

const TABLAS_SISTEMA = ['SequelizeMeta', 'SequelizeData'];

/**
 * Deja la base como recién sembrada para que cada prueba empiece igual.
 *
 * Vacía todas las tablas salvo las fijas y vuelve a cargar los datos base editables
 * (catálogos, tipos de documento y requisitos, textos de consentimiento, configuración y reglas
 * de ruta). Hace falta recargarlos porque TRUNCATE … CASCADE también vacía las tablas que apuntan
 * a las truncadas (por ejemplo `configuracion.actualizado_por` → `usuarios`) y porque las pruebas
 * de administración los modifican. También reinicia la secuencia del código de caso.
 *
 * @param {{ resembrar?: boolean }} [opciones]
 */
async function limpiarBase({ resembrar = true } = {}) {
  const [filas] = await sequelize.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  const tablas = filas
    .map((f) => f.tablename)
    .filter((t) => !TABLAS_SISTEMA.includes(t) && !TABLAS_FIJAS.includes(t));

  await sequelize.transaction(async (transaction) => {
    if (tablas.length) {
      await sequelize.query(
        `TRUNCATE ${tablas.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
        { transaction },
      );
    }
    await sequelize.query('ALTER SEQUENCE IF EXISTS solicitud_codigo_seq RESTART WITH 1', {
      transaction,
    });
    if (resembrar) {
      await sembrarDatosEditables({ queryInterface: sequelize.getQueryInterface(), transaction });
    }
  });
}

module.exports = { limpiarBase, TABLAS_FIJAS, TABLAS_SISTEMA };
