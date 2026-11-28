'use strict';

// Bandeja de notificaciones (32). Cada usuario ve y marca solo las suyas.

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./comunicacion.schemas');
const c = require('./comunicacion.controller');

const router = Router();
const ETIQUETA = ['Notificaciones'];
const proteger = [requiereAuth, requierePermiso('notificacion.leer')];

router.get(
  '/notificaciones',
  ...proteger,
  validar({ query: entrada.filtrosNotificaciones }),
  c.listarNotificaciones,
);
registrarRuta({
  metodo: 'get',
  ruta: '/notificaciones',
  etiquetas: ETIQUETA,
  resumen: 'Mi bandeja de notificaciones',
  descripcion:
    'Filtro `estado`: `todas`, `no_leidas` o `leidas`. Paginada, de la más reciente a la más ' +
    'antigua, con el contador `noLeidas`.',
  query: entrada.filtrosNotificaciones,
  respuestas: { 200: { descripcion: 'Bandeja', esquema: salida.bandeja } },
});

router.patch(
  '/notificaciones/:id/leida',
  ...proteger,
  validar({ params: entrada.paramsId }),
  c.marcarLeida,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/notificaciones/:id/leida',
  etiquetas: ETIQUETA,
  resumen: 'Marcar una notificación como leída',
  descripcion: 'Solo las propias: la de otro usuario → 404. Si ya estaba leída, conserva la fecha.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Notificación', esquema: salida.notificacionLeida } },
});

router.post('/notificaciones/leer-todas', ...proteger, c.leerTodas);
registrarRuta({
  metodo: 'post',
  ruta: '/notificaciones/leer-todas',
  etiquetas: ETIQUETA,
  resumen: 'Marcar todas como leídas',
  respuestas: { 200: { descripcion: 'Resultado', esquema: salida.leerTodas } },
});

module.exports = router;
