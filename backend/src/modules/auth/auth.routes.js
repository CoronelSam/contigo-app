'use strict';

// Rutas públicas /auth/* (y las dos de /auth que requieren sesión).

const { Router } = require('express');
const { requiereAuth } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./auth.schemas');
const limites = require('./limites');
const c = require('./auth.controller');

const router = Router();
const etiquetas = ['Autenticación'];

router.post('/auth/register', limites.registro, validar({ body: entrada.registro }), c.registrar);
registrarRuta({
  metodo: 'post',
  ruta: '/auth/register',
  publica: true,
  etiquetas,
  resumen: 'Crear una cuenta de familia',
  descripcion:
    'El registro público crea solo el rol familia. Envía un correo para verificar la dirección.',
  body: entrada.registro,
  respuestas: { 201: { descripcion: 'Cuenta creada y sesión iniciada', esquema: salida.sesion } },
  errores: [409, 429],
});

router.post('/auth/login', limites.login, validar({ body: entrada.login }), c.iniciarSesion);
registrarRuta({
  metodo: 'post',
  ruta: '/auth/login',
  publica: true,
  etiquetas,
  resumen: 'Iniciar sesión',
  descripcion:
    'Devuelve el rol para que la app abra su módulo. Correo inexistente, contraseña incorrecta o cuenta ' +
    'inactiva responden igual (401 AUTH_CREDENCIALES_INVALIDAS). 5 intentos fallidos bloquean 15 minutos (429).',
  body: entrada.login,
  respuestas: { 200: { descripcion: 'Sesión iniciada', esquema: salida.sesion } },
  errores: [403, 429],
});

router.post('/auth/refresh', validar({ body: entrada.refresh }), c.refrescar);
registrarRuta({
  metodo: 'post',
  ruta: '/auth/refresh',
  publica: true,
  etiquetas,
  resumen: 'Renovar la sesión',
  descripcion:
    'Rota el refresh token. Reutilizar uno ya rotado revoca todas las sesiones de ese dispositivo.',
  body: entrada.refresh,
  respuestas: { 200: { descripcion: 'Tokens nuevos', esquema: salida.sesion } },
  errores: [401],
});

router.post('/auth/logout', requiereAuth, validar({ body: entrada.logout }), c.cerrarSesion);
registrarRuta({
  metodo: 'post',
  ruta: '/auth/logout',
  etiquetas,
  resumen: 'Cerrar sesión',
  descripcion:
    'Revoca la sesión actual y, si se envía `tokenFcm`, deja de mandar push a ese dispositivo.',
  body: entrada.logout,
  respuestas: { 204: { descripcion: 'Sesión cerrada' } },
});

router.post(
  '/auth/password/forgot',
  limites.recuperar,
  validar({ body: entrada.olvido }),
  c.olvidarContrasena,
);
registrarRuta({
  metodo: 'post',
  ruta: '/auth/password/forgot',
  publica: true,
  etiquetas,
  resumen: 'Pedir un enlace para recuperar la contraseña',
  descripcion: 'Responde siempre lo mismo, exista o no la cuenta. El enlace vence en 45 minutos.',
  body: entrada.olvido,
  respuestas: { 202: { descripcion: 'Solicitud recibida', esquema: salida.mensaje } },
  errores: [429],
});

router.post(
  '/auth/password/reset',
  limites.recuperar,
  validar({ body: entrada.restablecer }),
  c.restablecerContrasena,
);
registrarRuta({
  metodo: 'post',
  ruta: '/auth/password/reset',
  publica: true,
  etiquetas,
  resumen: 'Crear una contraseña nueva con el enlace recibido',
  descripcion:
    'Acepta tokens de recuperación y de invitación (activa la cuenta del personal). Revoca todas las sesiones.',
  body: entrada.restablecer,
  respuestas: { 204: { descripcion: 'Contraseña actualizada' } },
  errores: [429],
});

router.post(
  '/auth/correo/verificar',
  limites.recuperar,
  validar({ body: entrada.verificarCorreo }),
  c.verificarCorreo,
);
registrarRuta({
  metodo: 'post',
  ruta: '/auth/correo/verificar',
  publica: true,
  etiquetas,
  resumen: 'Verificar el correo con el enlace recibido',
  body: entrada.verificarCorreo,
  respuestas: { 204: { descripcion: 'Correo verificado' } },
  errores: [429],
});

router.post('/auth/correo/reenviar', requiereAuth, limites.reenvio, c.reenviarVerificacion);
registrarRuta({
  metodo: 'post',
  ruta: '/auth/correo/reenviar',
  etiquetas,
  resumen: 'Reenviar el correo de verificación',
  descripcion: 'Máximo 3 por hora por usuario.',
  respuestas: { 202: { descripcion: 'Correo reenviado', esquema: salida.mensaje } },
  errores: [409, 429],
});

module.exports = router;
