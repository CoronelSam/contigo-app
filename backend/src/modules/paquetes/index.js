'use strict';

// Router del módulo "paquetes". Define rutas completas relativas a /api/v1 y pon los middlewares
// de autenticación y permisos en cada ruta: nunca uses router.use() con ellos.

const { Router } = require('express');

const router = Router();
router.use(require('./paquetes.routes'));
router.use(require('./admin.routes'));

module.exports = router;
