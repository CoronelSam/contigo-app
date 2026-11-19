'use strict';

/**
 * Tabla `proveedores_locales`. Escritura: agente 10.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  tipo: Object.freeze(['hospital_publico', 'hospital_privado', 'clinica', 'jornada_medica']),
});

module.exports = (sequelize, DataTypes) => {
  const ProveedorLocal = sequelize.define(
    'ProveedorLocal',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      nombre: { type: DataTypes.STRING(200), allowNull: false },
      tipo: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [VALORES.tipo] } },
      departamentoCodigo: { type: DataTypes.STRING(2), allowNull: false },
      municipioCodigo: { type: DataTypes.STRING(4) },
      especialidades: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
      contacto: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      notas: { type: DataTypes.TEXT },
    },
    { tableName: 'proveedores_locales', underscored: true, timestamps: true },
  );

  ProveedorLocal.VALORES = VALORES;
  return ProveedorLocal;
};
