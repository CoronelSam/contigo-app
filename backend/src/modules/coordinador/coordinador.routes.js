'use strict';

// Inicio, actividad y tablero (42, 43); historia clínica, bitácora y validación (44, 45).

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta, respuestaPaginadaDe } = require('../../openapi/registro');
const { entrada, salida } = require('./coordinador.schemas');
const c = require('./coordinador.controller');

const router = Router();
const ETIQUETA = ['Coordinador'];
const tablero = [requiereAuth, requierePermiso('coordinador.tablero')];
const expediente = [requiereAuth, requierePermiso('expediente.ver_completo')];
const params = validar({ params: entrada.paramsId });

router.get('/coordinador/resumen', ...tablero, c.resumen);
registrarRuta({
  metodo: 'get',
  ruta: '/coordinador/resumen',
  etiquetas: ETIQUETA,
  resumen: 'Inicio del coordinador',
  descripcion:
    'Contadores de casos en EN_REVISION, COMPLETA, ENVIADA, INFO_ADICIONAL, EN_EVALUACION y ' +
    'DERIVADA_HN, y las 10 actividades más recientes (42).',
  respuestas: { 200: { descripcion: 'Resumen', esquema: salida.resumen } },
});

router.get('/actividad', ...tablero, validar({ query: entrada.actividad }), c.actividad);
registrarRuta({
  metodo: 'get',
  ruta: '/actividad',
  etiquetas: ETIQUETA,
  resumen: 'Actividad reciente',
  descripcion: 'Desde la bitácora de los casos, de la más reciente a la más antigua.',
  query: entrada.actividad,
  respuestas: { 200: { descripcion: 'Actividad', esquema: respuestaPaginadaDe(salida.evento) } },
});

router.get('/solicitudes', ...tablero, validar({ query: entrada.tablero }), c.listar);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes',
  etiquetas: ETIQUETA,
  resumen: 'Tablero de casos',
  descripcion:
    'Busca por nombre del niño (sin acentos) o código; filtra por estado, destino, etapa y casos ' +
    'propios. Por defecto, los casos en curso, con más tiempo esperando primero. `diasEnEstado` ' +
    'es solo para seguimiento interno: nunca es un plazo.',
  query: entrada.tablero,
  respuestas: { 200: { descripcion: 'Casos', esquema: respuestaPaginadaDe(salida.fila) } },
});

router.get('/solicitudes/:id/historia-clinica', ...expediente, params, c.historiaClinica);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/historia-clinica',
  etiquetas: ETIQUETA,
  resumen: 'Historia clínica del caso',
  descripcion:
    'Las 6 secciones del formulario con las etiquetas de catálogo en el idioma del coordinador, ' +
    'el profesional de salud y los consentimientos. El acceso queda registrado.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Historia clínica', esquema: salida.historiaClinica } },
});

router.get(
  '/solicitudes/:id/bitacora',
  ...expediente,
  validar({ params: entrada.paramsId, query: entrada.bitacora }),
  c.bitacora,
);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/bitacora',
  etiquetas: ETIQUETA,
  resumen: 'Bitácora del caso',
  descripcion:
    'Cada cambio con el antes y el después, el autor y la fecha. Con `incluirAccesos=true`, también ' +
    'quién abrió el expediente, la historia clínica, los documentos y los archivos.',
  params: entrada.paramsId,
  query: entrada.bitacora,
  respuestas: { 200: { descripcion: 'Bitácora', esquema: salida.bitacoraCaso } },
});

router.get('/solicitudes/:id/validacion', ...expediente, params, c.validacion);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/validacion',
  etiquetas: ETIQUETA,
  resumen: 'Validación por bloques',
  descripcion:
    'Bloques de la etapa actual (45) con su estado, el motivo si falta y las acciones disponibles. ' +
    'Validar, rechazar o pedir correcciones se hace con los endpoints de documentos y correcciones.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Validación', esquema: salida.validacion } },
});

router.post(
  '/solicitudes/:id/confirmar-completo',
  requiereAuth,
  requierePermiso('solicitud.confirmar_completo'),
  validar({ params: entrada.paramsId, body: entrada.confirmar }),
  c.confirmar,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/confirmar-completo',
  etiquetas: ETIQUETA,
  resumen: 'Confirmar la etapa del expediente',
  descripcion:
    'Solo en EN_REVISION. Etapa de evaluación → EN_EVALUACION; etapa de paquete → COMPLETA. Con ' +
    'obligatorios pendientes responde 409 `SOLICITUD_FALTANTES` con la lista. Si el caso no tiene ' +
    'coordinador, queda a cargo de quien confirma.',
  params: entrada.paramsId,
  body: entrada.confirmar,
  respuestas: { 200: { descripcion: 'Expediente confirmado', esquema: salida.confirmado } },
  errores: [409],
});

module.exports = router;
