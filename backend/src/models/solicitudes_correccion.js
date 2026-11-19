'use strict';

/**
 * Tabla `solicitudes_correccion`. Escritura: agente 06.
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
    'profesional_salud',
    'consentimientos',
  ]),
  motivo: Object.freeze([
    'imagen_borrosa',
    'pagina_incompleta',
    'texto_ilegible',
    'documento_incorrecto',
    'no_cumple_requisito',
    'dato_incompleto',
    'dato_incorrecto',
    'otro',
  ]),
  estado: Object.freeze(['abierta', 'resuelta', 'anulada']),
});

module.exports = (sequelize, DataTypes) => {
  const SolicitudCorreccion = sequelize.define(
    'SolicitudCorreccion',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      documentoId: { type: DataTypes.UUID },
      seccion: { type: DataTypes.STRING(40), validate: { isIn: [VALORES.seccion] } },
      motivo: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [VALORES.motivo] },
      },
      observaciones: { type: DataTypes.TEXT },
      solicitadoPor: { type: DataTypes.UUID },
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'abierta',
        validate: { isIn: [VALORES.estado] },
      },
      resueltaConDocumentoId: { type: DataTypes.UUID },
      resueltaEn: { type: DataTypes.DATE },
    },
    { tableName: 'solicitudes_correccion', underscored: true, timestamps: true },
  );

  SolicitudCorreccion.VALORES = VALORES;
  return SolicitudCorreccion;
};
