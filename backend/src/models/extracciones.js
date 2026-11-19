'use strict';

/**
 * Tabla `extracciones`. Escritura: agente 07.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  estado: Object.freeze([
    'en_cola',
    'procesando',
    'por_confirmar',
    'confirmada',
    'fallida',
    'cancelada',
  ]),
});

module.exports = (sequelize, DataTypes) => {
  const Extraccion = sequelize.define(
    'Extraccion',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      documentoId: { type: DataTypes.UUID, allowNull: false },
      plantillaId: { type: DataTypes.UUID },
      motor: { type: DataTypes.STRING(30) },
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'en_cola',
        validate: { isIn: [VALORES.estado] },
      },
      progreso: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      confianzaPromedio: { type: DataTypes.DECIMAL(4, 3) },
      respuestaCruda: { type: DataTypes.JSONB },
      error: { type: DataTypes.STRING(100) },
      revisadoPor: { type: DataTypes.UUID },
      revisadoEn: { type: DataTypes.DATE },
    },
    { tableName: 'extracciones', underscored: true, timestamps: true },
  );

  Extraccion.VALORES = VALORES;
  return Extraccion;
};
