'use strict';

/**
 * Tabla `rol_permiso`. Escritura: agente 01 (seed; solo lectura en v1).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const RolPermiso = sequelize.define(
    'RolPermiso',
    {
      rolId: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      permisoId: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    },
    { tableName: 'rol_permiso', underscored: true, timestamps: true },
  );

  RolPermiso.VALORES = VALORES;
  return RolPermiso;
};
