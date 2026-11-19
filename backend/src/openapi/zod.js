'use strict';

// Zod extendido con `.openapi()`. Todos los esquemas de la API deben importar `z` desde aquí:
//   const { z } = require('../../openapi/zod');

const { z } = require('zod');
const { extendZodWithOpenApi } = require('@asteasolutions/zod-to-openapi');

extendZodWithOpenApi(z);

module.exports = { z };
