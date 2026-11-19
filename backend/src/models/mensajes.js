'use strict';

/**
 * Tabla `mensajes`. Escritura: agente 12.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Mensaje = sequelize.define(
    'Mensaje',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      autorId: { type: DataTypes.UUID, allowNull: false },
      cuerpo: { type: DataTypes.TEXT },
      archivoId: { type: DataTypes.UUID },
      leidoEn: { type: DataTypes.DATE },
    },
    { tableName: 'mensajes', underscored: true, timestamps: true },
  );

  Mensaje.VALORES = VALORES;
  return Mensaje;
};
