'use strict';

/**
 * Tabla `textos_consentimiento`. Escritura: agente 01 (seed).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  tipo: Object.freeze([
    'divulgacion_informacion_medica',
    'marketing',
    'telesalud',
    'condiciones_atencion',
  ]),
  idioma: Object.freeze(['es', 'en']),
});

module.exports = (sequelize, DataTypes) => {
  const TextoConsentimiento = sequelize.define(
    'TextoConsentimiento',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tipo: { type: DataTypes.STRING(40), allowNull: false, validate: { isIn: [VALORES.tipo] } },
      version: { type: DataTypes.INTEGER, allowNull: false },
      idioma: { type: DataTypes.STRING(2), allowNull: false, validate: { isIn: [VALORES.idioma] } },
      titulo: { type: DataTypes.STRING(200), allowNull: false },
      cuerpo: { type: DataTypes.TEXT, allowNull: false },
      vigenteDesde: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { tableName: 'textos_consentimiento', underscored: true, timestamps: true },
  );

  TextoConsentimiento.VALORES = VALORES;
  return TextoConsentimiento;
};
