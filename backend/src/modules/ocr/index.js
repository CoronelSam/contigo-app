'use strict';

// Router del módulo "ocr". Define rutas completas relativas a /api/v1 y pon los middlewares
// de autenticación y permisos en cada ruta: nunca uses router.use() con ellos.

const { Router } = require('express');
const { registrarChequeo } = require('../../core/salud');
const { obtenerMotor } = require('./motores');

const router = Router();
router.use(require('./ocr.routes'));

// GET /health: el motor de OCR configurado responde.
registrarChequeo('ocr', () => obtenerMotor().verificar());

module.exports = router;
