'use strict';

/**
 * Tabla `dispositivos`. Escritura: agente 03 (12 borra tokens inválidos).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  plataforma: Object.freeze(['android', 'ios', 'web']),
});

module.exports = (sequelize, DataTypes) => {
  const Dispositivo = sequelize.define(
    'Dispositivo',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      usuarioId: { type: DataTypes.UUID, allowNull: false },
      tokenFcm: { type: DataTypes.STRING(512), allowNull: false },
      plataforma: {
        type: DataTypes.STRING(10),
        allowNull: false,
        validate: { isIn: [VALORES.plataforma] },
      },
      ultimoUsoEn: { type: DataTypes.DATE },
    },
    { tableName: 'dispositivos', underscored: true, timestamps: true },
  );

  Dispositivo.VALORES = VALORES;
  return Dispositivo;
};
