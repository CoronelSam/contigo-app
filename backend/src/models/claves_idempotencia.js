'use strict';

/**
 * Tabla `claves_idempotencia`. Escritura: agente 02 (core/http/idempotencia).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  estado: Object.freeze(['en_proceso', 'completada']),
});

module.exports = (sequelize, DataTypes) => {
  const ClaveIdempotencia = sequelize.define(
    'ClaveIdempotencia',
    {
      usuarioId: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      clave: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      metodo: { type: DataTypes.STRING(10), allowNull: false },
      ruta: { type: DataTypes.STRING(300), allowNull: false },
      hashCuerpo: { type: DataTypes.STRING(64), allowNull: false },
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'en_proceso',
        validate: { isIn: [VALORES.estado] },
      },
      codigoHttp: { type: DataTypes.INTEGER },
      respuesta: { type: DataTypes.JSONB },
      expiraEn: { type: DataTypes.DATE, allowNull: false },
    },
    { tableName: 'claves_idempotencia', underscored: true, timestamps: true },
  );

  ClaveIdempotencia.VALORES = VALORES;
  return ClaveIdempotencia;
};
