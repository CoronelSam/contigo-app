'use strict';

/**
 * Tabla `paciente_tutor`. Escritura: agente 04.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const PacienteTutor = sequelize.define(
    'PacienteTutor',
    {
      pacienteId: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      tutorId: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      esResponsableLegal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      confirmadoEn: { type: DataTypes.DATE },
      confirmadoPor: { type: DataTypes.UUID },
    },
    { tableName: 'paciente_tutor', underscored: true, timestamps: true },
  );

  PacienteTutor.VALORES = VALORES;
  return PacienteTutor;
};
