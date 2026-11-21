'use strict';

// Registro, inicio de sesión, refresh rotativo, cierre de sesión, recuperación de contraseña,
// invitaciones y verificación de correo.

const crypto = require('node:crypto');
const { Op, fn, col, where } = require('sequelize');
const { config } = require('../../config/env');
const { logger } = require('../../core/logger');
const contexto = require('../../core/contexto');
const { firmarAcceso } = require('../../core/auth/jwt');
const { permisosDe } = require('../../core/auth');
const { registrarBitacora } = require('../../core/auditoria');
const { enviarCorreo } = require('../../core/correo');
const { ROLES } = require('../../core/estados/constantes');
const errores = require('./auth.errores');
const { hashear, verificar, verificarFicticio, validarPolitica } = require('./contrasenas');
const { DURACION_MS, generarSecreto, hashToken, enlaceDeToken } = require('./tokens');

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

const modelos = () => require('../../models');

/** @param {string} correo ya normalizado (minúsculas) */
function buscarPorCorreo(correo, opciones = {}) {
  const { Usuario } = modelos();
  return Usuario.findOne({
    where: where(fn('lower', col('Usuario.correo')), correo),
    include: [{ association: 'rol' }],
    ...opciones,
  });
}

/** Envía un correo sin hacer fallar la petición (se registra el error). */
async function enviarSinFallar(datos) {
  try {
    await enviarCorreo(datos);
  } catch (err) {
    logger.error({ err, plantilla: datos.plantilla }, 'No se pudo enviar el correo');
  }
}

async function exigeCorreoVerificado() {
  const { Configuracion } = modelos();
  const fila = await Configuracion.findByPk('auth.exigir_correo_verificado');
  return fila?.valor === true;
}

async function crearSesion(usuario, { dispositivo, ip, cadenaId, transaction }) {
  const { Sesion } = modelos();
  const refreshToken = generarSecreto();
  const ahora = new Date();
  const sesion = await Sesion.create(
    {
      usuarioId: usuario.id,
      hashRefresh: hashToken(refreshToken),
      cadenaId: cadenaId ?? crypto.randomUUID(),
      dispositivo: dispositivo ?? null,
      ip: ip ?? null,
      expiraEn: new Date(ahora.getTime() + config().jwt.refreshTtlDias * DIA_MS),
      ultimoUsoEn: ahora,
    },
    { transaction },
  );
  return { sesion, refreshToken };
}

async function respuestaSesion(usuario, rol, sesion, refreshToken) {
  const { token, expiraEn } = firmarAcceso({ sub: usuario.id, rol, sid: sesion.id });
  return {
    accessToken: token,
    refreshToken,
    expiraEn,
    usuario: {
      id: usuario.id,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
      rol,
      permisos: [...(await permisosDe(rol))].sort(),
      idioma: usuario.idioma,
      correoVerificado: Boolean(usuario.correoVerificadoEn),
    },
  };
}

// --- Tokens de un solo uso y sesiones (también los usan los contratos)

/**
 * Emite un token de un solo uso e invalida los anteriores del mismo tipo.
 * @returns {Promise<{ token: string, expiraEn: Date }>}
 */
async function emitirToken({ usuarioId, tipo, transaction }) {
  if (!DURACION_MS[tipo]) throw new Error(`Tipo de token desconocido: ${tipo}`);
  const { TokenRecuperacion } = modelos();
  const ahora = new Date();
  await TokenRecuperacion.update(
    { usadoEn: ahora },
    { where: { usuarioId, tipo, usadoEn: null }, transaction },
  );
  const token = generarSecreto();
  const expiraEn = new Date(ahora.getTime() + DURACION_MS[tipo]);
  await TokenRecuperacion.create(
    { usuarioId, hash: hashToken(token), tipo, expiraEn },
    { transaction },
  );
  return { token, expiraEn };
}

/**
 * Revoca las sesiones vigentes del usuario, salvo `excepto`.
 * @returns {Promise<number>}
 */
async function revocarSesiones({ usuarioId, excepto, transaction }) {
  const { Sesion } = modelos();
  const [cuantas] = await Sesion.update(
    { revocadaEn: new Date() },
    {
      where: { usuarioId, revocadaEn: null, ...(excepto ? { id: { [Op.ne]: excepto } } : {}) },
      transaction,
    },
  );
  return cuantas;
}

/** Marca como usado un token vigente de los tipos dados, o lanza AUTH_TOKEN_INVALIDO. */
async function consumirToken(token, tipos, transaction) {
  const { TokenRecuperacion } = modelos();
  const registro = await TokenRecuperacion.findOne({
    where: { hash: hashToken(token), tipo: tipos },
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  if (!registro || registro.usadoEn || registro.expiraEn <= new Date())
    throw errores.tokenInvalido();
  await registro.update({ usadoEn: new Date() }, { transaction });
  return registro;
}

// --- Casos de uso

/** POST /auth/register: crea una cuenta de familia y devuelve la sesión. */
async function registrar(datos, meta) {
  const { sequelize, Usuario, Rol } = modelos();
  if (await buscarPorCorreo(datos.correo)) throw errores.correoEnUso();
  validarPolitica(datos.contrasena, datos.correo);
  const hash = await hashear(datos.contrasena);

  let resultado;
  try {
    resultado = await sequelize.transaction(async (transaction) => {
      const rol = await Rol.findOne({ where: { codigo: ROLES.FAMILIA }, transaction });
      const usuario = await Usuario.create(
        {
          correo: datos.correo,
          hashContrasena: hash,
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          telefono: datos.telefono,
          idioma: datos.idioma,
          estado: 'activo',
          rolId: rol.id,
          terminosVersion: datos.terminosVersion,
          terminosAceptadosEn: new Date(),
        },
        { transaction },
      );
      contexto.asignarUsuario({ id: usuario.id, rol: ROLES.FAMILIA });
      await registrarBitacora({
        accion: 'auth.registro',
        entidad: 'usuarios',
        entidadId: usuario.id,
        despues: {
          correo: usuario.correo,
          rol: ROLES.FAMILIA,
          idioma: usuario.idioma,
          terminosVersion: usuario.terminosVersion,
        },
        transaction,
      });
      const verificacion = await emitirToken({
        usuarioId: usuario.id,
        tipo: 'verificar_correo',
        transaction,
      });
      const nueva = await crearSesion(usuario, { ...meta, transaction });
      return { usuario, verificacion, ...nueva };
    });
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') throw errores.correoEnUso();
    throw err;
  }

  const { usuario, verificacion, sesion, refreshToken } = resultado;
  await enviarSinFallar({
    plantilla: 'verificar_correo',
    para: usuario.correo,
    idioma: usuario.idioma,
    variables: {
      nombre: usuario.nombres,
      enlace: enlaceDeToken('verificar_correo', verificacion.token),
    },
  });
  return respuestaSesion(usuario, ROLES.FAMILIA, sesion, refreshToken);
}

/** POST /auth/login. Sin enumeración de cuentas y con bloqueo temporal. */
async function iniciarSesion({ correo, contrasena, dispositivo }, meta) {
  const { sequelize } = modelos();
  const usuario = await buscarPorCorreo(correo);
  if (!usuario) {
    await verificarFicticio(contrasena);
    throw errores.credencialesInvalidas();
  }
  const ahora = new Date();
  if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > ahora) throw errores.cuentaBloqueada();

  const correcta = usuario.hashContrasena
    ? await verificar(usuario.hashContrasena, contrasena)
    : await verificarFicticio(contrasena);

  if (!correcta) {
    const [[{ intentos }]] = await sequelize.query(
      'UPDATE usuarios SET intentos_fallidos = intentos_fallidos + 1 WHERE id = :id RETURNING intentos_fallidos AS intentos',
      { replacements: { id: usuario.id } },
    );
    if (intentos >= MAX_INTENTOS) {
      await sequelize.transaction(async (transaction) => {
        await usuario.update(
          { intentosFallidos: 0, bloqueadoHasta: new Date(ahora.getTime() + BLOQUEO_MS) },
          { transaction },
        );
        await registrarBitacora({
          accion: 'auth.bloqueo',
          entidad: 'usuarios',
          entidadId: usuario.id,
          transaction,
        });
      });
      throw errores.cuentaBloqueada();
    }
    throw errores.credencialesInvalidas();
  }

  if (usuario.estado !== 'activo') throw errores.credencialesInvalidas();
  if (!usuario.correoVerificadoEn && (await exigeCorreoVerificado()))
    throw errores.correoNoVerificado();

  const { sesion, refreshToken } = await sequelize.transaction(async (transaction) => {
    await usuario.update(
      { intentosFallidos: 0, bloqueadoHasta: null, ultimoAccesoEn: ahora },
      { transaction },
    );
    return crearSesion(usuario, {
      dispositivo: dispositivo ?? meta.dispositivo,
      ip: meta.ip,
      transaction,
    });
  });
  return respuestaSesion(usuario, usuario.rol.codigo, sesion, refreshToken);
}

/**
 * POST /auth/refresh. Rota el refresh token; si llega uno ya rotado (posible robo), revoca toda
 * la cadena de sesiones de ese dispositivo.
 */
async function refrescar({ refreshToken }, meta) {
  const { sequelize, Sesion, Usuario } = modelos();
  const resultado = await sequelize.transaction(async (transaction) => {
    const sesion = await Sesion.findOne({
      where: { hashRefresh: hashToken(refreshToken) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!sesion) return { tipo: 'invalido' };
    const ahora = new Date();
    if (sesion.revocadaEn) {
      if (!sesion.reemplazadaPor) return { tipo: 'invalido' };
      await Sesion.update(
        { revocadaEn: ahora },
        { where: { cadenaId: sesion.cadenaId, revocadaEn: null }, transaction },
      );
      await registrarBitacora({
        accion: 'auth.reuso_refresh',
        entidad: 'sesiones',
        entidadId: sesion.id,
        despues: { cadenaId: sesion.cadenaId },
        transaction,
      });
      return { tipo: 'invalido' };
    }
    if (sesion.expiraEn <= ahora) return { tipo: 'invalido' };
    const usuario = await Usuario.findByPk(sesion.usuarioId, { include: ['rol'], transaction });
    if (!usuario || usuario.estado !== 'activo') return { tipo: 'invalido' };

    const nueva = await crearSesion(usuario, {
      dispositivo: sesion.dispositivo,
      ip: meta.ip,
      cadenaId: sesion.cadenaId,
      transaction,
    });
    await sesion.update(
      { revocadaEn: ahora, reemplazadaPor: nueva.sesion.id, ultimoUsoEn: ahora },
      { transaction },
    );
    return { tipo: 'ok', usuario, ...nueva };
  });
  if (resultado.tipo !== 'ok') throw errores.refreshInvalido();
  return respuestaSesion(
    resultado.usuario,
    resultado.usuario.rol.codigo,
    resultado.sesion,
    resultado.refreshToken,
  );
}

/** POST /auth/logout: revoca la sesión actual (y la del refresh enviado) y borra el dispositivo. */
async function cerrarSesion(usuario, { refreshToken, tokenFcm }) {
  const { sequelize, Sesion, Dispositivo } = modelos();
  await sequelize.transaction(async (transaction) => {
    const ahora = new Date();
    await Sesion.update(
      { revocadaEn: ahora },
      { where: { id: usuario.sesionId, revocadaEn: null }, transaction },
    );
    if (refreshToken) {
      await Sesion.update(
        { revocadaEn: ahora },
        {
          where: { hashRefresh: hashToken(refreshToken), usuarioId: usuario.id, revocadaEn: null },
          transaction,
        },
      );
    }
    if (tokenFcm)
      await Dispositivo.destroy({ where: { tokenFcm, usuarioId: usuario.id }, transaction });
  });
}

/** POST /auth/password/forgot: siempre la misma respuesta. */
async function olvidarContrasena({ correo }) {
  const { sequelize } = modelos();
  const usuario = await buscarPorCorreo(correo);
  if (!usuario || usuario.estado !== 'activo') return;
  const { token } = await sequelize.transaction(async (transaction) => {
    const emitido = await emitirToken({ usuarioId: usuario.id, tipo: 'recuperar', transaction });
    await registrarBitacora({
      accion: 'auth.solicitud_recuperacion',
      entidad: 'usuarios',
      entidadId: usuario.id,
      transaction,
    });
    return emitido;
  });
  // Sin esperar el envío, para que la respuesta tarde lo mismo exista o no el correo.
  void enviarSinFallar({
    plantilla: 'recuperar_contrasena',
    para: usuario.correo,
    idioma: usuario.idioma,
    variables: { nombre: usuario.nombres, enlace: enlaceDeToken('recuperar', token), minutos: 45 },
  });
}

/** POST /auth/password/reset: también acepta invitaciones (activa la cuenta del personal). */
async function restablecerContrasena({ token, contrasena }) {
  const { sequelize, Usuario } = modelos();
  await sequelize.transaction(async (transaction) => {
    const registro = await consumirToken(token, ['recuperar', 'invitar'], transaction);
    const usuario = await Usuario.findByPk(registro.usuarioId, { transaction });
    const esperado = registro.tipo === 'invitar' ? 'invitado' : 'activo';
    if (!usuario || usuario.estado !== esperado) throw errores.tokenInvalido();
    validarPolitica(contrasena, usuario.correo);

    const ahora = new Date();
    const cambios = {
      hashContrasena: await hashear(contrasena),
      intentosFallidos: 0,
      bloqueadoHasta: null,
    };
    if (registro.tipo === 'invitar') {
      cambios.estado = 'activo';
      cambios.correoVerificadoEn = usuario.correoVerificadoEn ?? ahora;
    }
    await usuario.update(cambios, { transaction });
    await revocarSesiones({ usuarioId: usuario.id, transaction });
    await registrarBitacora({
      accion:
        registro.tipo === 'invitar' ? 'auth.invitacion_aceptada' : 'auth.restablecer_contrasena',
      entidad: 'usuarios',
      entidadId: usuario.id,
      transaction,
    });
  });
}

/** POST /auth/correo/verificar */
async function verificarCorreo({ token }) {
  const { sequelize, Usuario } = modelos();
  await sequelize.transaction(async (transaction) => {
    const registro = await consumirToken(token, ['verificar_correo'], transaction);
    const usuario = await Usuario.findByPk(registro.usuarioId, { transaction });
    if (!usuario) throw errores.tokenInvalido();
    if (!usuario.correoVerificadoEn)
      await usuario.update({ correoVerificadoEn: new Date() }, { transaction });
    await registrarBitacora({
      accion: 'auth.correo_verificado',
      entidad: 'usuarios',
      entidadId: usuario.id,
      transaction,
    });
  });
}

/** POST /auth/correo/reenviar */
async function reenviarVerificacion(usuarioAutenticado) {
  const { sequelize, Usuario } = modelos();
  const usuario = await Usuario.findByPk(usuarioAutenticado.id);
  if (usuario.correoVerificadoEn) throw errores.correoYaVerificado();
  const { token } = await sequelize.transaction((transaction) =>
    emitirToken({ usuarioId: usuario.id, tipo: 'verificar_correo', transaction }),
  );
  await enviarSinFallar({
    plantilla: 'verificar_correo',
    para: usuario.correo,
    idioma: usuario.idioma,
    variables: { nombre: usuario.nombres, enlace: enlaceDeToken('verificar_correo', token) },
  });
}

module.exports = {
  MAX_INTENTOS,
  BLOQUEO_MS,
  buscarPorCorreo,
  emitirToken,
  revocarSesiones,
  registrar,
  iniciarSesion,
  refrescar,
  cerrarSesion,
  olvidarContrasena,
  restablecerContrasena,
  verificarCorreo,
  reenviarVerificacion,
};
