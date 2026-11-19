'use strict';

// Genera docs/openapi.json con todos los endpoints registrados: pnpm openapi

const fs = require('node:fs');
const path = require('node:path');

require('../src/openapi/zod');
require('../src/modules/salud');
require('../src/routes').crearRutasApi(); // carga cada módulo y sus registros OpenAPI

const { generarDocumento } = require('../src/openapi/registro');

const destino = path.resolve(__dirname, '..', 'docs', 'openapi.json');
const documento = generarDocumento();

fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, `${JSON.stringify(documento, null, 2)}\n`);

const rutas = Object.keys(documento.paths ?? {}).length;
console.log(
  `OpenAPI ${documento.openapi} generado en ${path.relative(process.cwd(), destino)} (${rutas} rutas)`,
);
