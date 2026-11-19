'use strict';

/**
 * Tabla `usuarios`. Escritura: agente 03 (registro, perfil, contraseña, bloqueo) y 13 (alta de personal, rol, estado).
 *
 * El correo es único sin distinguir mayúsculas (índice sobre lower(correo)); guárdalo en minúsculas.
 */

/** Valores permitidos de las columnas con lista cerrada (iguales a los CHECK de la base). */
const VALORES = Object.freeze({
  idioma: Object.freeze(['es', 'en']),
  estado: Object.freeze(['invitado', 'activo', 'inactivo']),
});

module.exports = (sequelize, DataTypes) => {
  const Usuario = sequelize.define(
    'Usuario',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      correo: { type: DataTypes.STRING(254), allowNull: false },
      hashContrasena: { type: DataTypes.TEXT },
      nombres: { type: DataTypes.STRING(120), allowNull: false },
      apellidos: { type: DataTypes.STRING(120), allowNull: false },
      telefono: { type: DataTypes.STRING(20) },
      idioma: {
        type: DataTypes.STRING(2),
        allowNull: false,
        defaultValue: 'es',
        validate: { isIn: [VALORES.idioma] },
      },
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'activo',
        validate: { isIn: [VALORES.estado] },
      },
      rolId: { type: DataTypes.UUID, allowNull: false },
      terminosVersion: { type: DataTypes.STRING(20) },
      terminosAceptadosEn: { type: DataTypes.DATE },
      correoVerificadoEn: { type: DataTypes.DATE },
      intentosFallidos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      bloqueadoHasta: { type: DataTypes.DATE },
      ultimoAccesoEn: { type: DataTypes.DATE },
    },
    { tableName: 'usuarios', underscored: true, timestamps: true },
  );

  Usuario.VALORES = VALORES;
  return Usuario;
};
