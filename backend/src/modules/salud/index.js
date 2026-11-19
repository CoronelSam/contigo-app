'use strict';

// Módulo salud (agente 00): GET /health, GET /openapi.json y GET /docs.
// Se monta en la raíz, fuera de /api/v1.

const { Router } = require('express');
const swaggerUi = require('swagger-ui-express');
const { z } = require('../../openapi/zod');
const { config } = require('../../config/env');
const { ejecutarChequeos } = require('../../core/salud');
const { registrarRuta, generarDocumento } = require('../../openapi/registro');

const router = Router();

const esquemaSalud = z
  .object({
    estado: z.enum(['operativo', 'degradado']),
    chequeos: z.record(z.string(), z.object({ ok: z.boolean(), ms: z.number().int() })),
  })
  .openapi('Salud');

registrarRuta({
  metodo: 'get',
  ruta: '/health',
  raiz: true,
  publica: true,
  resumen: 'Estado del sistema',
  descripcion: 'Revisa base de datos, cola, almacenamiento y OCR. Sin detalles internos.',
  etiquetas: ['Salud'],
  respuestas: {
    200: { descripcion: 'Todos los componentes responden', esquema: esquemaSalud },
    503: { descripcion: 'Algún componente no responde', esquema: esquemaSalud },
  },
});

router.get('/health', async (req, res) => {
  const resultado = await ejecutarChequeos({ logger: req.log });
  res.set('Cache-Control', 'no-store');
  res.status(resultado.estado === 'operativo' ? 200 : 503).json(resultado);
});

if (config().http.docsHabilitadas) {
  let documento;
  const obtenerDocumento = () => {
    documento ??= generarDocumento();
    return documento;
  };

  router.get('/openapi.json', (req, res) => {
    res.json(obtenerDocumento());
  });

  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(null, {
      customSiteTitle: 'API de Vanguardia',
      swaggerOptions: { url: '/openapi.json' },
    }),
  );
}

module.exports = router;
