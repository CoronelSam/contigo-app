'use strict';

/**
 * Tabla `tipos_documento`. Escritura: agente 01 (seed) y 13 (administración).
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  categoria: Object.freeze([
    'medico',
    'formulario',
    'consentimiento_firmado',
    'identidad',
    'financiero',
    'otro',
  ]),
});

module.exports = (sequelize, DataTypes) => {
  const TipoDocumento = sequelize.define(
    'TipoDocumento',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      codigo: { type: DataTypes.STRING(60), allowNull: false },
      nombreEs: { type: DataTypes.STRING(200), allowNull: false },
      nombreEn: { type: DataTypes.STRING(200), allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      categoria: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [VALORES.categoria] },
      },
      paraQueSirveEs: { type: DataTypes.TEXT },
      paraQueSirveEn: { type: DataTypes.TEXT },
      comoFotografiarEs: { type: DataTypes.TEXT },
      comoFotografiarEn: { type: DataTypes.TEXT },
      admiteVariasPaginas: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      paginasEsperadas: { type: DataTypes.INTEGER },
      plantillaId: { type: DataTypes.UUID },
    },
    { tableName: 'tipos_documento', underscored: true, timestamps: true },
  );

  TipoDocumento.VALORES = VALORES;
  return TipoDocumento;
};
