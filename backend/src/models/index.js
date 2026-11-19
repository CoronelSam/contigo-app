'use strict';

// Instancia de Sequelize y registro de modelos.
// Agente 01: un archivo por modelo en esta carpeta y TODAS las asociaciones aquí, al final.

const { Sequelize, DataTypes } = require('sequelize');
const { config } = require('../config/env');
const { logger } = require('../core/logger');

const cfg = config();

const sequelize = new Sequelize(cfg.baseDatosUrl, {
  dialect: 'postgres',
  logging: cfg.logSql ? (sql) => logger.debug({ sql }, 'SQL') : false,
  define: { underscored: true, timestamps: true },
  pool: { max: 10, min: 0, idle: 10_000, acquire: 30_000 },
});

const db = { sequelize, Sequelize, DataTypes };

module.exports = db;
