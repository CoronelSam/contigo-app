'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `documentos`. Escritura: agente 06.
 *
 * El `id` lo puede generar el teléfono (UUID) para que un reintento no duplique el documento.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  estado: C.LISTA_ESTADOS_DOCUMENTO,
  origen: Object.freeze(['app', 'jornada']),
});

module.exports = (sequelize, DataTypes) => {
  const Documento = sequelize.define(
    'Documento',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      tipoDocumentoId: { type: DataTypes.UUID, allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      reemplazaA: { type: DataTypes.UUID },
      vigente: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'FALTA',
        validate: { isIn: [VALORES.estado] },
      },
      paginasDeclaradas: { type: DataTypes.INTEGER },
      origen: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'app',
        validate: { isIn: [VALORES.origen] },
      },
      capturadoPor: { type: DataTypes.UUID },
      capturadoEn: { type: DataTypes.DATE },
      validadoPor: { type: DataTypes.UUID },
      validadoEn: { type: DataTypes.DATE },
      motivoRechazo: { type: DataTypes.TEXT },
    },
    { tableName: 'documentos', underscored: true, timestamps: true },
  );

  Documento.VALORES = VALORES;
  return Documento;
};
