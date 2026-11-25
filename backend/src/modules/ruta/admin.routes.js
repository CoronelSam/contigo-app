'use strict';

// Administración de proveedores locales y reglas de ruta (administrador).

const { Router } = require('express');
const { z } = require('../../openapi/zod');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./ruta.schemas');
const c = require('./ruta.controller');

const router = Router();
const ETIQUETA = ['Administración'];
const proveedores = [requiereAuth, requierePermiso('admin.proveedores')];
const reglas = [requiereAuth, requierePermiso('admin.reglas_ruta')];

router.get(
  '/admin/proveedores-locales',
  ...proveedores,
  validar({ query: entrada.filtrosProveedoresAdmin }),
  c.listarProveedoresAdmin,
);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/proveedores-locales',
  etiquetas: ETIQUETA,
  resumen: 'Proveedores locales (todos)',
  descripcion: 'Incluye los inactivos; filtra con `activo`.',
  query: entrada.filtrosProveedoresAdmin,
  respuestas: { 200: { descripcion: 'Proveedores', esquema: z.array(salida.proveedor) } },
});

router.post(
  '/admin/proveedores-locales',
  ...proveedores,
  validar({ body: entrada.proveedor }),
  c.crearProveedor,
);
registrarRuta({
  metodo: 'post',
  ruta: '/admin/proveedores-locales',
  etiquetas: ETIQUETA,
  resumen: 'Agregar un proveedor local',
  descripcion:
    'Especialidades del catálogo `especialidad_medica`; el municipio debe ser del departamento.',
  body: entrada.proveedor,
  respuestas: { 201: { descripcion: 'Proveedor', esquema: salida.proveedor } },
});

router.patch(
  '/admin/proveedores-locales/:id',
  ...proveedores,
  validar({ params: entrada.paramsId, body: entrada.cambiarProveedor }),
  c.cambiarProveedor,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/admin/proveedores-locales/:id',
  etiquetas: ETIQUETA,
  resumen: 'Editar o desactivar un proveedor',
  descripcion: '`activo: false` lo desactiva. No se borra.',
  params: entrada.paramsId,
  body: entrada.cambiarProveedor,
  respuestas: { 200: { descripcion: 'Proveedor', esquema: salida.proveedor } },
});

router.get(
  '/admin/reglas-ruta',
  ...reglas,
  validar({ query: entrada.filtrosReglas }),
  c.listarReglas,
);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/reglas-ruta',
  etiquetas: ETIQUETA,
  resumen: 'Reglas de ruta por versión',
  descripcion:
    'Resumen de las versiones (activa, usada en evaluaciones) y las reglas de una versión (por ' +
    'defecto, la activa), con la lista de hechos que pueden usar las condiciones.',
  query: entrada.filtrosReglas,
  respuestas: { 200: { descripcion: 'Reglas', esquema: salida.listaReglas } },
});

router.post('/admin/reglas-ruta', ...reglas, validar({ body: entrada.regla }), c.crearRegla);
registrarRuta({
  metodo: 'post',
  ruta: '/admin/reglas-ruta',
  etiquetas: ETIQUETA,
  resumen: 'Agregar una regla a una versión',
  descripcion:
    'La condición es JsonLogic y solo puede usar los hechos disponibles. Una versión usada en ' +
    'evaluaciones no se modifica (409 `REGLAS_VERSION_USADA`): crea una versión nueva y actívala.',
  body: entrada.regla,
  respuestas: { 201: { descripcion: 'Regla', esquema: salida.regla } },
  errores: [409],
});

router.patch(
  '/admin/reglas-ruta/:id',
  ...reglas,
  validar({ params: entrada.paramsId, body: entrada.cambiarRegla }),
  c.cambiarRegla,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/admin/reglas-ruta/:id',
  etiquetas: ETIQUETA,
  resumen: 'Editar una regla',
  descripcion: 'Solo en una versión que ninguna evaluación usó.',
  params: entrada.paramsId,
  body: entrada.cambiarRegla,
  respuestas: { 200: { descripcion: 'Regla', esquema: salida.regla } },
  errores: [409],
});

router.post(
  '/admin/reglas-ruta/versiones/:version/activar',
  ...reglas,
  validar({ params: entrada.paramsVersion }),
  c.activarVersion,
);
registrarRuta({
  metodo: 'post',
  ruta: '/admin/reglas-ruta/versiones/:version/activar',
  etiquetas: ETIQUETA,
  resumen: 'Activar una versión de reglas',
  descripcion: 'Activa la versión y desactiva las demás. Las sugerencias nuevas usan esa versión.',
  params: entrada.paramsVersion,
  respuestas: { 200: { descripcion: 'Reglas', esquema: salida.listaReglas } },
  errores: [409],
});

module.exports = router;
