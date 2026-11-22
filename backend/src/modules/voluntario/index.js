'use strict';

// Router del módulo "voluntario". Define rutas completas relativas a /api/v1 y pon los middlewares
// de autenticación y permisos en cada ruta: nunca uses router.use() con ellos.

const { Router } = require('express');
const { suscribir, EVENTOS } = require('../../core/eventos');
const { alCambiarCaso } = require('./estado');

const router = Router();
router.use(require('./voluntario.routes'));

// El estado de la asignación se recalcula con cada cambio de documentos, OCR o estado del caso.
for (const evento of [
  EVENTOS.DOCUMENTO_CAPTURADO,
  EVENTOS.DOCUMENTO_ESTADO_CAMBIADO,
  EVENTOS.EXTRACCION_CREADA,
  EVENTOS.EXTRACCION_LISTA_PARA_REVISION,
  EVENTOS.EXTRACCION_CONFIRMADA,
  EVENTOS.SOLICITUD_ESTADO_CAMBIADO,
]) {
  suscribir(evento, alCambiarCaso);
}

module.exports = router;
