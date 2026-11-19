'use strict';

/**
 * Tabla `permisos`. Escritura: agente 01 (seed; solo lectura en v1).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Permiso = sequelize.define(
    'Permiso',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      codigo: { type: DataTypes.STRING(60), allowNull: false },
      descripcion: { type: DataTypes.TEXT },
    },
    { tableName: 'permisos', underscored: true, timestamps: true },
  );

  Permiso.VALORES = VALORES;
  return Permiso;
};
