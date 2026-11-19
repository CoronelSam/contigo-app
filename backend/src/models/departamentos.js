'use strict';

/**
 * Tabla `departamentos`. Escritura: agente 01 (seed).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Departamento = sequelize.define(
    'Departamento',
    {
      codigo: { type: DataTypes.STRING(2), primaryKey: true, allowNull: false },
      nombre: { type: DataTypes.STRING(80), allowNull: false },
    },
    { tableName: 'departamentos', underscored: true, timestamps: true },
  );

  Departamento.VALORES = VALORES;
  return Departamento;
};
