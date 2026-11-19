'use strict';

/**
 * Tabla `profesionales_salud`. Escritura: agente 05.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const ProfesionalSalud = sequelize.define(
    'ProfesionalSalud',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      nombre: { type: DataTypes.STRING(200) },
      especialidad: { type: DataTypes.STRING(60) },
      telefono: { type: DataTypes.STRING(20) },
      correo: { type: DataTypes.STRING(254) },
      documentoCertificacionId: { type: DataTypes.UUID },
    },
    { tableName: 'profesionales_salud', underscored: true, timestamps: true },
  );

  ProfesionalSalud.VALORES = VALORES;
  return ProfesionalSalud;
};
