'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `roles`. Escritura: agente 01 (seed; solo lectura en v1).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  codigo: C.LISTA_ROLES,
});

module.exports = (sequelize, DataTypes) => {
  const Rol = sequelize.define(
    'Rol',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      codigo: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [VALORES.codigo] },
      },
      nombreEs: { type: DataTypes.STRING(60), allowNull: false },
      nombreEn: { type: DataTypes.STRING(60), allowNull: false },
      descripcion: { type: DataTypes.TEXT },
    },
    { tableName: 'roles', underscored: true, timestamps: true },
  );

  Rol.VALORES = VALORES;
  return Rol;
};
