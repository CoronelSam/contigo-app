'use strict';

// Módulo familias (agente 04): catálogos, contactos, ayuda, niños, tutores y /me/resumen.
// Rutas completas relativas a /api/v1; los middlewares de auth y permisos van en cada ruta.

const { Router } = require('express');

const router = Router();
router.use(require('./catalogos.routes'));
router.use(require('./pacientes.routes'));

module.exports = router;
