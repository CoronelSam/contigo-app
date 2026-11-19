'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `evaluaciones`. Escritura: agente 10.
 *
 * Solo una evaluación vigente por solicitud (índice único parcial).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  rutaSugerida: C.LISTA_RUTAS_SUGERIDAS,
  rutaDecidida: C.LISTA_RUTAS,
  tipoDictamen: Object.freeze(['medico_evaluador', 'comite_medico']),
});

module.exports = (sequelize, DataTypes) => {
  const Evaluacion = sequelize.define(
    'Evaluacion',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      rutaSugerida: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [VALORES.rutaSugerida] },
      },
      motivos: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      hechos: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      versionReglas: { type: DataTypes.INTEGER },
      rutaDecidida: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [VALORES.rutaDecidida] },
      },
      justificacion: { type: DataTypes.TEXT, allowNull: false },
      evaluadorNombre: { type: DataTypes.STRING(200), allowNull: false },
      evaluadorCargo: { type: DataTypes.STRING(200), allowNull: false },
      tipoDictamen: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [VALORES.tipoDictamen] },
      },
      fechaDictamen: { type: DataTypes.DATEONLY, allowNull: false },
      registradoPor: { type: DataTypes.UUID },
      vigente: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'evaluaciones', underscored: true, timestamps: true },
  );

  Evaluacion.VALORES = VALORES;
  return Evaluacion;
};
