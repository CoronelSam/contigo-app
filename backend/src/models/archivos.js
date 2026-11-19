'use strict';

/**
 * Tabla `archivos`. Escritura: agente 02 (core/archivos).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Archivo = sequelize.define(
    'Archivo',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      clave: { type: DataTypes.STRING(512), allowNull: false },
      mime: { type: DataTypes.STRING(100), allowNull: false },
      bytes: { type: DataTypes.INTEGER, allowNull: false },
      sha256: { type: DataTypes.STRING(64), allowNull: false },
      ancho: { type: DataTypes.INTEGER },
      alto: { type: DataTypes.INTEGER },
      subidoPor: { type: DataTypes.UUID },
    },
    { tableName: 'archivos', underscored: true, timestamps: true },
  );

  Archivo.VALORES = VALORES;
  return Archivo;
};
