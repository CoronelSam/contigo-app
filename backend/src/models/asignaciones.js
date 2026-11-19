'use strict';

/**
 * Tabla `asignaciones`. Escritura: agente 08.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  estado: Object.freeze([
    'asignado',
    'pendiente_captura',
    'captura_en_proceso',
    'en_revision',
    'revisado',
  ]),
});

module.exports = (sequelize, DataTypes) => {
  const Asignacion = sequelize.define(
    'Asignacion',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      voluntarioId: { type: DataTypes.UUID, allowNull: false },
      estado: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'asignado',
        validate: { isIn: [VALORES.estado] },
      },
      activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      asignadoPor: { type: DataTypes.UUID },
      notas: { type: DataTypes.TEXT },
    },
    { tableName: 'asignaciones', underscored: true, timestamps: true },
  );

  Asignacion.VALORES = VALORES;
  return Asignacion;
};
