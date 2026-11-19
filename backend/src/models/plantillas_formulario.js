'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `plantillas_formulario`. Escritura: agente 11.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  paquete: C.LISTA_PAQUETES,
  metodo: Object.freeze(['campo', 'coordenadas']),
});

module.exports = (sequelize, DataTypes) => {
  const PlantillaFormulario = sequelize.define(
    'PlantillaFormulario',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      codigo: { type: DataTypes.STRING(60), allowNull: false },
      nombre: { type: DataTypes.STRING(200), allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      paquete: { type: DataTypes.STRING(20), validate: { isIn: [VALORES.paquete] } },
      archivoPdfId: { type: DataTypes.UUID, allowNull: false },
      mapaCampos: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      metodo: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [VALORES.metodo] },
      },
      zonasOcr: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'plantillas_formulario', underscored: true, timestamps: true },
  );

  PlantillaFormulario.VALORES = VALORES;
  return PlantillaFormulario;
};
