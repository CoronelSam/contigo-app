'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `requisitos_ruta`. Escritura: agente 01 (seed) y 13 (administración).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  ruta: C.LISTA_RUTAS_REQUISITO,
});

module.exports = (sequelize, DataTypes) => {
  const RequisitoRuta = sequelize.define(
    'RequisitoRuta',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      ruta: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [VALORES.ruta] } },
      tipoDocumentoId: { type: DataTypes.UUID, allowNull: false },
      obligatorio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      cubiertoPorSecciones: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: [],
      },
      activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'requisitos_ruta', underscored: true, timestamps: true },
  );

  RequisitoRuta.VALORES = VALORES;
  return RequisitoRuta;
};
