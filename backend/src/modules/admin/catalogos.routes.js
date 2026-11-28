'use strict';

// Catálogo de documentos (54), requisitos por ruta y catálogos bilingües. Solo administrador.

const { Router } = require('express');
const { z } = require('../../openapi/zod');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./admin.schemas');
const c = require('./admin.controller');

const router = Router();
const ETIQUETA = ['Administración'];
const catalogos = [requiereAuth, requierePermiso('admin.catalogos')];

// --- Tipos de documento

router.get(
  '/admin/tipos-documento',
  ...catalogos,
  validar({ query: entrada.filtrosTipos }),
  c.listarTipos,
);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/tipos-documento',
  etiquetas: ETIQUETA,
  resumen: 'Tipos de documento',
  descripcion: 'También los inactivos, con los textos de ayuda (23) en los dos idiomas.',
  query: entrada.filtrosTipos,
  respuestas: { 200: { descripcion: 'Tipos', esquema: z.array(salida.tipoDocumentoAdmin) } },
});

router.post(
  '/admin/tipos-documento',
  ...catalogos,
  validar({ body: entrada.tipoDocumento }),
  c.crearTipo,
);
registrarRuta({
  metodo: 'post',
  ruta: '/admin/tipos-documento',
  etiquetas: ETIQUETA,
  resumen: 'Crear un tipo de documento',
  descripcion:
    'Queda activo en la versión 1. La obligatoriedad no va aquí sino en `requisitos_ruta`. ' +
    'Los textos de ayuda van en los dos idiomas o en ninguno. Código repetido → ' +
    '`TIPO_DOCUMENTO_CODIGO_EXISTE`.',
  body: entrada.tipoDocumento,
  respuestas: { 201: { descripcion: 'Tipo', esquema: salida.tipoDocumentoAdmin } },
  errores: [409],
});

router.patch(
  '/admin/tipos-documento/:id',
  ...catalogos,
  validar({ params: entrada.paramsId, body: entrada.cambiarTipoDocumento }),
  c.cambiarTipo,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/admin/tipos-documento/:id',
  etiquetas: ETIQUETA,
  resumen: 'Cambiar un tipo de documento',
  descripcion:
    'Cambiar nombres, textos de ayuda o plantilla sube `version`. `activo: false` lo desactiva ' +
    '(nada se borra); con requisitos activos responde `TIPO_DOCUMENTO_CON_REQUISITOS`. El código ' +
    'no cambia.',
  params: entrada.paramsId,
  body: entrada.cambiarTipoDocumento,
  respuestas: { 200: { descripcion: 'Tipo', esquema: salida.tipoDocumentoAdmin } },
  errores: [409],
});

// --- Requisitos por ruta

router.get(
  '/admin/requisitos-ruta',
  ...catalogos,
  validar({ query: entrada.filtrosRequisitos }),
  c.listarRequisitos,
);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/requisitos-ruta',
  etiquetas: ETIQUETA,
  resumen: 'Requisitos por ruta',
  descripcion:
    'Documentos que pide cada etapa o ruta (evaluación, Honduras, México e internacional), en ' +
    'orden. También los inactivos.',
  query: entrada.filtrosRequisitos,
  respuestas: { 200: { descripcion: 'Requisitos', esquema: z.array(salida.requisitoAdmin) } },
});

router.post(
  '/admin/requisitos-ruta',
  ...catalogos,
  validar({ body: entrada.requisito }),
  c.crearRequisito,
);
registrarRuta({
  metodo: 'post',
  ruta: '/admin/requisitos-ruta',
  etiquetas: ETIQUETA,
  resumen: 'Agregar un requisito a una ruta',
  descripcion:
    'Tipo inactivo → `REQUISITO_TIPO_INACTIVO`; el mismo tipo dos veces en una ruta → ' +
    '`REQUISITO_EXISTE` (reactiva el que ya está). Una sección desconocida en ' +
    '`cubiertoPorSecciones` → 400.',
  body: entrada.requisito,
  respuestas: { 201: { descripcion: 'Requisito', esquema: salida.requisitoAdmin } },
  errores: [409],
});

router.patch(
  '/admin/requisitos-ruta/:id',
  ...catalogos,
  validar({ params: entrada.paramsId, body: entrada.cambiarRequisito }),
  c.cambiarRequisito,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/admin/requisitos-ruta/:id',
  etiquetas: ETIQUETA,
  resumen: 'Cambiar un requisito',
  descripcion:
    'La ruta y el tipo no cambian. Desactivarlo cambia solo la lista que se pide desde ese ' +
    'momento: los documentos ya capturados no cambian. Reactivarlo con el tipo inactivo → ' +
    '`REQUISITO_TIPO_INACTIVO`.',
  params: entrada.paramsId,
  body: entrada.cambiarRequisito,
  respuestas: { 200: { descripcion: 'Requisito', esquema: salida.requisitoAdmin } },
  errores: [409],
});

// --- Catálogos

router.get(
  '/admin/catalogos',
  ...catalogos,
  validar({ query: entrada.filtrosCatalogos }),
  c.listarItems,
);
registrarRuta({
  metodo: 'get',
  ruta: '/admin/catalogos',
  etiquetas: ETIQUETA,
  resumen: 'Ítems de los catálogos',
  descripcion: 'Bilingües, en orden, también los inactivos. `?tipo=` filtra un catálogo.',
  query: entrada.filtrosCatalogos,
  respuestas: { 200: { descripcion: 'Ítems', esquema: z.array(salida.catalogoItemAdmin) } },
});

router.post('/admin/catalogos', ...catalogos, validar({ body: entrada.catalogoItem }), c.crearItem);
registrarRuta({
  metodo: 'post',
  ruta: '/admin/catalogos',
  etiquetas: ETIQUETA,
  resumen: 'Agregar un ítem a un catálogo',
  descripcion:
    'Solo en un catálogo que ya existe. Código repetido en el catálogo → ' +
    '`CATALOGO_CODIGO_EXISTE`.',
  body: entrada.catalogoItem,
  respuestas: { 201: { descripcion: 'Ítem', esquema: salida.catalogoItemAdmin } },
  errores: [409],
});

router.patch(
  '/admin/catalogos/:id',
  ...catalogos,
  validar({ params: entrada.paramsId, body: entrada.cambiarCatalogoItem }),
  c.cambiarItem,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/admin/catalogos/:id',
  etiquetas: ETIQUETA,
  resumen: 'Cambiar un ítem de catálogo',
  descripcion:
    'Etiquetas, orden, metadatos o `activo`. El tipo y el código no cambian porque los datos ' +
    'guardan el código.',
  params: entrada.paramsId,
  body: entrada.cambiarCatalogoItem,
  respuestas: { 200: { descripcion: 'Ítem', esquema: salida.catalogoItemAdmin } },
});

module.exports = router;
