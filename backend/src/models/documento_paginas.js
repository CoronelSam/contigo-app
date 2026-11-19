'use strict';

/**
 * Tabla `documento_paginas`. Escritura: agente 06.
 *
 * La unicidad (documento_id, orden) se comprueba al final de la transacción para poder reordenar.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const DocumentoPagina = sequelize.define(
    'DocumentoPagina',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      documentoId: { type: DataTypes.UUID, allowNull: false },
      orden: { type: DataTypes.INTEGER, allowNull: false },
      archivoId: { type: DataTypes.UUID, allowNull: false },
    },
    { tableName: 'documento_paginas', underscored: true, timestamps: true },
  );

  DocumentoPagina.VALORES = VALORES;
  return DocumentoPagina;
};
