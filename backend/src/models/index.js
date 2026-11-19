'use strict';

// Instancia de Sequelize, carga de los 43 modelos y TODAS las asociaciones.
//
// Uso: const { sequelize, Solicitud, Paciente } = require('../../models');
//
// Alias de las asociaciones (úsalos en `include: [{ model: X, as: '<alias>' }]`):
//
//  Usuario      rol · sesiones · tokens · dispositivos · preferencia · notificaciones · perfilesTutor
//  Rol          permisos · usuarios          Permiso   roles
//  Sesion       usuario · reemplazo          TokenRecuperacion / Dispositivo / Preferencia   usuario
//  Departamento municipios                   Municipio departamento
//  Configuracion actualizador
//  Paciente     municipio · foto · creador · tutores (N:M) · vinculos · solicitudes
//  Tutor        usuario · pacientes (N:M) · vinculos
//  PacienteTutor paciente · tutor · confirmador
//  Solicitud    paciente · coordinador · creador · secciones · profesionalSalud · consentimientos ·
//               asignaciones · historial · documentos · correcciones · mensajes · notificaciones ·
//               paquetes · envios · respuestas · evaluaciones · derivaciones · bitacora · accesos
//  SolicitudSeccion solicitud · actualizador
//  ProfesionalSalud solicitud · certificacion
//  Consentimiento solicitud · texto · decisor · documentoFirmado
//  Asignacion   solicitud · voluntario · asignador
//  HistorialEstado solicitud · usuario
//  Archivo      autorSubida
//  PlantillaFormulario archivoPdf · tiposDocumento
//  TipoDocumento plantilla · requisitos      RequisitoRuta tipoDocumento
//  Documento    solicitud · tipoDocumento · versionAnterior · paginas · extracciones · capturador · validador
//  DocumentoPagina documento · archivo
//  SolicitudCorreccion solicitud · documento · documentoNuevo · solicitante
//  Extraccion   documento · plantilla · campos · revisor        CampoExtraido extraccion · revisor
//  Mensaje      solicitud · autor · archivo   Notificacion usuario · solicitud
//  PaquetePdf   solicitud · archivo · generador · revisor
//  Envio        solicitud · paquetePdf · registrador · respuestas
//  RespuestaShriners solicitud · envio · registrador
//  Evaluacion   solicitud · registrador
//  ProveedorLocal departamento · municipio · derivaciones
//  DerivacionLocal solicitud · proveedor · anterior · registrador
//  Bitacora     usuario · solicitud           RegistroAcceso usuario · solicitud
//  ClaveIdempotencia usuario
//
// La columna generada pacientes.nombre_busqueda no está en el modelo (ver models/pacientes.js).

const fs = require('node:fs');
const path = require('node:path');
const { Sequelize, DataTypes } = require('sequelize');
const { config } = require('../config/env');
const { logger } = require('../core/logger');

const cfg = config();

const sequelize = new Sequelize(cfg.baseDatosUrl, {
  dialect: 'postgres',
  logging: cfg.logSql ? (sql) => logger.debug({ sql }, 'SQL') : false,
  define: { underscored: true, timestamps: true },
  pool: { max: 10, min: 0, idle: 10_000, acquire: 30_000 },
});

const db = { sequelize, Sequelize, DataTypes };

for (const archivo of fs.readdirSync(__dirname).sort()) {
  if (archivo === 'index.js' || !archivo.endsWith('.js')) continue;
  const modelo = require(path.join(__dirname, archivo))(sequelize, DataTypes);
  db[modelo.name] = modelo;
}

const {
  Usuario,
  Rol,
  Permiso,
  RolPermiso,
  Sesion,
  TokenRecuperacion,
  Dispositivo,
  Preferencia,
  Departamento,
  Municipio,
  Configuracion,
  Archivo,
  PlantillaFormulario,
  TipoDocumento,
  RequisitoRuta,
  Paciente,
  Tutor,
  PacienteTutor,
  Solicitud,
  SolicitudSeccion,
  TextoConsentimiento,
  Asignacion,
  HistorialEstado,
  Documento,
  DocumentoPagina,
  SolicitudCorreccion,
  ProfesionalSalud,
  Consentimiento,
  Extraccion,
  CampoExtraido,
  Mensaje,
  Notificacion,
  PaquetePdf,
  Envio,
  RespuestaShriners,
  ReglaRuta, // eslint-disable-line no-unused-vars -- sin asociaciones
  Evaluacion,
  ProveedorLocal,
  DerivacionLocal,
  Bitacora,
  RegistroAcceso,
  ClaveIdempotencia,
} = db;

/** belongsTo con alias y llave explícitas. */
const perteneceA = (origen, destino, as, foreignKey, extra = {}) =>
  origen.belongsTo(destino, { as, foreignKey, ...extra });

// --- Acceso
perteneceA(Usuario, Rol, 'rol', 'rolId');
Rol.hasMany(Usuario, { as: 'usuarios', foreignKey: 'rolId' });
Rol.belongsToMany(Permiso, {
  through: RolPermiso,
  as: 'permisos',
  foreignKey: 'rolId',
  otherKey: 'permisoId',
});
Permiso.belongsToMany(Rol, {
  through: RolPermiso,
  as: 'roles',
  foreignKey: 'permisoId',
  otherKey: 'rolId',
});

Usuario.hasMany(Sesion, { as: 'sesiones', foreignKey: 'usuarioId' });
perteneceA(Sesion, Usuario, 'usuario', 'usuarioId');
perteneceA(Sesion, Sesion, 'reemplazo', 'reemplazadaPor');
Usuario.hasMany(TokenRecuperacion, { as: 'tokens', foreignKey: 'usuarioId' });
perteneceA(TokenRecuperacion, Usuario, 'usuario', 'usuarioId');
Usuario.hasMany(Dispositivo, { as: 'dispositivos', foreignKey: 'usuarioId' });
perteneceA(Dispositivo, Usuario, 'usuario', 'usuarioId');
Usuario.hasOne(Preferencia, { as: 'preferencia', foreignKey: 'usuarioId' });
perteneceA(Preferencia, Usuario, 'usuario', 'usuarioId');
Usuario.hasMany(Notificacion, { as: 'notificaciones', foreignKey: 'usuarioId' });
perteneceA(Notificacion, Usuario, 'usuario', 'usuarioId');

// --- Catálogos
Departamento.hasMany(Municipio, { as: 'municipios', foreignKey: 'departamentoCodigo' });
perteneceA(Municipio, Departamento, 'departamento', 'departamentoCodigo');
perteneceA(Configuracion, Usuario, 'actualizador', 'actualizadoPor');

// --- Archivos, plantillas y requisitos
perteneceA(Archivo, Usuario, 'autorSubida', 'subidoPor');
perteneceA(PlantillaFormulario, Archivo, 'archivoPdf', 'archivoPdfId');
PlantillaFormulario.hasMany(TipoDocumento, { as: 'tiposDocumento', foreignKey: 'plantillaId' });
perteneceA(TipoDocumento, PlantillaFormulario, 'plantilla', 'plantillaId');
TipoDocumento.hasMany(RequisitoRuta, { as: 'requisitos', foreignKey: 'tipoDocumentoId' });
perteneceA(RequisitoRuta, TipoDocumento, 'tipoDocumento', 'tipoDocumentoId');

// --- Pacientes y tutores
perteneceA(Paciente, Municipio, 'municipio', 'municipioCodigo');
perteneceA(Paciente, Archivo, 'foto', 'fotoArchivoId');
perteneceA(Paciente, Usuario, 'creador', 'creadoPor');
Paciente.belongsToMany(Tutor, {
  through: PacienteTutor,
  as: 'tutores',
  foreignKey: 'pacienteId',
  otherKey: 'tutorId',
});
Tutor.belongsToMany(Paciente, {
  through: PacienteTutor,
  as: 'pacientes',
  foreignKey: 'tutorId',
  otherKey: 'pacienteId',
});
Paciente.hasMany(PacienteTutor, { as: 'vinculos', foreignKey: 'pacienteId' });
Tutor.hasMany(PacienteTutor, { as: 'vinculos', foreignKey: 'tutorId' });
perteneceA(PacienteTutor, Paciente, 'paciente', 'pacienteId');
perteneceA(PacienteTutor, Tutor, 'tutor', 'tutorId');
perteneceA(PacienteTutor, Usuario, 'confirmador', 'confirmadoPor');
perteneceA(Tutor, Usuario, 'usuario', 'usuarioId');
Usuario.hasMany(Tutor, { as: 'perfilesTutor', foreignKey: 'usuarioId' });

// --- Solicitud y todo lo que cuelga de ella
Paciente.hasMany(Solicitud, { as: 'solicitudes', foreignKey: 'pacienteId' });
perteneceA(Solicitud, Paciente, 'paciente', 'pacienteId');
perteneceA(Solicitud, Usuario, 'coordinador', 'coordinadorId');
perteneceA(Solicitud, Usuario, 'creador', 'creadaPor');

/** Hijos de Solicitud: alias en la solicitud → modelo hijo. Cada hijo tiene `solicitud`. */
const hijosDeSolicitud = {
  secciones: SolicitudSeccion,
  consentimientos: Consentimiento,
  asignaciones: Asignacion,
  historial: HistorialEstado,
  documentos: Documento,
  correcciones: SolicitudCorreccion,
  mensajes: Mensaje,
  notificaciones: Notificacion,
  paquetes: PaquetePdf,
  envios: Envio,
  respuestas: RespuestaShriners,
  evaluaciones: Evaluacion,
  derivaciones: DerivacionLocal,
  bitacora: Bitacora,
  accesos: RegistroAcceso,
};
for (const [alias, Hijo] of Object.entries(hijosDeSolicitud)) {
  Solicitud.hasMany(Hijo, { as: alias, foreignKey: 'solicitudId' });
  perteneceA(Hijo, Solicitud, 'solicitud', 'solicitudId');
}
Solicitud.hasOne(ProfesionalSalud, { as: 'profesionalSalud', foreignKey: 'solicitudId' });
perteneceA(ProfesionalSalud, Solicitud, 'solicitud', 'solicitudId');

perteneceA(SolicitudSeccion, Usuario, 'actualizador', 'actualizadoPor');
perteneceA(ProfesionalSalud, Documento, 'certificacion', 'documentoCertificacionId');
perteneceA(Consentimiento, TextoConsentimiento, 'texto', 'textoId');
perteneceA(Consentimiento, Usuario, 'decisor', 'decididoPor');
perteneceA(Consentimiento, Documento, 'documentoFirmado', 'documentoFirmadoId');
perteneceA(Asignacion, Usuario, 'voluntario', 'voluntarioId');
perteneceA(Asignacion, Usuario, 'asignador', 'asignadoPor');
Usuario.hasMany(Asignacion, { as: 'asignaciones', foreignKey: 'voluntarioId' });
perteneceA(HistorialEstado, Usuario, 'usuario', 'usuarioId');

// --- Documentos y OCR
perteneceA(Documento, TipoDocumento, 'tipoDocumento', 'tipoDocumentoId');
perteneceA(Documento, Documento, 'versionAnterior', 'reemplazaA');
perteneceA(Documento, Usuario, 'capturador', 'capturadoPor');
perteneceA(Documento, Usuario, 'validador', 'validadoPor');
Documento.hasMany(DocumentoPagina, { as: 'paginas', foreignKey: 'documentoId' });
perteneceA(DocumentoPagina, Documento, 'documento', 'documentoId');
perteneceA(DocumentoPagina, Archivo, 'archivo', 'archivoId');
perteneceA(SolicitudCorreccion, Documento, 'documento', 'documentoId');
perteneceA(SolicitudCorreccion, Documento, 'documentoNuevo', 'resueltaConDocumentoId');
perteneceA(SolicitudCorreccion, Usuario, 'solicitante', 'solicitadoPor');
Documento.hasMany(Extraccion, { as: 'extracciones', foreignKey: 'documentoId' });
perteneceA(Extraccion, Documento, 'documento', 'documentoId');
perteneceA(Extraccion, PlantillaFormulario, 'plantilla', 'plantillaId');
perteneceA(Extraccion, Usuario, 'revisor', 'revisadoPor');
Extraccion.hasMany(CampoExtraido, { as: 'campos', foreignKey: 'extraccionId' });
perteneceA(CampoExtraido, Extraccion, 'extraccion', 'extraccionId');
perteneceA(CampoExtraido, Usuario, 'revisor', 'revisadoPor');

// --- Comunicación
perteneceA(Mensaje, Usuario, 'autor', 'autorId');
perteneceA(Mensaje, Archivo, 'archivo', 'archivoId');

// --- Envío a Shriners
perteneceA(PaquetePdf, Archivo, 'archivo', 'archivoId');
perteneceA(PaquetePdf, Usuario, 'generador', 'generadoPor');
perteneceA(PaquetePdf, Usuario, 'revisor', 'revisadoPor');
perteneceA(Envio, PaquetePdf, 'paquetePdf', 'paquetePdfId');
perteneceA(Envio, Usuario, 'registrador', 'registradoPor');
Envio.hasMany(RespuestaShriners, { as: 'respuestas', foreignKey: 'envioId' });
perteneceA(RespuestaShriners, Envio, 'envio', 'envioId');
perteneceA(RespuestaShriners, Usuario, 'registrador', 'registradoPor');

// --- Ruta y Honduras
perteneceA(Evaluacion, Usuario, 'registrador', 'registradoPor');
perteneceA(ProveedorLocal, Departamento, 'departamento', 'departamentoCodigo');
perteneceA(ProveedorLocal, Municipio, 'municipio', 'municipioCodigo');
ProveedorLocal.hasMany(DerivacionLocal, { as: 'derivaciones', foreignKey: 'proveedorId' });
perteneceA(DerivacionLocal, ProveedorLocal, 'proveedor', 'proveedorId');
perteneceA(DerivacionLocal, DerivacionLocal, 'anterior', 'reemplazaA');
perteneceA(DerivacionLocal, Usuario, 'registrador', 'registradoPor');

// --- Auditoría y técnica
perteneceA(Bitacora, Usuario, 'usuario', 'usuarioId');
perteneceA(RegistroAcceso, Usuario, 'usuario', 'usuarioId');
perteneceA(ClaveIdempotencia, Usuario, 'usuario', 'usuarioId');

module.exports = db;
