'use strict';

// Correcciones del caso (41, 45) y URL firmadas de archivos.

const { Router } = require('express');
const { z } = require('../../openapi/zod');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./documentos.schemas');
const c = require('./documentos.controller');

const router = Router();

router.get(
  '/solicitudes/:id/correcciones',
  requiereAuth,
  requierePermiso('solicitud.leer'),
  validar({ params: entrada.paramsId, query: entrada.listarCorrecciones }),
  c.listarCorrecciones,
);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/correcciones',
  etiquetas: ['Documentos'],
  resumen: 'Correcciones del caso',
  descripcion: 'De documentos y de secciones, con motivo, estado y fecha. La familia solo las lee.',
  params: entrada.paramsId,
  query: entrada.listarCorrecciones,
  respuestas: { 200: { descripcion: 'Correcciones', esquema: z.array(salida.correccion) } },
});

router.post(
  '/solicitudes/:id/correcciones',
  requiereAuth,
  requierePermiso('correccion.solicitar'),
  validar({ params: entrada.paramsId, body: entrada.correccionSeccion }),
  c.corregirSeccion,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/correcciones',
  etiquetas: ['Documentos'],
  resumen: 'Pedir la corrección de una sección',
  descripcion:
    'Solo el coordinador (45). Abre la edición de esa sección para la familia y se resuelve sola ' +
    'cuando la familia la guarda. En EN_REVISION el caso pasa a INFO_ADICIONAL.',
  params: entrada.paramsId,
  body: entrada.correccionSeccion,
  respuestas: { 201: { descripcion: 'Corrección abierta', esquema: salida.resultadoCorreccion } },
  errores: [409],
});

// Sin requierePermiso: el permiso depende del dueño del archivo y se revisa en el servicio.
router.get('/archivos/:id/url', requiereAuth, validar({ params: entrada.paramsId }), c.urlArchivo);
registrarRuta({
  metodo: 'get',
  ruta: '/archivos/:id/url',
  etiquetas: ['Archivos'],
  resumen: 'URL firmada de un archivo',
  descripcion:
    'Página de documento, foto del niño, adjunto del chat, paquete PDF o PDF de plantilla, con el ' +
    'acceso de su dueño: familia vinculada, voluntario asignado o coordinador; paquetes solo el ' +
    'coordinador. Sin relación responde 404. Cada URL emitida queda registrada.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'URL firmada', esquema: salida.urlFirmada } },
});

module.exports = router;
