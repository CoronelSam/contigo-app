'use strict';

// Plantillas oficiales (55), solo administrador.

const { Router } = require('express');
const { z } = require('../../openapi/zod');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { subidaEnMemoria } = require('../../core/archivos');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./paquetes.schemas');
const c = require('./paquetes.controller');

const router = Router();
const ETIQUETA = ['Administración'];
const plantillas = [requiereAuth, requierePermiso('admin.plantillas')];

router.get(
  '/admin/plantillas',
  ...plantillas,
  validar({ query: entrada.filtrosPlantillas }),
  c.listarPlantillas,
);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/plantillas',
  etiquetas: ETIQUETA,
  resumen: 'Plantillas oficiales',
  descripcion:
    'Todas las versiones, con filtros por paquete, código y `activa`. El PDF se abre con ' +
    '`GET /archivos/{archivoPdfId}/url`.',
  query: entrada.filtrosPlantillas,
  respuestas: {
    200: { descripcion: 'Plantillas', esquema: z.array(salida.plantillaSalida) },
  },
});

router.post(
  '/admin/plantillas',
  ...plantillas,
  ...subidaEnMemoria({ campo: 'archivo' }),
  validar({ body: entrada.plantilla }),
  c.registrarPlantilla,
);
registrarRuta({
  metodo: 'post',
  ruta: '/admin/plantillas',
  etiquetas: ETIQUETA,
  resumen: 'Registrar una plantilla oficial',
  descripcion:
    'Multipart: el PDF oficial en `archivo` y los datos como campos; `mapaCampos` y `zonasOcr` ' +
    'van como texto JSON. Con `metodo: campo` cada `campoPdf` debe existir en el formulario del ' +
    'PDF con el tipo correcto (nunca un campo de firma); con `coordenadas`, cada página debe ' +
    'existir. Un origen desconocido → 400. La versión nueva queda activa y desactiva las demás ' +
    'del mismo código; los paquetes ya generados no cambian. Versión repetida → ' +
    '`PLANTILLA_VERSION_EXISTE`.',
  bodyMultipart: entrada.plantillaMultipart,
  respuestas: { 201: { descripcion: 'Plantilla', esquema: salida.plantillaSalida } },
  errores: [409, 413],
});

router.patch(
  '/admin/plantillas/:id',
  ...plantillas,
  validar({ params: entrada.paramsId, body: entrada.cambiarPlantilla }),
  c.cambiarPlantilla,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/admin/plantillas/:id',
  etiquetas: ETIQUETA,
  resumen: 'Activar o desactivar una plantilla',
  descripcion:
    '`activa: false` la desactiva (no se borra). Activar una versión desactiva las demás del ' +
    'mismo código. También cambia `nombre` u `orden`. Para cambiar el PDF o el mapa, registra ' +
    'una versión nueva.',
  params: entrada.paramsId,
  body: entrada.cambiarPlantilla,
  respuestas: { 200: { descripcion: 'Plantilla', esquema: salida.plantillaSalida } },
});

module.exports = router;
