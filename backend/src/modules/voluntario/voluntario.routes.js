'use strict';

// Asignaciones (coordinador) e inicio y casos del voluntario (35, 36).

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta, respuestaPaginadaDe } = require('../../openapi/registro');
const { entrada, salida } = require('./voluntario.schemas');
const c = require('./voluntario.controller');

const router = Router();
const gestionar = [requiereAuth, requierePermiso('asignacion.gestionar')];
const deVoluntario = [requiereAuth, requierePermiso('voluntario.casos')];

router.post(
  '/solicitudes/:id/asignaciones',
  ...gestionar,
  validar({ params: entrada.paramsId, body: entrada.crearAsignacion }),
  c.crear,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/asignaciones',
  etiquetas: ['Asignaciones'],
  resumen: 'Asignar un voluntario al caso',
  descripcion:
    'Coordinador. El usuario debe tener rol voluntario y estar activo. Si ya tiene una asignación ' +
    'activa en el caso responde 409 `ASIGNACION_DUPLICADA`. Avisa al voluntario.',
  params: entrada.paramsId,
  body: entrada.crearAsignacion,
  respuestas: { 201: { descripcion: 'Asignación creada', esquema: salida.asignacion } },
  errores: [409],
});

router.patch(
  '/asignaciones/:id',
  ...gestionar,
  validar({ params: entrada.paramsId, body: entrada.cambiarAsignacion }),
  c.cambiar,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/asignaciones/:id',
  etiquetas: ['Asignaciones'],
  resumen: 'Cerrar o reasignar una asignación',
  descripcion:
    'Coordinador. `activa: false` la cierra: el voluntario pierde el acceso al caso de inmediato. ' +
    'Con `voluntarioId` además, se crea una asignación para ese voluntario (reasignar).',
  params: entrada.paramsId,
  body: entrada.cambiarAsignacion,
  respuestas: { 200: { descripcion: 'Asignación', esquema: salida.resultadoCambio } },
  errores: [409],
});

router.get('/voluntario/resumen', ...deVoluntario, c.resumen);
registrarRuta({
  metodo: 'get',
  ruta: '/voluntario/resumen',
  etiquetas: ['Voluntario'],
  resumen: 'Inicio del voluntario',
  descripcion: 'Contadores de sus casos con asignación activa (35).',
  respuestas: { 200: { descripcion: 'Contadores', esquema: salida.resumen } },
});

router.get('/voluntario/casos', ...deVoluntario, validar({ query: entrada.listarCasos }), c.listar);
registrarRuta({
  metodo: 'get',
  ruta: '/voluntario/casos',
  etiquetas: ['Voluntario'],
  resumen: 'Casos asignados',
  descripcion:
    'Solo sus asignaciones activas (36). Busca por código o por nombre del niño sin acentos y ' +
    'filtra por el estado de la asignación. Lo mínimo para trabajar: sin historia clínica.',
  query: entrada.listarCasos,
  respuestas: { 200: { descripcion: 'Casos', esquema: respuestaPaginadaDe(salida.caso) } },
});

module.exports = router;
