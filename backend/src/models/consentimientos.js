'use strict';

/**
 * Tabla `consentimientos`. Escritura: agente 05.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  tipo: Object.freeze([
    'divulgacion_informacion_medica',
    'marketing',
    'telesalud',
    'condiciones_atencion',
  ]),
  decision: Object.freeze(['acepta', 'no_acepta']),
  estadoFirma: Object.freeze(['pendiente', 'firmado', 'no_aplica']),
});

module.exports = (sequelize, DataTypes) => {
  const Consentimiento = sequelize.define(
    'Consentimiento',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      tipo: { type: DataTypes.STRING(40), allowNull: false, validate: { isIn: [VALORES.tipo] } },
      textoId: { type: DataTypes.UUID },
      decision: { type: DataTypes.STRING(20), validate: { isIn: [VALORES.decision] } },
      textoAbiertoEn: { type: DataTypes.DATE },
      decididoPor: { type: DataTypes.UUID },
      decididoEn: { type: DataTypes.DATE },
      ip: { type: DataTypes.STRING(45) },
      dispositivo: { type: DataTypes.STRING(255) },
      estadoFirma: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'pendiente',
        validate: { isIn: [VALORES.estadoFirma] },
      },
      documentoFirmadoId: { type: DataTypes.UUID },
    },
    { tableName: 'consentimientos', underscored: true, timestamps: true },
  );

  Consentimiento.VALORES = VALORES;
  return Consentimiento;
};
