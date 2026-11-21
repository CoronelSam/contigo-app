'use strict';

// Perfil propio, cambio de contraseña, preferencias de notificación y dispositivos push.

const { permisosDe } = require('../../core/auth');
const { auditarCambio, registrarBitacora } = require('../../core/auditoria');
const errores = require('./auth.errores');
const { hashear, verificar, validarPolitica } = require('./contrasenas');
const { revocarSesiones } = require('./auth.service');
const { CATEGORIAS_PUSH } = require('./auth.schemas');

const modelos = () => require('../../models');

/** Push activado en todas las categorías hasta que el usuario diga otra cosa. */
const PREFERENCIAS_POR_DEFECTO = Object.freeze({
  push: Object.freeze(Object.fromEntries(CATEGORIAS_PUSH.map((c) => [c, true]))),
});

async function formatearPerfil(usuario) {
  const rol = usuario.rol.codigo;
  return {
    id: usuario.id,
    correo: usuario.correo,
    nombres: usuario.nombres,
    apellidos: usuario.apellidos,
    telefono: usuario.telefono,
    idioma: usuario.idioma,
    rol,
    permisos: [...(await permisosDe(rol))].sort(),
    correoVerificado: Boolean(usuario.correoVerificadoEn),
    terminosVersion: usuario.terminosVersion,
    creadoEn: usuario.createdAt.toISOString(),
  };
}

const cargar = (id, opciones = {}) =>
  modelos().Usuario.findByPk(id, { include: ['rol'], ...opciones });

/** GET /me */
async function obtenerPerfil({ id }) {
  return formatearPerfil(await cargar(id));
}

/** PATCH /me (el correo no se cambia en v1). */
async function actualizarPerfil({ id }, cambios) {
  const { sequelize } = modelos();
  const usuario = await sequelize.transaction(async (transaction) => {
    const u = await cargar(id, { transaction });
    await auditarCambio(u, cambios, { transaction, accion: 'usuarios.actualizar_perfil' });
    return u;
  });
  return formatearPerfil(usuario);
}

/** PATCH /me/password: revoca las demás sesiones, no la actual. */
async function cambiarContrasena({ id, sesionId }, { actual, nueva }) {
  const { sequelize } = modelos();
  const usuario = await cargar(id);
  if (!(await verificar(usuario.hashContrasena, actual)))
    throw errores.contrasenaActualIncorrecta();
  validarPolitica(nueva, usuario.correo, 'nueva');
  const hash = await hashear(nueva);
  await sequelize.transaction(async (transaction) => {
    await usuario.update({ hashContrasena: hash }, { transaction });
    await revocarSesiones({ usuarioId: id, excepto: sesionId, transaction });
    await registrarBitacora({
      accion: 'auth.cambio_contrasena',
      entidad: 'usuarios',
      entidadId: id,
      transaction,
    });
  });
}

function combinar(guardadas) {
  return { push: { ...PREFERENCIAS_POR_DEFECTO.push, ...(guardadas?.push ?? {}) } };
}

/** GET /me/preferencias */
async function obtenerPreferencias({ id }) {
  const fila = await modelos().Preferencia.findOne({ where: { usuarioId: id } });
  return combinar(fila?.notificaciones);
}

/** PUT /me/preferencias: las categorías omitidas conservan su valor. */
async function guardarPreferencias({ id }, { push }) {
  const { Preferencia } = modelos();
  const fila = await Preferencia.findOne({ where: { usuarioId: id } });
  const notificaciones = combinar({ push: { ...(fila?.notificaciones?.push ?? {}), ...push } });
  if (fila) await fila.update({ notificaciones });
  else await Preferencia.create({ usuarioId: id, notificaciones });
  return notificaciones;
}

/** POST /me/dispositivos: un token FCM pertenece al último usuario que lo registró. */
async function registrarDispositivo({ id }, { tokenFcm, plataforma }) {
  const { Dispositivo } = modelos();
  const ahora = new Date();
  const existente = await Dispositivo.findOne({ where: { tokenFcm } });
  if (existente) await existente.update({ usuarioId: id, plataforma, ultimoUsoEn: ahora });
  else await Dispositivo.create({ usuarioId: id, tokenFcm, plataforma, ultimoUsoEn: ahora });
  return { plataforma, registrado: true };
}

module.exports = {
  PREFERENCIAS_POR_DEFECTO,
  obtenerPerfil,
  actualizarPerfil,
  cambiarContrasena,
  obtenerPreferencias,
  guardarPreferencias,
  registrarDispositivo,
};
