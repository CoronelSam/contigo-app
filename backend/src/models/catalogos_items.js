'use strict';

/**
 * Tabla `catalogos_items`. Escritura: agente 01 (seed) y 13 (administración).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const CatalogoItem = sequelize.define(
    'CatalogoItem',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tipo: { type: DataTypes.STRING(40), allowNull: false },
      codigo: { type: DataTypes.STRING(60), allowNull: false },
      etiquetaEs: { type: DataTypes.STRING(200), allowNull: false },
      etiquetaEn: { type: DataTypes.STRING(200), allowNull: false },
      orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      metadatos: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    { tableName: 'catalogos_items', underscored: true, timestamps: true },
  );

  CatalogoItem.VALORES = VALORES;
  return CatalogoItem;
};
