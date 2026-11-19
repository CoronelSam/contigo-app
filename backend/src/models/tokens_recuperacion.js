'use strict';

/**
 * Tabla `tokens_recuperacion`. Escritura: agente 03.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  tipo: Object.freeze(['recuperar', 'invitar', 'verificar_correo']),
});

module.exports = (sequelize, DataTypes) => {
  const TokenRecuperacion = sequelize.define(
    'TokenRecuperacion',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      usuarioId: { type: DataTypes.UUID, allowNull: false },
      hash: { type: DataTypes.STRING(64), allowNull: false },
      tipo: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [VALORES.tipo] } },
      expiraEn: { type: DataTypes.DATE, allowNull: false },
      usadoEn: { type: DataTypes.DATE },
    },
    { tableName: 'tokens_recuperacion', underscored: true, timestamps: true },
  );

  TokenRecuperacion.VALORES = VALORES;
  return TokenRecuperacion;
};
