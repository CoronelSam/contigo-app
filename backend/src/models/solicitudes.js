'use strict';

const C = require('../core/estados/constantes');

/**
 * Tabla `solicitudes`. Escritura: agente 05 (crea, modalidad, faltantes) · estado, etapa y ultimo_cambio_estado solo vía core/estados · coordinador_id: 09 · ruta_sugerida, ruta_decidida y paquete: 10.
 *
 * El código sale de la secuencia `solicitud_codigo_seq` (nextval), nunca de contar filas.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  modalidad: C.LISTA_MODALIDADES,
  estado: C.LISTA_ESTADOS_SOLICITUD,
  etapa: C.LISTA_ETAPAS,
  rutaSugerida: C.LISTA_RUTAS_SUGERIDAS,
  rutaDecidida: C.LISTA_RUTAS,
  paquete: C.LISTA_PAQUETES,
});

module.exports = (sequelize, DataTypes) => {
  const Solicitud = sequelize.define(
    'Solicitud',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      codigo: { type: DataTypes.STRING(20), allowNull: false },
      pacienteId: { type: DataTypes.UUID, allowNull: false },
      modalidad: { type: DataTypes.STRING(10), validate: { isIn: [VALORES.modalidad] } },
      estado: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'BORRADOR',
        validate: { isIn: [VALORES.estado] },
      },
      etapa: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'evaluacion',
        validate: { isIn: [VALORES.etapa] },
      },
      rutaSugerida: { type: DataTypes.STRING(20), validate: { isIn: [VALORES.rutaSugerida] } },
      rutaDecidida: { type: DataTypes.STRING(20), validate: { isIn: [VALORES.rutaDecidida] } },
      paquete: { type: DataTypes.STRING(20), validate: { isIn: [VALORES.paquete] } },
      faltantesAlEnviar: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      enviadaEn: { type: DataTypes.DATE },
      coordinadorId: { type: DataTypes.UUID },
      creadaPor: { type: DataTypes.UUID },
      ultimoCambioEstado: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { tableName: 'solicitudes', underscored: true, timestamps: true },
  );

  Solicitud.VALORES = VALORES;
  return Solicitud;
};
