'use strict';

// Panel del administrador (51) y reportes (56). Solo cifras agregadas.

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./admin.schemas');
const c = require('./admin.controller');

const router = Router();
const ETIQUETA = ['Administración'];
const reportes = [requiereAuth, requierePermiso('admin.reportes')];

router.get('/admin/resumen', ...reportes, c.resumen);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/resumen',
  etiquetas: ETIQUETA,
  resumen: 'Panel del administrador',
  descripcion:
    'Cuentas por rol y estado, solicitudes por estado, documentos procesados (extracciones ' +
    'confirmadas), estado del sistema (los chequeos de `/health`) y las últimas acciones de los ' +
    'administradores fuera de los expedientes. Sin datos de niños ni de casos.',
  respuestas: { 200: { descripcion: 'Panel', esquema: salida.resumen } },
});

router.get(
  '/admin/reportes',
  ...reportes,
  validar({ query: entrada.filtrosReportes }),
  c.verReportes,
);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/reportes',
  etiquetas: ETIQUETA,
  resumen: 'Reportes',
  descripcion:
    'Casos por mes, tiempos por estado, precisión del OCR, rutas decididas, tiempo hasta la ' +
    'decisión de ruta y tasa de aceptación por destino. Fechas locales de America/Tegucigalpa, ' +
    'las dos incluidas; por defecto, los últimos 12 meses (máximo 60). Solo agregados.',
  query: entrada.filtrosReportes,
  respuestas: { 200: { descripcion: 'Indicadores', esquema: salida.reportes } },
});

module.exports = router;
