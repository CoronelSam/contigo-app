'use strict';

const { sequelize } = require('../../src/models');

/**
 * Tablas que cargan los seeders base y no se borran entre pruebas.
 * Agente 01: complétala (roles, permisos, catálogos…). Ojo: TRUNCATE ... CASCADE también vacía
 * las tablas que apuntan a las truncadas (por ejemplo, `configuracion.actualizado_por` → `usuarios`);
 * restaura aquí lo que haga falta después de truncar.
 */
const TABLAS_SEMILLA = [];

const TABLAS_SISTEMA = ['SequelizeMeta', 'SequelizeData'];

/** Vacía las tablas de datos para que cada prueba empiece igual. */
async function limpiarBase() {
  const [filas] = await sequelize.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  const tablas = filas
    .map((f) => f.tablename)
    .filter((t) => !TABLAS_SISTEMA.includes(t) && !TABLAS_SEMILLA.includes(t));
  if (!tablas.length) return;
  await sequelize.query(
    `TRUNCATE ${tablas.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

module.exports = { limpiarBase, TABLAS_SEMILLA, TABLAS_SISTEMA };
