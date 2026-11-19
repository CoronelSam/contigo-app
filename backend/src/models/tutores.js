'use strict';

/**
 * Tabla `tutores`. Escritura: agente 04.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Tutor = sequelize.define(
    'Tutor',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      usuarioId: { type: DataTypes.UUID },
      nombres: { type: DataTypes.STRING(120), allowNull: false },
      apellidos: { type: DataTypes.STRING(120), allowNull: false },
      parentesco: { type: DataTypes.STRING(60) },
      telefono: { type: DataTypes.STRING(20) },
      correo: { type: DataTypes.STRING(254) },
      direccion: { type: DataTypes.TEXT },
    },
    { tableName: 'tutores', underscored: true, timestamps: true },
  );

  Tutor.VALORES = VALORES;
  return Tutor;
};
