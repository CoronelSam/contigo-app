'use strict';

/**
 * Tabla `configuracion`. Escritura: agente 01 (seed) y 13 (administración).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Configuracion = sequelize.define(
    'Configuracion',
    {
      clave: { type: DataTypes.STRING(100), primaryKey: true, allowNull: false },
      valor: { type: DataTypes.JSONB, allowNull: false },
      descripcion: { type: DataTypes.TEXT },
      actualizadoPor: { type: DataTypes.UUID },
    },
    { tableName: 'configuracion', underscored: true, timestamps: true },
  );

  Configuracion.VALORES = VALORES;
  return Configuracion;
};
