'use strict';

/**
 * Tabla `campos_extraidos`. Escritura: agente 07.
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
  tipo: Object.freeze(['texto', 'fecha', 'numero', 'casilla', 'opcion']),
  estado: Object.freeze(['propuesto', 'confirmado', 'corregido']),
});

module.exports = (sequelize, DataTypes) => {
  const CampoExtraido = sequelize.define(
    'CampoExtraido',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      extraccionId: { type: DataTypes.UUID, allowNull: false },
      campo: { type: DataTypes.STRING(100), allowNull: false },
      seccion: { type: DataTypes.STRING(40), validate: { isIn: [VALORES.seccion] } },
      rutaDato: { type: DataTypes.STRING(200) },
      tipo: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [VALORES.tipo] } },
      valorLeido: { type: DataTypes.TEXT },
      confianza: { type: DataTypes.DECIMAL(4, 3) },
      pagina: { type: DataTypes.INTEGER },
      coordenadas: { type: DataTypes.JSONB },
      valorFinal: { type: DataTypes.TEXT },
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'propuesto',
        validate: { isIn: [VALORES.estado] },
      },
      revisadoPor: { type: DataTypes.UUID },
      revisadoEn: { type: DataTypes.DATE },
    },
    { tableName: 'campos_extraidos', underscored: true, timestamps: true },
  );

  CampoExtraido.VALORES = VALORES;
  return CampoExtraido;
};
