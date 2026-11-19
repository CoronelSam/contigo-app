'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `historial_estados`. Escritura: agente 02 (core/estados).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  estadoAnterior: C.LISTA_ESTADOS_SOLICITUD,
  estadoNuevo: C.LISTA_ESTADOS_SOLICITUD,
  etapa: C.LISTA_ETAPAS,
});

module.exports = (sequelize, DataTypes) => {
  const HistorialEstado = sequelize.define(
    'HistorialEstado',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      estadoAnterior: { type: DataTypes.STRING(30), validate: { isIn: [VALORES.estadoAnterior] } },
      estadoNuevo: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [VALORES.estadoNuevo] },
      },
      etapa: { type: DataTypes.STRING(20), validate: { isIn: [VALORES.etapa] } },
      usuarioId: { type: DataTypes.UUID },
      nota: { type: DataTypes.TEXT },
    },
    { tableName: 'historial_estados', underscored: true, timestamps: true, updatedAt: false },
  );

  HistorialEstado.VALORES = VALORES;
  return HistorialEstado;
};
