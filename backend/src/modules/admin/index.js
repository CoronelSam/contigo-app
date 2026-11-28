'use strict';

// Router del módulo "admin". Define rutas completas relativas a /api/v1 y pon los middlewares
// de autenticación y permisos en cada ruta: nunca uses router.use() con ellos.

const { Router } = require('express');

const router = Router();
router.use(require('./panel.routes'));
router.use(require('./usuarios.routes'));
router.use(require('./catalogos.routes'));
router.use(require('./configuracion.routes'));

module.exports = router;
