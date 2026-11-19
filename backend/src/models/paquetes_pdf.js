'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `paquetes_pdf`. Escritura: agente 11.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  paquete: C.LISTA_PAQUETES,
  tipo: Object.freeze(['borrador', 'final']),
  estado: Object.freeze(['en_cola', 'generando', 'listo', 'fallido']),
});

module.exports = (sequelize, DataTypes) => {
  const PaquetePdf = sequelize.define(
    'PaquetePdf',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      solicitudId: { type: DataTypes.UUID, allowNull: false },
      paquete: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [VALORES.paquete] },
      },
      tipo: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [VALORES.tipo] } },
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'en_cola',
        validate: { isIn: [VALORES.estado] },
      },
      progreso: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      archivoId: { type: DataTypes.UUID },
      numeroPaginas: { type: DataTypes.INTEGER },
      plantillasUsadas: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      avisos: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      generadoPor: { type: DataTypes.UUID },
      revisadoPor: { type: DataTypes.UUID },
      revisadoEn: { type: DataTypes.DATE },
      error: { type: DataTypes.STRING(100) },
    },
    { tableName: 'paquetes_pdf', underscored: true, timestamps: true },
  );

  PaquetePdf.VALORES = VALORES;
  return PaquetePdf;
};
