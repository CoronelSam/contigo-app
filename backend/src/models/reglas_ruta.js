'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `reglas_ruta`. Escritura: agente 10.
 *
 * La versión activa es la que tiene `activa = true` en todas sus reglas.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  rutaSugerida: C.LISTA_RUTAS_SUGERIDAS,
});

module.exports = (sequelize, DataTypes) => {
  const ReglaRuta = sequelize.define(
    'ReglaRuta',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      version: { type: DataTypes.INTEGER, allowNull: false },
      prioridad: { type: DataTypes.INTEGER, allowNull: false },
      nombre: { type: DataTypes.STRING(100), allowNull: false },
      condicion: { type: DataTypes.JSONB, allowNull: false },
      rutaSugerida: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [VALORES.rutaSugerida] },
      },
      motivoEs: { type: DataTypes.TEXT, allowNull: false },
      motivoEn: { type: DataTypes.TEXT, allowNull: false },
      activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { tableName: 'reglas_ruta', underscored: true, timestamps: true },
  );

  ReglaRuta.VALORES = VALORES;
  return ReglaRuta;
};
