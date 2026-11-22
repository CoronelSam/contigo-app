'use strict';

// Router del módulo "documentos". Define rutas completas relativas a /api/v1 y pon los middlewares
// de autenticación y permisos en cada ruta: nunca uses router.use() con ellos.

const { Router } = require('express');
const { suscribir, EVENTOS } = require('../../core/eventos');
const { alGuardarSeccion } = require('./correcciones.service');

const router = Router();
router.use(require('./documentos.routes'));
router.use(require('./correcciones.routes'));

// Las correcciones de una sección se resuelven cuando la familia la guarda (agente 05).
suscribir(EVENTOS.SECCION_GUARDADA, alGuardarSeccion);

module.exports = router;
