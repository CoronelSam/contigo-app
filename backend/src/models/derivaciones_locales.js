'use strict';

/**
 * Tabla `derivaciones_locales`. Escritura: agente 10.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  estado: Object.freeze(['programada', 'atendida', 'no_asistio', 'cancelada']),
});

module.exports = (sequelize, DataTypes) => {
  const DerivacionLocal = sequelize.define(
    'DerivacionLocal',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      proveedorId: { type: DataTypes.UUID, allowNull: false },
      especialidad: { type: DataTypes.STRING(60), allowNull: false },
      fechaCita: { type: DataTypes.DATEONLY, allowNull: false },
      horaCita: { type: DataTypes.TIME },
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'programada',
        validate: { isIn: [VALORES.estado] },
      },
      observaciones: { type: DataTypes.TEXT },
      reemplazaA: { type: DataTypes.UUID },
      registradoPor: { type: DataTypes.UUID },
    },
    { tableName: 'derivaciones_locales', underscored: true, timestamps: true },
  );

  DerivacionLocal.VALORES = VALORES;
  return DerivacionLocal;
};
