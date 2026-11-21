'use strict';

// Módulo auth (agente 03): /auth/* y /me*.
// Rutas completas relativas a /api/v1; los middlewares de auth y límites van en cada ruta.

const { Router } = require('express');

const router = Router();
router.use(require('./auth.routes'));
router.use(require('./perfil.routes'));

module.exports = router;
