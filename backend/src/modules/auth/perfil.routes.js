'use strict';

// Rutas /me* del usuario autenticado.

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./auth.schemas');
const c = require('./perfil.controller');

const router = Router();
const etiquetas = ['Perfil'];
const proteger = [requiereAuth, requierePermiso('perfil.gestionar')];

router.get('/me', ...proteger, c.obtener);
registrarRuta({
  metodo: 'get',
  ruta: '/me',
  etiquetas,
  resumen: 'Mi perfil',
  respuestas: { 200: { descripcion: 'Perfil, rol y permisos', esquema: salida.perfil } },
});

router.patch('/me', ...proteger, validar({ body: entrada.perfilParcial }), c.actualizar);
registrarRuta({
  metodo: 'patch',
  ruta: '/me',
  etiquetas,
  resumen: 'Editar mi perfil',
  descripcion: 'Nombres, apellidos, teléfono e idioma. El correo no se cambia en esta versión.',
  body: entrada.perfilParcial,
  respuestas: { 200: { descripcion: 'Perfil actualizado', esquema: salida.perfil } },
});

router.patch(
  '/me/password',
  ...proteger,
  validar({ body: entrada.cambioContrasena }),
  c.cambiarContrasena,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/me/password',
  etiquetas,
  resumen: 'Cambiar mi contraseña',
  descripcion: 'Revoca las demás sesiones; la actual sigue activa.',
  body: entrada.cambioContrasena,
  respuestas: { 204: { descripcion: 'Contraseña cambiada' } },
});

router.get('/me/preferencias', ...proteger, c.obtenerPreferencias);
registrarRuta({
  metodo: 'get',
  ruta: '/me/preferencias',
  etiquetas,
  resumen: 'Mis preferencias de notificación',
  descripcion: 'Solo afectan el push; la bandeja de notificaciones siempre las guarda.',
  respuestas: { 200: { descripcion: 'Preferencias', esquema: salida.preferencias } },
});

router.put(
  '/me/preferencias',
  ...proteger,
  validar({ body: entrada.preferencias }),
  c.guardarPreferencias,
);
registrarRuta({
  metodo: 'put',
  ruta: '/me/preferencias',
  etiquetas,
  resumen: 'Guardar mis preferencias de notificación',
  body: entrada.preferencias,
  respuestas: { 200: { descripcion: 'Preferencias guardadas', esquema: salida.preferencias } },
});

router.post(
  '/me/dispositivos',
  ...proteger,
  validar({ body: entrada.dispositivo }),
  c.registrarDispositivo,
);
registrarRuta({
  metodo: 'post',
  ruta: '/me/dispositivos',
  etiquetas,
  resumen: 'Registrar este dispositivo para notificaciones push',
  descripcion: 'Si el token ya era de otra cuenta (teléfono compartido), pasa a esta.',
  body: entrada.dispositivo,
  respuestas: { 200: { descripcion: 'Dispositivo registrado' } },
});

module.exports = router;
