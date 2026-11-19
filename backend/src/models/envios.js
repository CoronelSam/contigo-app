'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `envios`. Escritura: agente 11.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  destino: C.LISTA_PAQUETES,
  metodo: Object.freeze(['correo', 'mensajeria', 'portal', 'entrega_personal', 'otro']),
});

module.exports = (sequelize, DataTypes) => {
  const Envio = sequelize.define(
    'Envio',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      paquetePdfId: { type: DataTypes.UUID, allowNull: false },
      destino: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [VALORES.destino] },
      },
      fecha: { type: DataTypes.DATEONLY, allowNull: false },
      metodo: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [VALORES.metodo] },
      },
      guia: { type: DataTypes.STRING(200) },
      observaciones: { type: DataTypes.TEXT },
      registradoPor: { type: DataTypes.UUID },
    },
    { tableName: 'envios', underscored: true, timestamps: true },
  );

  Envio.VALORES = VALORES;
  return Envio;
};
