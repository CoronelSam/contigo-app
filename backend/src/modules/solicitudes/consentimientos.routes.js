'use strict';

// Consentimientos (20): textos vigentes, apertura del texto completo y decisión.

const { Router } = require('express');
const { z } = require('../../openapi/zod');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./solicitudes.schemas');
const c = require('./solicitudes.controller');

const router = Router();
const ETIQUETA = ['Consentimientos'];
const decidir = [requiereAuth, requierePermiso('consentimiento.decidir')];

router.get(
  '/consentimientos/textos',
  ...decidir,
  validar({ query: entrada.queryTextos }),
  c.textos,
);
registrarRuta({
  metodo: 'get',
  ruta: '/consentimientos/textos',
  etiquetas: ETIQUETA,
  resumen: 'Textos vigentes de los consentimientos',
  descripcion:
    'El texto vigente de cada tipo en el idioma pedido (o el del usuario). Todos son obligatorios: ' +
    'hay que responder, aunque rechazar marketing no afecta la solicitud.',
  query: entrada.queryTextos,
  respuestas: { 200: { descripcion: 'Textos', esquema: z.array(salida.texto) } },
});

router.post(
  '/consentimientos/textos/:id/abierto',
  ...decidir,
  validar({ params: entrada.paramsTexto, body: entrada.abrirTexto }),
  c.abrirTexto,
);
registrarRuta({
  metodo: 'post',
  ruta: '/consentimientos/textos/:id/abierto',
  etiquetas: ETIQUETA,
  resumen: 'Registrar que la familia abrió el texto completo',
  descripcion:
    'Requisito para decidir. Abrir otra versión o idioma del texto anula la decisión anterior de ' +
    'ese consentimiento, que se debe tomar de nuevo. Un texto que ya no es la versión vigente ' +
    'responde 409 `CONSENTIMIENTO_TEXTO_NO_VIGENTE`.',
  params: entrada.paramsTexto,
  body: entrada.abrirTexto,
  respuestas: { 200: { descripcion: 'Apertura registrada', esquema: salida.apertura } },
  errores: [409],
});

router.put(
  '/solicitudes/:id/consentimientos/:tipo',
  ...decidir,
  validar({ params: entrada.paramsConsentimiento, body: entrada.decidirConsentimiento }),
  c.decidir,
);
registrarRuta({
  metodo: 'put',
  ruta: '/solicitudes/:id/consentimientos/:tipo',
  etiquetas: ETIQUETA,
  resumen: 'Decidir un consentimiento',
  descripcion:
    'Hay que abrir antes ese mismo texto (409 `CONSENTIMIENTO_TEXTO_NO_ABIERTO`). Se guardan la ' +
    'decisión, el texto, quién, cuándo, la IP y el dispositivo. Si se acepta un tipo que requiere ' +
    'firma, queda con firma pendiente hasta que la hoja firmada (`documentoFirmadoId`) se valide. ' +
    'La app nunca firma.',
  params: entrada.paramsConsentimiento,
  body: entrada.decidirConsentimiento,
  respuestas: { 200: { descripcion: 'Consentimiento', esquema: salida.consentimiento } },
  errores: [409],
});

module.exports = router;
