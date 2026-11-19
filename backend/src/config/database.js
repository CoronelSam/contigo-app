'use strict';

// Configuración que usa sequelize-cli (migraciones y seeders).
// La app usa src/models/index.js, que toma la URL de src/config/env.js.

const fs = require('node:fs');
const path = require('node:path');

const archivoEnv = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(archivoEnv) && typeof process.loadEnvFile === 'function') {
  // No sobreescribe variables que ya existen en el entorno.
  process.loadEnvFile(archivoEnv);
}

const base = {
  dialect: 'postgres',
  logging: false,
  define: { underscored: true, timestamps: true },
  migrationStorageTableName: 'SequelizeMeta',
  seederStorage: 'sequelize',
  seederStorageTableName: 'SequelizeData',
};

module.exports = {
  development: { ...base, use_env_variable: 'DATABASE_URL' },
  test: { ...base, use_env_variable: 'DATABASE_URL_TEST' },
  production: { ...base, use_env_variable: 'DATABASE_URL' },
};
