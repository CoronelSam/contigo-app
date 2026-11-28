'use strict';

// Configuración del sistema: solo claves conocidas, cada una con su esquema. Solo administrador.

const { Router } = require('express');
const { z } = require('../../openapi/zod');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./admin.schemas');
const c = require('./admin.controller');

const router = Router();
const ETIQUETA = ['Administración'];
const configuracion = [requiereAuth, requierePermiso('admin.configuracion')];

router.get('/admin/configuracion', ...configuracion, c.listarConfiguracion);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/configuracion',
  etiquetas: ETIQUETA,
  resumen: 'Configuración del sistema',
  descripcion: 'Todas las claves conocidas, con su valor, quién la cambió y cuándo.',
  respuestas: { 200: { descripcion: 'Claves', esquema: z.array(salida.configuracionItem) } },
});

router.patch(
  '/admin/configuracion/:clave',
  ...configuracion,
  validar({ params: entrada.paramsClave, body: entrada.cambiarConfiguracion }),
  c.cambiarConfiguracion,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/admin/configuracion/:clave',
  etiquetas: ETIQUETA,
  resumen: 'Cambiar una clave de configuración',
  descripcion:
    '`{ valor }` con el esquema de esa clave (los errores van en `valor.…`). Clave desconocida ' +
    '→ 404. El cambio queda en la bitácora con el antes y el después.',
  params: entrada.paramsClave,
  body: entrada.cambiarConfiguracion,
  respuestas: { 200: { descripcion: 'Clave', esquema: salida.configuracionItem } },
});

module.exports = router;
