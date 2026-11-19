'use strict';

/**
 * Tabla `registro_accesos`. Escritura: agente 02 (core/auditoria).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  recurso: Object.freeze(['expediente', 'historia_clinica', 'documento', 'archivo', 'paquete']),
});

module.exports = (sequelize, DataTypes) => {
  const RegistroAcceso = sequelize.define(
    'RegistroAcceso',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      usuarioId: { type: DataTypes.UUID, allowNull: false },
      solicitudId: { type: DataTypes.UUID },
      recurso: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [VALORES.recurso] },
      },
      recursoId: { type: DataTypes.UUID },
      ip: { type: DataTypes.STRING(45) },
    },
    { tableName: 'registro_accesos', underscored: true, timestamps: true, updatedAt: false },
  );

  RegistroAcceso.VALORES = VALORES;
  return RegistroAcceso;
};
