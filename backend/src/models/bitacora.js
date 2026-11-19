'use strict';

/**
 * Tabla `bitacora`. Escritura: agente 02 (core/auditoria).
 *
 * `entidad_id` es texto para admitir llaves que no son UUID (por ejemplo `configuracion.clave`).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({});

module.exports = (sequelize, DataTypes) => {
  const Bitacora = sequelize.define(
    'Bitacora',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      usuarioId: { type: DataTypes.UUID },
      accion: { type: DataTypes.STRING(60), allowNull: false },
      entidad: { type: DataTypes.STRING(60), allowNull: false },
      entidadId: { type: DataTypes.STRING(64) },
      solicitudId: { type: DataTypes.UUID },
      antes: { type: DataTypes.JSONB },
      despues: { type: DataTypes.JSONB },
      ip: { type: DataTypes.STRING(45) },
    },
    { tableName: 'bitacora', underscored: true, timestamps: true, updatedAt: false },
  );

  Bitacora.VALORES = VALORES;
  return Bitacora;
};
