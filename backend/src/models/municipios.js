'use strict';

/**
 * Tabla `municipios`. Escritura: agente 01 (seed).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Municipio = sequelize.define(
    'Municipio',
    {
      codigo: { type: DataTypes.STRING(4), primaryKey: true, allowNull: false },
      departamentoCodigo: { type: DataTypes.STRING(2), allowNull: false },
      nombre: { type: DataTypes.STRING(120), allowNull: false },
    },
    { tableName: 'municipios', underscored: true, timestamps: true },
  );

  Municipio.VALORES = VALORES;
  return Municipio;
};
