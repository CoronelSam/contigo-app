'use strict';

/**
 * Tabla `solicitud_secciones`. Escritura: agente 05 (07 escribe a través de fusionarValoresOcr).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  seccion: Object.freeze([
    'informacion_medica',
    'embarazo_nacimiento',
    'antecedentes_medicos',
    'medicamentos_alergias',
    'crecimiento_movilidad',
    'educacion',
  ]),
  estado: Object.freeze(['vacia', 'incompleta', 'completa']),
  idioma: Object.freeze(['es', 'en']),
  origen: Object.freeze(['app', 'ocr', 'mixto']),
});

module.exports = (sequelize, DataTypes) => {
  const SolicitudSeccion = sequelize.define(
    'SolicitudSeccion',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      seccion: {
        type: DataTypes.STRING(40),
        allowNull: false,
        validate: { isIn: [VALORES.seccion] },
      },
      datos: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'vacia',
        validate: { isIn: [VALORES.estado] },
      },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      versionPlantilla: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'v1' },
      idioma: {
        type: DataTypes.STRING(2),
        allowNull: false,
        defaultValue: 'es',
        validate: { isIn: [VALORES.idioma] },
      },
      origen: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'app',
        validate: { isIn: [VALORES.origen] },
      },
      actualizadoPor: { type: DataTypes.UUID },
    },
    { tableName: 'solicitud_secciones', underscored: true, timestamps: true },
  );

  SolicitudSeccion.VALORES = VALORES;
  return SolicitudSeccion;
};
