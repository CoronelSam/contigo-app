'use strict';

/**
 * Tabla `respuestas_shriners`. Escritura: agente 11.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  resultado: Object.freeze(['informacion_adicional', 'aceptada', 'denegada']),
});

module.exports = (sequelize, DataTypes) => {
  const RespuestaShriners = sequelize.define(
    'RespuestaShriners',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      envioId: { type: DataTypes.UUID },
      fecha: { type: DataTypes.DATEONLY, allowNull: false },
      resultado: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [VALORES.resultado] },
      },
      observaciones: { type: DataTypes.TEXT },
      registradoPor: { type: DataTypes.UUID },
    },
    { tableName: 'respuestas_shriners', underscored: true, timestamps: true },
  );

  RespuestaShriners.VALORES = VALORES;
  return RespuestaShriners;
};
