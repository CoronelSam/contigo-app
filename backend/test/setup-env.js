'use strict';

// Variables de entorno de las pruebas. Corre antes de cada archivo de prueba y en el setup global.
// Carga .env (sin sobreescribir lo que ya existe) y fuerza proveedores locales y seguros.

const fs = require('node:fs');
const path = require('node:path');

const archivoEnv = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(archivoEnv)) process.loadEnvFile(archivoEnv);

process.env.NODE_ENV = 'test';

Object.assign(process.env, {
  COLA_PROVEEDOR: 'memoria',
  ALMACENAMIENTO_PROVEEDOR: 'memoria',
  CORREO_PROVEEDOR: 'simulado',
  PUSH_PROVEEDOR: 'simulado',
  OCR_PROVEEDOR: 'simulado',
  DOCS_HABILITADAS: 'true',
  // Pruebas silenciosas salvo que se pida otra cosa: TEST_LOG_LEVEL=debug pnpm test
  LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
});

process.env.JWT_SECRET ??= 'secreto-solo-para-pruebas-automaticas-0123456789abcdef';
