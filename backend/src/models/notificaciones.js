'use strict';

/**
 * Tabla `notificaciones`. Escritura: agente 02 crea (core/notificaciones) · 12 marca leídas y envía push.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  idioma: Object.freeze(['es', 'en']),
});

module.exports = (sequelize, DataTypes) => {
  const Notificacion = sequelize.define(
    'Notificacion',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      usuarioId: { type: DataTypes.UUID, allowNull: false },
      tipo: { type: DataTypes.STRING(40), allowNull: false },
      titulo: { type: DataTypes.STRING(200), allowNull: false },
      cuerpo: { type: DataTypes.TEXT, allowNull: false },
      idioma: {
        type: DataTypes.STRING(2),
        allowNull: false,
        defaultValue: 'es',
        validate: { isIn: [VALORES.idioma] },
      },
      datos: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      solicitudId: { type: DataTypes.UUID },
      leidaEn: { type: DataTypes.DATE },
      enviadaPushEn: { type: DataTypes.DATE },
    },
    { tableName: 'notificaciones', underscored: true, timestamps: true },
  );

  Notificacion.VALORES = VALORES;
  return Notificacion;
};
