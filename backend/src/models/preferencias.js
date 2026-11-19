'use strict';

/**
 * Tabla `preferencias`. Escritura: agente 03.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Preferencia = sequelize.define(
    'Preferencia',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      usuarioId: { type: DataTypes.UUID, allowNull: false },
      notificaciones: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    { tableName: 'preferencias', underscored: true, timestamps: true },
  );

  Preferencia.VALORES = VALORES;
  return Preferencia;
};
