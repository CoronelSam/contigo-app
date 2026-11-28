'use strict';

// Documentos y páginas (22–27, 37 y la validación de la 44).

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { idempotente } = require('../../core/http/idempotencia');
const { subidaEnMemoria } = require('../../core/archivos');
const { registrarRuta } = require('../../openapi/registro');
const { z } = require('../../openapi/zod');
const { entrada, salida } = require('./documentos.schemas');
const c = require('./documentos.controller');

const router = Router();
const ETIQUETA = ['Documentos'];
const con = (permiso) => [requiereAuth, requierePermiso(permiso)];
const params = validar({ params: entrada.paramsId });

router.get('/solicitudes/:id/documentos', ...con('solicitud.leer'), params, c.requisitos);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/documentos',
  etiquetas: ETIQUETA,
  resumen: 'Documentos requeridos del caso',
  descripcion:
    'Requisitos activos según la etapa y la ruta (evaluación, más el paquete fijado o Honduras), en ' +
    'orden, con el documento vigente, sus páginas, el estado del OCR y la corrección abierta.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Requisitos', esquema: salida.listaRequisitos } },
});

router.get('/tipos-documento/:id', ...con('catalogo.leer'), params, c.tipo);
registrarRuta({
  metodo: 'get',
  ruta: '/tipos-documento/:id',
  etiquetas: ETIQUETA,
  resumen: 'Ayuda de un tipo de documento',
  descripcion: '"¿Para qué sirve?" y "¿Cómo fotografiarla?" (23) en el idioma del usuario.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Tipo de documento', esquema: salida.tipoDocumento } },
});

router.post(
  '/solicitudes/:id/documentos',
  ...con('documento.capturar'),
  validar({ params: entrada.paramsId, body: entrada.crearDocumento }),
  idempotente({ obligatorio: true }),
  c.crear,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/documentos',
  etiquetas: ETIQUETA,
  resumen: 'Empezar la captura de un documento',
  descripcion:
    'Crea el documento en FALTA, o devuelve el que ya está en FALTA (200). Si el vigente está ' +
    'capturado o rechazado, crea una versión nueva; uno validado solo lo reemplaza el coordinador. ' +
    'Un tipo fuera de los requisitos activos responde 409 `DOCUMENTO_NO_REQUERIDO`. Incluye el ' +
    'nombre y la foto del niño para confirmar que las hojas son suyas. `Idempotency-Key` obligatorio.',
  params: entrada.paramsId,
  headers: entrada.cabeceraIdempotencia,
  body: entrada.crearDocumento,
  respuestas: {
    201: { descripcion: 'Documento creado', esquema: salida.documentoCreado },
    200: { descripcion: 'Documento que ya existía', esquema: salida.documentoCreado },
  },
  errores: [409, 422, 428],
});

router.get('/documentos/:id', ...con('solicitud.leer'), params, c.obtener);
registrarRuta({
  metodo: 'get',
  ruta: '/documentos/:id',
  etiquetas: ETIQUETA,
  resumen: 'Detalle de un documento',
  descripcion: 'Páginas en orden, versión anterior y última extracción de OCR.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Documento', esquema: salida.documentoDetalle } },
});

router.post(
  '/documentos/:id/paginas',
  ...con('documento.capturar'),
  params,
  ...subidaEnMemoria({ campo: 'archivo' }),
  idempotente({ obligatorio: true }),
  validar({ body: entrada.pagina }),
  c.agregarPagina,
);
registrarRuta({
  metodo: 'post',
  ruta: '/documentos/:id/paginas',
  etiquetas: ETIQUETA,
  resumen: 'Subir una página',
  descripcion:
    'Imagen JPEG, PNG o WebP, o PDF (tipo por contenido, 10 MB). Solo con el documento en FALTA. ' +
    'La misma imagen dos veces en el documento devuelve la página existente (200). ' +
    '`Idempotency-Key` obligatorio.',
  params: entrada.paramsId,
  headers: entrada.cabeceraIdempotencia,
  bodyMultipart: z.object({
    archivo: z.string().openapi({ type: 'string', format: 'binary' }),
    orden: z.number().int().optional(),
  }),
  respuestas: {
    201: { descripcion: 'Página agregada', esquema: salida.paginaSalida },
    200: { descripcion: 'La página ya estaba', esquema: salida.paginaSalida },
  },
  errores: [409, 413, 422, 428],
});

router.delete(
  '/documentos/:id/paginas/:pid',
  ...con('documento.capturar'),
  validar({ params: entrada.paramsPagina }),
  c.borrarPagina,
);
registrarRuta({
  metodo: 'delete',
  ruta: '/documentos/:id/paginas/:pid',
  etiquetas: ETIQUETA,
  resumen: 'Borrar una página',
  descripcion: 'Solo con el documento en FALTA. Las páginas siguientes se corren un lugar.',
  params: entrada.paramsPagina,
  respuestas: { 204: { descripcion: 'Página borrada' } },
  errores: [409],
});

router.put(
  '/documentos/:id/paginas/orden',
  ...con('documento.capturar'),
  validar({ params: entrada.paramsId, body: entrada.ordenPaginas }),
  c.reordenar,
);
registrarRuta({
  metodo: 'put',
  ruta: '/documentos/:id/paginas/orden',
  etiquetas: ETIQUETA,
  resumen: 'Reordenar las páginas',
  descripcion: 'La lista debe tener exactamente las páginas del documento (400 si no).',
  params: entrada.paramsId,
  body: entrada.ordenPaginas,
  respuestas: { 200: { descripcion: 'Documento', esquema: salida.documento } },
  errores: [409],
});

router.post(
  '/documentos/:id/finalizar',
  ...con('documento.capturar'),
  validar({ params: entrada.paramsId, body: entrada.finalizar }),
  c.finalizar,
);
registrarRuta({
  metodo: 'post',
  ruta: '/documentos/:id/finalizar',
  etiquetas: ETIQUETA,
  resumen: 'Terminar la captura',
  descripcion:
    'Pasa a CAPTURADO si las hojas declaradas coinciden con las subidas (409 ' +
    '`DOCUMENTO_PAGINAS_FALTANTES` si no). Encola el OCR y resuelve las correcciones abiertas de ese ' +
    'tipo. Capturar no es validar.',
  params: entrada.paramsId,
  body: entrada.finalizar,
  respuestas: { 200: { descripcion: 'Documento capturado', esquema: salida.documento } },
  errores: [409],
});

router.post('/documentos/:id/cancelar', ...con('documento.capturar'), params, c.cancelar);
registrarRuta({
  metodo: 'post',
  ruta: '/documentos/:id/cancelar',
  etiquetas: ETIQUETA,
  resumen: 'Cancelar el OCR y repetir las páginas',
  descripcion:
    'Cancela el OCR en curso y devuelve el documento a FALTA. Si el OCR ya terminó, responde 409 ' +
    '`DOCUMENTO_OCR_EN_REVISION`: hay que crear una versión nueva.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Documento en FALTA', esquema: salida.documento } },
  errores: [409],
});

router.post('/documentos/:id/validar', ...con('documento.validar'), params, c.validar);
registrarRuta({
  metodo: 'post',
  ruta: '/documentos/:id/validar',
  etiquetas: ETIQUETA,
  resumen: 'Validar un documento',
  descripcion:
    'Coordinador. CAPTURADO → VALIDADO. Si hubo OCR, la extracción debe estar confirmada (409 ' +
    '`DOCUMENTO_OCR_SIN_REVISAR`).',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Documento validado', esquema: salida.documento } },
  errores: [409],
});

router.post(
  '/documentos/:id/rechazar',
  ...con('documento.validar'),
  validar({ params: entrada.paramsId, body: entrada.rechazar }),
  c.rechazar,
);
registrarRuta({
  metodo: 'post',
  ruta: '/documentos/:id/rechazar',
  etiquetas: ETIQUETA,
  resumen: 'Rechazar un documento',
  descripcion:
    'Coordinador. El documento pasa a RECHAZADO con una corrección abierta y se avisa a la familia. ' +
    'En EN_REVISION el caso pasa a INFO_ADICIONAL. Rechazar una imagen no es rechazar la solicitud.',
  params: entrada.paramsId,
  body: entrada.rechazar,
  respuestas: { 201: { descripcion: 'Corrección abierta', esquema: salida.resultadoCorreccion } },
  errores: [409],
});

router.post(
  '/documentos/:id/correcciones',
  ...con('correccion.solicitar'),
  validar({ params: entrada.paramsId, body: entrada.nuevaCaptura }),
  c.nuevaCaptura,
);
registrarRuta({
  metodo: 'post',
  ruta: '/documentos/:id/correcciones',
  etiquetas: ETIQUETA,
  resumen: 'Pedir una nueva captura',
  descripcion:
    'Voluntario asignado o coordinador (41). Igual que rechazar: documento RECHAZADO, corrección ' +
    'abierta, aviso a la familia y, en EN_REVISION, el caso pasa a INFO_ADICIONAL. Nunca a DENEGADA.',
  params: entrada.paramsId,
  body: entrada.nuevaCaptura,
  respuestas: { 201: { descripcion: 'Corrección abierta', esquema: salida.resultadoCorreccion } },
  errores: [409],
});

module.exports = router;
