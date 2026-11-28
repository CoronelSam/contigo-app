'use strict';

// Router del módulo "comunicacion". Define rutas completas relativas a /api/v1 y pon los middlewares
// de autenticación y permisos en cada ruta: nunca uses router.use() con ellos.

const { Router } = require('express');

const router = Router();
router.use(require('./mensajes.routes'));
router.use(require('./notificaciones.routes'));

module.exports = router;
