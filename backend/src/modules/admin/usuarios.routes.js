'use strict';

// Usuarios del personal (52) y roles (53). Solo administrador.

const { Router } = require('express');
const { z } = require('../../openapi/zod');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./admin.schemas');
const c = require('./admin.controller');

const router = Router();
const ETIQUETA = ['Administración'];
const usuarios = [requiereAuth, requierePermiso('admin.usuarios')];

router.get(
  '/admin/usuarios',
  ...usuarios,
  validar({ query: entrada.filtrosUsuarios }),
  c.listarUsuarios,
);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/usuarios',
  etiquetas: ETIQUETA,
  resumen: 'Usuarios',
  descripcion:
    'Todas las cuentas, de la más reciente a la más antigua. `q` busca en nombres, apellidos y ' +
    'correo. Nunca devuelve contraseñas, hashes ni tokens.',
  query: entrada.filtrosUsuarios,
  respuestas: { 200: { descripcion: 'Usuarios', esquema: salida.listaUsuarios } },
});

router.post(
  '/admin/usuarios',
  ...usuarios,
  validar({ body: entrada.invitacion }),
  c.invitarUsuario,
);
registrarRuta({
  metodo: 'post',
  ruta: '/admin/usuarios',
  etiquetas: ETIQUETA,
  resumen: 'Invitar a una persona del personal',
  descripcion:
    'Crea la cuenta en `invitado`, sin contraseña, y envía un correo con un enlace de un solo ' +
    'uso (72 h) para crearla con `POST /auth/password/reset`. Las familias se registran solas. ' +
    'La respuesta nunca incluye el token. Correo repetido → `USUARIO_CORREO_EXISTE`.',
  body: entrada.invitacion,
  respuestas: { 201: { descripcion: 'Invitación enviada', esquema: salida.usuarioCambiado } },
  errores: [409],
});

router.patch(
  '/admin/usuarios/:id',
  ...usuarios,
  validar({ params: entrada.paramsId, body: entrada.cambiarUsuario }),
  c.cambiarUsuario,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/admin/usuarios/:id',
  etiquetas: ETIQUETA,
  resumen: 'Cambiar datos, rol o estado de una cuenta',
  descripcion:
    'El cambio de rol exige `motivo` y queda en la bitácora con el rol anterior y el nuevo; una ' +
    'cuenta de familia no pasa a personal ni al revés (`USUARIO_ROL_NO_PERMITIDO`). ' +
    '`estado: inactivo` revoca las sesiones en la misma transacción; nadie se borra. ' +
    'Un administrador no se desactiva ni se quita el rol a sí mismo (`USUARIO_PROPIA_CUENTA`) y ' +
    'el sistema no queda sin administradores activos (`USUARIO_ULTIMO_ADMINISTRADOR`). ' +
    '`reenviarInvitacion: true` emite un enlace nuevo a una cuenta que no creó su contraseña ' +
    '(también si se desactivó: vuelve a `invitado`).',
  params: entrada.paramsId,
  body: entrada.cambiarUsuario,
  respuestas: { 200: { descripcion: 'Cuenta', esquema: salida.usuarioCambiado } },
  errores: [409],
});

router.get('/admin/roles', ...usuarios, c.roles);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/roles',
  etiquetas: ETIQUETA,
  resumen: 'Roles y permisos',
  descripcion: 'Los 4 roles fijos con sus permisos y cuántas cuentas tiene cada uno. Solo lectura.',
  respuestas: { 200: { descripcion: 'Roles', esquema: z.array(salida.rolSalida) } },
});

module.exports = router;
