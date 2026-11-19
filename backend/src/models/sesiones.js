'use strict';

/**
 * Tabla `sesiones`. Escritura: agente 03.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Sesion = sequelize.define(
    'Sesion',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      usuarioId: { type: DataTypes.UUID, allowNull: false },
      hashRefresh: { type: DataTypes.STRING(64), allowNull: false },
      cadenaId: { type: DataTypes.UUID, allowNull: false },
      reemplazadaPor: { type: DataTypes.UUID },
      dispositivo: { type: DataTypes.STRING(255) },
      ip: { type: DataTypes.STRING(45) },
      expiraEn: { type: DataTypes.DATE, allowNull: false },
      revocadaEn: { type: DataTypes.DATE },
      ultimoUsoEn: { type: DataTypes.DATE },
    },
    { tableName: 'sesiones', underscored: true, timestamps: true },
  );

  Sesion.VALORES = VALORES;
  return Sesion;
};
