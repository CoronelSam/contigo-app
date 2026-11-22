'use strict';

// Solicitud, secciones del formulario, profesional de salud, envío y seguimiento.

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { idempotente } = require('../../core/http/idempotencia');
const { registrarRuta } = require('../../openapi/registro');
const { z } = require('../../openapi/zod');
const { entrada, salida } = require('./solicitudes.schemas');
const c = require('./solicitudes.controller');

const router = Router();
const ETIQUETA = ['Solicitudes'];
const conPermiso = (codigo) => [requiereAuth, requierePermiso(codigo)];
const params = validar({ params: entrada.paramsSolicitud });

const conflictoVersion = z
  .object({
    codigo: z.literal('SECCION_VERSION_CONFLICTO'),
    mensaje: z.string(),
    versionActual: z.number().int(),
  })
  .openapi('SeccionVersionConflicto');

router.post(
  '/solicitudes',
  ...conPermiso('solicitud.crear'),
  validar({ body: entrada.crearSolicitud }),
  c.crear,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes',
  etiquetas: ETIQUETA,
  resumen: 'Nueva solicitud',
  descripcion:
    'Solo familias, para un niño vinculado a la cuenta. Queda en BORRADOR con su código de caso. ' +
    'Si el niño ya tiene una solicitud abierta y la configuración no permite varias, responde 409 ' +
    '`SOLICITUD_ABIERTA_EXISTENTE`.',
  body: entrada.crearSolicitud,
  respuestas: { 201: { descripcion: 'Solicitud creada', esquema: salida.solicitud } },
  errores: [404, 409],
});

router.put(
  '/solicitudes/:id/modalidad',
  ...conPermiso('solicitud.crear'),
  validar({ params: entrada.paramsSolicitud, body: entrada.modalidad }),
  c.modalidad,
);
registrarRuta({
  metodo: 'put',
  ruta: '/solicitudes/:id/modalidad',
  etiquetas: ETIQUETA,
  resumen: 'Elegir cómo se llena la solicitud',
  descripcion:
    'En BORRADOR la elige y la solicitud pasa a CAPTURA. En CAPTURA la cambia sin cambiar de estado. ' +
    'En otro estado responde 409 `SOLICITUD_MODALIDAD_BLOQUEADA`.',
  params: entrada.paramsSolicitud,
  body: entrada.modalidad,
  respuestas: { 200: { descripcion: 'Solicitud', esquema: salida.solicitud } },
  errores: [409],
});

router.get('/solicitudes/:id', ...conPermiso('solicitud.leer'), params, c.obtener);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id',
  etiquetas: ETIQUETA,
  resumen: 'Resumen del expediente',
  descripcion:
    'Secciones, documentos, profesional, consentimientos, faltantes y las acciones disponibles. ' +
    'La familia no recibe la ruta sugerida ni datos del personal. El acceso del voluntario y del ' +
    'coordinador queda registrado.',
  params: entrada.paramsSolicitud,
  respuestas: { 200: { descripcion: 'Resumen', esquema: salida.resumen } },
});

router.get(
  '/solicitudes/:id/secciones/:seccion',
  ...conPermiso('solicitud.leer'),
  validar({ params: entrada.paramsSeccion }),
  c.obtenerSeccion,
);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/secciones/:seccion',
  etiquetas: ETIQUETA,
  resumen: 'Leer una sección del formulario',
  descripcion:
    'Devuelve `ETag: "v<version>"`. Una sección que nunca se guardó viene vacía y con versión 0. ' +
    'Un código de sección desconocido responde 404 `SECCION_NO_ENCONTRADA`.',
  params: entrada.paramsSeccion,
  respuestas: { 200: { descripcion: 'Sección', esquema: salida.seccion } },
});

router.put(
  '/solicitudes/:id/secciones/:seccion',
  ...conPermiso('solicitud.editar_secciones'),
  validar({ params: entrada.paramsSeccion, body: entrada.guardarSeccion }),
  c.guardarSeccion,
);
registrarRuta({
  metodo: 'put',
  ruta: '/solicitudes/:id/secciones/:seccion',
  etiquetas: ETIQUETA,
  resumen: 'Guardar una sección (borrador)',
  descripcion:
    'Acepta datos incompletos; el servidor calcula el estado (`vacia`, `incompleta`, `completa`). ' +
    '`If-Match` es obligatorio cuando la sección ya tiene versión (428 si falta, 412 si no coincide, ' +
    'con la versión actual en el cuerpo). La familia solo edita en BORRADOR y CAPTURA, o con una ' +
    'corrección abierta de la sección (409 `SOLICITUD_EDICION_BLOQUEADA`).',
  params: entrada.paramsSeccion,
  headers: entrada.cabeceraIfMatch,
  body: entrada.guardarSeccion,
  respuestas: {
    200: { descripcion: 'Sección guardada', esquema: salida.seccion },
    412: { descripcion: 'La sección cambió en otro dispositivo', esquema: conflictoVersion },
  },
  errores: [409, 428],
});

router.put(
  '/solicitudes/:id/profesional-salud',
  ...conPermiso('solicitud.editar_secciones'),
  validar({ params: entrada.paramsSolicitud, body: entrada.profesional }),
  c.profesional,
);
registrarRuta({
  metodo: 'put',
  ruta: '/solicitudes/:id/profesional-salud',
  etiquetas: ETIQUETA,
  resumen: 'Profesional de salud',
  descripcion:
    'Nombre, especialidad (catálogo), teléfono, correo y la certificación médica, que es un ' +
    'documento de esta solicitud del tipo `certificacion_medica`: la familia no la llena, solo la ' +
    'adjunta. Un campo que no se envía no cambia; `null` lo borra.',
  params: entrada.paramsSolicitud,
  body: entrada.profesional,
  respuestas: { 200: { descripcion: 'Profesional de salud', esquema: salida.profesional } },
  errores: [409],
});

router.post(
  '/solicitudes/:id/enviar',
  ...conPermiso('solicitud.enviar'),
  params,
  idempotente({ obligatorio: true }),
  c.enviar,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/enviar',
  etiquetas: ETIQUETA,
  resumen: 'Enviar a revisión del equipo Vanguardia',
  descripcion:
    'Desde CAPTURA, INFO_ADICIONAL o PAQUETE_EXTERIOR pasa a EN_REVISION. Se permite con faltantes: ' +
    'se guardan y se devuelven, pero el expediente no queda completo. No es una aceptación médica ' +
    'ni una recepción hospitalaria. `Idempotency-Key` obligatorio.',
  params: entrada.paramsSolicitud,
  headers: entrada.cabeceraIdempotencia,
  respuestas: { 200: { descripcion: 'Solicitud en revisión', esquema: salida.envio } },
  errores: [409, 422, 428],
});

router.get('/solicitudes/:id/seguimiento', ...conPermiso('solicitud.leer'), params, c.seguimiento);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/seguimiento',
  etiquetas: ETIQUETA,
  resumen: 'Línea de tiempo del caso',
  descripcion:
    'Familia y coordinador. Los pasos cambian según la ruta decidida (Honduras o exterior). Los ' +
    'pasos pendientes no tienen fecha: nunca se devuelven fechas estimadas.',
  params: entrada.paramsSolicitud,
  respuestas: { 200: { descripcion: 'Seguimiento', esquema: salida.seguimiento } },
});

module.exports = router;
