'use strict';

// Decisión de ruta (46 ampliada), atención en Honduras y lo que ve la familia.

const { Router } = require('express');
const { z } = require('../../openapi/zod');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./ruta.schemas');
const c = require('./ruta.controller');

const router = Router();
const RUTA = ['Ruta'];
const HONDURAS = ['Honduras'];
const con = (permiso) => [requiereAuth, requierePermiso(permiso)];
const params = validar({ params: entrada.paramsId });

router.get(
  '/solicitudes/:id/ruta-sugerida',
  ...con('solicitud.confirmar_destino'),
  params,
  c.rutaSugerida,
);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/ruta-sugerida',
  etiquetas: RUTA,
  resumen: 'Ruta sugerida por las reglas',
  descripcion:
    'Calcula la sugerencia con las reglas de la versión activa, con los hechos usados y los ' +
    'motivos. No guarda nada. Las reglas sugieren; una persona decide.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Sugerencia', esquema: salida.sugerencia } },
});

router.post(
  '/solicitudes/:id/evaluaciones',
  ...con('solicitud.confirmar_destino'),
  validar({ params: entrada.paramsId, body: entrada.evaluacion }),
  c.registrarEvaluacion,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/evaluaciones',
  etiquetas: RUTA,
  resumen: 'Registrar la decisión de ruta',
  descripcion:
    'Solo en EN_EVALUACION. Guarda el dictamen con la sugerencia recalculada en ese momento. ' +
    'México o internacional → PAQUETE_EXTERIOR con el paquete fijado. Honduras → la ruta queda ' +
    'guardada y el caso sigue en EN_EVALUACION hasta la derivación.',
  params: entrada.paramsId,
  body: entrada.evaluacion,
  respuestas: {
    201: { descripcion: 'Evaluación registrada', esquema: salida.resultadoEvaluacion },
  },
  errores: [409],
});

router.get(
  '/solicitudes/:id/evaluaciones',
  ...con('solicitud.confirmar_destino'),
  params,
  c.listarEvaluaciones,
);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/evaluaciones',
  etiquetas: RUTA,
  resumen: 'Historial de evaluaciones del caso',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Evaluaciones', esquema: z.array(salida.evaluacion) } },
});

router.post(
  '/solicitudes/:id/reabrir-evaluacion',
  ...con('evaluacion.reabrir'),
  validar({ params: entrada.paramsId, body: entrada.reabrir }),
  c.reabrir,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/reabrir-evaluacion',
  etiquetas: RUTA,
  resumen: 'Reabrir la evaluación',
  descripcion:
    'Desde PAQUETE_EXTERIOR, DERIVADA_HN o DENEGADA vuelve a EN_EVALUACION, sin ruta ni paquete. ' +
    'La evaluación vigente deja de serlo y una cita programada se cancela. Queda en la bitácora ' +
    'con el motivo.',
  params: entrada.paramsId,
  body: entrada.reabrir,
  respuestas: {
    200: {
      descripcion: 'Evaluación reabierta',
      esquema: salida.resultadoEvaluacion.shape.solicitud,
    },
  },
  errores: [409],
});

router.get('/solicitudes/:id/ruta', ...con('solicitud.leer'), params, c.rutaFamilia);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/ruta',
  etiquetas: RUTA,
  resumen: 'Ruta y siguiente paso para la familia',
  descripcion:
    'Solo la familia vinculada. Ruta decidida, siguiente paso (código que la app traduce) y la ' +
    'cita en Honduras. Nunca la ruta sugerida, los motivos ni la justificación: no es un diagnóstico.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Ruta', esquema: salida.rutaFamilia } },
});

router.get(
  '/proveedores-locales',
  ...con('derivacion.gestionar'),
  validar({ query: entrada.filtrosProveedores }),
  c.proveedores,
);
registrarRuta({
  metodo: 'get',
  ruta: '/proveedores-locales',
  etiquetas: HONDURAS,
  resumen: 'Proveedores locales activos',
  query: entrada.filtrosProveedores,
  respuestas: { 200: { descripcion: 'Proveedores', esquema: z.array(salida.proveedor) } },
});

router.post(
  '/solicitudes/:id/derivaciones-locales',
  ...con('derivacion.gestionar'),
  validar({ params: entrada.paramsId, body: entrada.derivacion }),
  c.derivar,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/derivaciones-locales',
  etiquetas: HONDURAS,
  resumen: 'Derivar a un proveedor local o reprogramar la cita',
  descripcion:
    'En EN_EVALUACION con ruta Honduras: crea la cita y el caso pasa a DERIVADA_HN (aviso ' +
    'CITA_PROGRAMADA). En DERIVADA_HN: reprograma, cancela la cita anterior y avisa ' +
    'CITA_ACTUALIZADA. Exige proveedor activo con la especialidad, fecha no pasada y los ' +
    'requisitos de Honduras completos.',
  params: entrada.paramsId,
  body: entrada.derivacion,
  respuestas: { 201: { descripcion: 'Cita registrada', esquema: salida.resultadoDerivacion } },
  errores: [409],
});

router.patch(
  '/derivaciones-locales/:id',
  ...con('derivacion.gestionar'),
  validar({ params: entrada.paramsId, body: entrada.cambiarDerivacion }),
  c.cambiarDerivacion,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/derivaciones-locales/:id',
  etiquetas: HONDURAS,
  resumen: 'Cambiar la cita o registrar su resultado',
  descripcion:
    'Fecha u hora de una cita programada (aviso CITA_ACTUALIZADA), o el resultado: `atendida` → ' +
    'ATENDIDA_HN; `no_asistio` o `cancelada` dejan el caso en DERIVADA_HN para reprogramar, salvo ' +
    'con `volverAEvaluacion: true`.',
  params: entrada.paramsId,
  body: entrada.cambiarDerivacion,
  respuestas: { 200: { descripcion: 'Cita', esquema: salida.resultadoDerivacion } },
  errores: [409],
});

module.exports = router;
