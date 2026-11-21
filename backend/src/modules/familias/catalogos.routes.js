'use strict';

// Catálogos (bilingües), contactos oficiales y ayuda. Lectura para todos los roles.

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { z } = require('../../openapi/zod');
const { entrada, salida } = require('./familias.schemas');
const c = require('./catalogos.controller');

const router = Router();
const etiquetas = ['Catálogos'];
const leer = [requiereAuth, requierePermiso('catalogo.leer')];

router.get('/catalogos/departamentos', ...leer, c.departamentos);
registrarRuta({
  metodo: 'get',
  ruta: '/catalogos/departamentos',
  etiquetas,
  resumen: 'Departamentos de Honduras',
  respuestas: { 200: { descripcion: '18 departamentos', esquema: z.array(salida.lugar) } },
});

router.get(
  '/catalogos/departamentos/:id/municipios',
  ...leer,
  validar({ params: entrada.paramsDepartamento }),
  c.municipios,
);
registrarRuta({
  metodo: 'get',
  ruta: '/catalogos/departamentos/:id/municipios',
  etiquetas,
  resumen: 'Municipios de un departamento',
  params: entrada.paramsDepartamento,
  respuestas: {
    200: { descripcion: 'Municipios con su código oficial', esquema: z.array(salida.lugar) },
  },
});

router.get(
  '/catalogos/:tipo',
  ...leer,
  validar({ params: entrada.paramsTipo, query: entrada.queryIdioma }),
  c.catalogo,
);
registrarRuta({
  metodo: 'get',
  ruta: '/catalogos/:tipo',
  etiquetas,
  resumen: 'Ítems activos de un catálogo',
  descripcion:
    'Tipos: tipo_atencion, condicion_medica, ayuda_tecnica, terapia, grado_escolar, especialidad_medica y ' +
    'parentesco. Los valores viajan por `codigo`; la etiqueta sale en el idioma del usuario o en `?idioma=`.',
  params: entrada.paramsTipo,
  query: entrada.queryIdioma,
  respuestas: { 200: { descripcion: 'Ítems en orden', esquema: z.array(salida.item) } },
});

router.get(
  '/configuracion/contactos',
  ...leer,
  validar({ query: entrada.queryIdioma }),
  c.contactos,
);
registrarRuta({
  metodo: 'get',
  ruta: '/configuracion/contactos',
  etiquetas: ['Ayuda'],
  resumen: 'Contactos oficiales de apoyo',
  query: entrada.queryIdioma,
  respuestas: {
    200: { descripcion: 'Teléfonos, correo y horario', esquema: z.record(z.string(), z.unknown()) },
  },
});

router.get('/ayuda/articulos', ...leer, validar({ query: entrada.queryIdioma }), c.ayuda);
registrarRuta({
  metodo: 'get',
  ruta: '/ayuda/articulos',
  etiquetas: ['Ayuda'],
  resumen: 'Artículos de ayuda',
  query: entrada.queryIdioma,
  respuestas: {
    200: {
      descripcion: 'Artículos en el idioma pedido',
      esquema: z.array(z.object({ codigo: z.string(), titulo: z.string(), cuerpo: z.string() })),
    },
  },
});

module.exports = router;
