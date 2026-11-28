'use strict';

// Usuarios del personal (52) y roles (53).
// - El personal entra solo por invitación: cuenta `invitado` sin contraseña y un enlace de un solo
//   uso para crearla (POST /auth/password/reset la activa).
// - Nadie se borra: se desactiva y se revocan sus sesiones en la misma transacción.
// - Ninguna respuesta lleva hashes, contraseñas ni tokens.

const { Op, fn, col, where: donde, UniqueConstraintError } = require('sequelize');
const { registrarBitacora, auditarCambio } = require('../../core/auditoria');
const { esUuid } = require('../../core/acceso');
const correo = require('../../core/correo');
const { logger } = require('../../core/logger');
const { ROLES } = require('../../core/estados/constantes');
const { emitirToken, revocarSesiones } = require('../auth/contratos');
const { enlaceDeToken, DURACION_MS } = require('../auth/tokens');
const errores = require('./admin.errores');

const modelos = () => require('../../models');

const HORA_MS = 60 * 60 * 1000;
const ESTADOS = ['invitado', 'activo', 'inactivo'];

/** Una sola transacción a la vez puede cambiar el rol o el estado de un administrador. */
const LLAVE_ADMINISTRADORES = 'admin.administradores';

/** Escapa los comodines de LIKE para buscar el texto tal cual. */
const patronLike = (texto) => `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const iso = (fecha) => (fecha ? fecha.toISOString() : null);

/** @param {object} usuario Instancia con `rol` cargado (o `rolCodigo`). */
function formatear(usuario, rolCodigo) {
  return {
    id: usuario.id,
    correo: usuario.correo,
    nombres: usuario.nombres,
    apellidos: usuario.apellidos,
    telefono: usuario.telefono ?? null,
    rol: rolCodigo ?? usuario.rol.codigo,
    estado: usuario.estado,
    idioma: usuario.idioma,
    correoVerificado: Boolean(usuario.correoVerificadoEn),
    ultimoAccesoEn: iso(usuario.ultimoAccesoEn),
    creadoEn: iso(usuario.createdAt),
  };
}

/**
 * GET /admin/usuarios
 * @param {{ q?: string, rol?: string, estado?: string, page: number, limit: number }} filtros
 */
async function listar({ q, rol, estado, page, limit }) {
  const { Usuario } = modelos();
  const where = {};
  if (estado) where.estado = estado;
  if (q) {
    const patron = patronLike(q);
    where[Op.or] = [
      { correo: { [Op.iLike]: patron } },
      donde(fn('concat_ws', ' ', col('nombres'), col('apellidos')), { [Op.iLike]: patron }),
    ];
  }
  const { rows, count } = await Usuario.findAndCountAll({
    where,
    include: [
      { association: 'rol', attributes: ['codigo'], ...(rol ? { where: { codigo: rol } } : {}) },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit,
    offset: (page - 1) * limit,
  });
  return {
    datos: rows.map((u) => formatear(u)),
    paginacion: { page, limit, total: count },
  };
}

/** Envía el correo de invitación después del commit. Un fallo no deshace la invitación. */
async function enviarInvitacion(usuario, rol, token) {
  try {
    await correo.enviarCorreo({
      plantilla: 'invitacion',
      para: usuario.correo,
      idioma: usuario.idioma,
      variables: {
        nombre: usuario.nombres,
        enlace: enlaceDeToken('invitar', token),
        rol: usuario.idioma === 'en' ? rol.nombreEn : rol.nombreEs,
        horas: Math.round(DURACION_MS.invitar / HORA_MS),
      },
    });
    return true;
  } catch (err) {
    logger.error({ err, usuarioId: usuario.id }, 'No se pudo enviar la invitación');
    return false;
  }
}

/**
 * POST /admin/usuarios: invitación de personal.
 * @param {{ correo: string, nombres: string, apellidos: string, telefono?: string,
 *   rol: 'voluntario' | 'coordinador' | 'administrador', idioma: 'es' | 'en' }} datos
 */
async function invitar(datos) {
  const { sequelize, Usuario, Rol } = modelos();
  const rol = await Rol.findOne({ where: { codigo: datos.rol } });
  let emitido;
  let usuario;
  try {
    ({ usuario, emitido } = await sequelize.transaction(async (transaction) => {
      const existe = await Usuario.findOne({
        where: donde(fn('lower', col('correo')), datos.correo),
        attributes: ['id'],
        transaction,
      });
      if (existe) throw errores.correoExiste();
      const nuevo = await Usuario.create(
        {
          correo: datos.correo,
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          telefono: datos.telefono ?? null,
          idioma: datos.idioma,
          estado: 'invitado',
          rolId: rol.id,
          hashContrasena: null,
        },
        { transaction },
      );
      const token = await emitirToken({ usuarioId: nuevo.id, tipo: 'invitar', transaction });
      await registrarBitacora({
        accion: 'usuarios.invitar',
        entidad: 'usuarios',
        entidadId: nuevo.id,
        despues: { rol: rol.codigo, estado: 'invitado' },
        transaction,
      });
      return { usuario: nuevo, emitido: token };
    }));
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw errores.correoExiste();
    throw err;
  }
  const correoEnviado = await enviarInvitacion(usuario, rol, emitido.token);
  return {
    ...formatear(usuario, rol.codigo),
    invitacion: { expiraEn: iso(emitido.expiraEn), correoEnviado },
  };
}

/** Administradores activos además de `excepto`. */
async function otrosAdministradoresActivos(excepto, transaction) {
  const { Usuario } = modelos();
  return Usuario.count({
    where: { estado: 'activo', id: { [Op.ne]: excepto } },
    include: [{ association: 'rol', where: { codigo: ROLES.ADMINISTRADOR }, attributes: [] }],
    transaction,
  });
}

/**
 * PATCH /admin/usuarios/:id
 * @param {{ id: string }} actor Administrador que hace el cambio.
 * @param {string} id
 * @param {{ nombres?: string, apellidos?: string, telefono?: string | null, rol?: string,
 *   estado?: 'activo' | 'inactivo', motivo?: string, reenviarInvitacion?: true }} cambios
 */
async function cambiar(actor, id, cambios) {
  if (!esUuid(id)) throw errores.usuarioNoEncontrado();
  const { sequelize, Usuario, Rol } = modelos();
  const { motivo, reenviarInvitacion } = cambios;

  const resultado = await sequelize.transaction(async (transaction) => {
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:llave))', {
      replacements: { llave: LLAVE_ADMINISTRADORES },
      transaction,
    });
    const usuario = await Usuario.findByPk(id, { lock: transaction.LOCK.UPDATE, transaction });
    if (!usuario) throw errores.usuarioNoEncontrado();
    const rolActual = await Rol.findByPk(usuario.rolId, { transaction });

    const rolNuevo =
      cambios.rol !== undefined && cambios.rol !== rolActual.codigo
        ? await Rol.findOne({ where: { codigo: cambios.rol }, transaction })
        : null;
    if (rolNuevo) {
      if (rolActual.codigo === ROLES.FAMILIA || rolNuevo.codigo === ROLES.FAMILIA) {
        throw errores.rolNoPermitido();
      }
      if (!motivo) throw errores.motivoRequerido();
    }

    const sinContrasena = !usuario.hashContrasena;
    const desactivar = cambios.estado === 'inactivo' && usuario.estado !== 'inactivo';
    const activar = cambios.estado === 'activo' && usuario.estado !== 'activo';
    if (activar && (usuario.estado === 'invitado' || sinContrasena)) {
      throw errores.invitacionPendiente();
    }
    const reabrirInvitacion = reenviarInvitacion && usuario.estado === 'inactivo' && sinContrasena;
    if (reenviarInvitacion && usuario.estado !== 'invitado' && !reabrirInvitacion) {
      throw errores.noInvitado();
    }

    // Nunca sin administradores activos; nunca contra la propia cuenta.
    const pierdeAdministrador =
      rolActual.codigo === ROLES.ADMINISTRADOR &&
      usuario.estado === 'activo' &&
      (desactivar || (rolNuevo && rolNuevo.codigo !== ROLES.ADMINISTRADOR));
    if (pierdeAdministrador) {
      if (!(await otrosAdministradoresActivos(usuario.id, transaction))) {
        throw errores.ultimoAdministrador();
      }
      if (usuario.id === actor.id) throw errores.propiaCuenta();
    }

    // Datos de contacto
    const datos = {};
    for (const campo of ['nombres', 'apellidos', 'telefono']) {
      if (cambios[campo] !== undefined) datos[campo] = cambios[campo];
    }
    if (Object.keys(datos).length) {
      await auditarCambio(usuario, datos, { transaction, accion: 'usuarios.actualizar' });
    }

    if (rolNuevo) {
      await usuario.update({ rolId: rolNuevo.id }, { transaction });
      await registrarBitacora({
        accion: 'usuarios.cambiar_rol',
        entidad: 'usuarios',
        entidadId: usuario.id,
        antes: { rol: rolActual.codigo },
        despues: { rol: rolNuevo.codigo, motivo },
        transaction,
      });
    }

    let sesionesRevocadas;
    if (desactivar || activar) {
      const estadoAnterior = usuario.estado;
      await usuario.update({ estado: cambios.estado }, { transaction });
      if (desactivar)
        sesionesRevocadas = await revocarSesiones({ usuarioId: usuario.id, transaction });
      await registrarBitacora({
        accion: desactivar ? 'usuarios.desactivar' : 'usuarios.reactivar',
        entidad: 'usuarios',
        entidadId: usuario.id,
        antes: { estado: estadoAnterior },
        despues: { estado: cambios.estado, ...(motivo ? { motivo } : {}) },
        transaction,
      });
    }

    let emitido;
    if (reenviarInvitacion) {
      if (reabrirInvitacion) await usuario.update({ estado: 'invitado' }, { transaction });
      emitido = await emitirToken({ usuarioId: usuario.id, tipo: 'invitar', transaction });
      await registrarBitacora({
        accion: 'usuarios.reenviar_invitacion',
        entidad: 'usuarios',
        entidadId: usuario.id,
        ...(reabrirInvitacion
          ? { antes: { estado: 'inactivo' }, despues: { estado: 'invitado' } }
          : {}),
        transaction,
      });
    }

    return { usuario, rol: rolNuevo ?? rolActual, sesionesRevocadas, emitido };
  });

  const { usuario, rol, sesionesRevocadas, emitido } = resultado;
  const salida = formatear(usuario, rol.codigo);
  if (sesionesRevocadas !== undefined) salida.sesionesRevocadas = sesionesRevocadas;
  if (emitido) {
    salida.invitacion = {
      expiraEn: iso(emitido.expiraEn),
      correoEnviado: await enviarInvitacion(usuario, rol, emitido.token),
    };
  }
  return salida;
}

/** GET /admin/roles: los 4 roles fijos con sus permisos y cuántas cuentas tiene cada uno. */
async function roles() {
  const { Rol, Usuario } = modelos();
  const [filas, conteos] = await Promise.all([
    Rol.findAll({
      include: [{ association: 'permisos', attributes: ['codigo', 'descripcion'] }],
      order: [
        ['codigo', 'ASC'],
        [{ model: modelos().Permiso, as: 'permisos' }, 'codigo', 'ASC'],
      ],
    }),
    Usuario.findAll({
      attributes: ['rolId', 'estado', [fn('count', col('id')), 'n']],
      group: ['rolId', 'estado'],
      raw: true,
    }),
  ]);
  const orden = Object.values(ROLES);
  return filas
    .sort((a, b) => orden.indexOf(a.codigo) - orden.indexOf(b.codigo))
    .map((r) => {
      const usuarios = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
      for (const c of conteos.filter((x) => x.rolId === r.id)) usuarios[c.estado] = Number(c.n);
      return {
        codigo: r.codigo,
        nombreEs: r.nombreEs,
        nombreEn: r.nombreEn,
        descripcion: r.descripcion ?? null,
        usuarios,
        permisos: r.permisos.map((p) => ({ codigo: p.codigo, descripcion: p.descripcion ?? null })),
      };
    });
}

module.exports = { listar, invitar, cambiar, roles, ESTADOS };
