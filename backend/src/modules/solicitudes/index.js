'use strict';

// Router del módulo "solicitudes". Define rutas completas relativas a /api/v1 y pon los middlewares
// de autenticación y permisos en cada ruta: nunca uses router.use() con ellos.

const { Router } = require('express');
const { suscribir, EVENTOS } = require('../../core/eventos');
const { alCambiarDocumento } = require('./consentimientos.service');

const router = Router();
router.use(require('./solicitudes.routes'));
router.use(require('./consentimientos.routes'));

// Firma de los consentimientos y vínculos a la versión vigente de cada documento (agente 06).
suscribir(EVENTOS.DOCUMENTO_CAPTURADO, alCambiarDocumento);
suscribir(EVENTOS.DOCUMENTO_ESTADO_CAMBIADO, alCambiarDocumento);

module.exports = router;
