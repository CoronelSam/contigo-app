'use strict';

/**
 * Tabla `pacientes`. Escritura: agente 04.
 *
 * La columna generada `nombre_busqueda` (minúsculas y sin acentos) existe en la base pero no en el modelo: búscala con sequelize.where(sequelize.col('nombre_busqueda'), …) y el operador `%` o `ILIKE` de pg_trgm.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  sexo: Object.freeze(['femenino', 'masculino']),
});

module.exports = (sequelize, DataTypes) => {
  const Paciente = sequelize.define(
    'Paciente',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      nombres: { type: DataTypes.STRING(120), allowNull: false },
      apellidoPaterno: { type: DataTypes.STRING(80), allowNull: false },
      apellidoMaterno: { type: DataTypes.STRING(80) },
      fechaNacimiento: { type: DataTypes.DATEONLY, allowNull: false },
      sexo: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [VALORES.sexo] } },
      municipioCodigo: { type: DataTypes.STRING(4), allowNull: false },
      direccion: { type: DataTypes.TEXT },
      fotoArchivoId: { type: DataTypes.UUID },
      posibleDuplicado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      creadoPor: { type: DataTypes.UUID },
    },
    { tableName: 'pacientes', underscored: true, timestamps: true },
  );

  Paciente.VALORES = VALORES;
  return Paciente;
};
