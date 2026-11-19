'use strict';

// Registro OpenAPI compartido. Cada endpoint se documenta con registrarRuta() junto a su router:
//
//   registrarRuta({
//     metodo: 'get', ruta: '/pacientes/:id', resumen: 'Detalle de un niño', etiquetas: ['Familias'],
//     params: z.object({ id: z.uuid() }),
//     respuestas: { 200: { descripcion: 'Niño', esquema: esquemaPaciente } },
//     errores: [409],
//   });
//
// Las rutas son relativas a /api/v1 salvo con `raiz: true`.

const { OpenAPIRegistry, OpenApiGeneratorV31 } = require('@asteasolutions/zod-to-openapi');
const { z } = require('./zod');
const paquete = require('../../package.json');

const PREFIJO_API = '/api/v1';

const registro = new OpenAPIRegistry();

const bearerAuth = registro.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const esquemaError = registro.register(
  'Error',
  z
    .object({
      codigo: z.string().openapi({ example: 'VALIDACION' }),
      mensaje: z.string().openapi({ example: 'Los datos enviados no son válidos' }),
      campos: z
        .record(z.string(), z.string())
        .optional()
        .openapi({ example: { correo: 'FORMATO_INVALIDO' } }),
    })
    .openapi({ description: 'Formato común de error. La app traduce por `codigo`.' }),
);

const esquemaPaginacion = registro.register(
  'Paginacion',
  z.object({
    page: z.number().int().openapi({ example: 1 }),
    limit: z.number().int().openapi({ example: 20 }),
    total: z.number().int().openapi({ example: 134 }),
  }),
);

/** Esquema de respuesta paginada `{ datos, paginacion }` para un tipo de elemento. */
function respuestaPaginadaDe(esquemaElemento) {
  return z.object({ datos: z.array(esquemaElemento), paginacion: esquemaPaginacion });
}

const DESCRIPCION_ERROR = {
  400: 'Datos inválidos (`VALIDACION`)',
  401: 'Sin sesión o token vencido (`NO_AUTENTICADO`)',
  403: 'El rol no tiene el permiso (`SIN_PERMISO`)',
  404: 'No existe o el usuario no tiene relación con el recurso (`NO_ENCONTRADO`)',
  409: 'Regla de negocio o transición no permitida',
  412: 'La versión enviada en `If-Match` no coincide',
  413: 'El cuerpo o el archivo es demasiado grande',
  422: 'La `Idempotency-Key` se reutilizó con otro cuerpo',
  428: 'Falta una cabecera de precondición (`If-Match` o `Idempotency-Key`)',
  429: 'Demasiados intentos (`DEMASIADOS_INTENTOS`)',
  503: 'Algún componente no responde',
};

function contenidoJson(esquema) {
  return { 'application/json': { schema: esquema } };
}

/**
 * Documenta un endpoint en OpenAPI.
 * @param {object} d
 * @param {'get'|'post'|'put'|'patch'|'delete'} d.metodo
 * @param {string} d.ruta Ruta de Express (`/pacientes/:id`), relativa a /api/v1 salvo `raiz`.
 * @param {string} d.resumen
 * @param {string} [d.descripcion]
 * @param {string[]} [d.etiquetas]
 * @param {boolean} [d.publica] Sin JWT.
 * @param {boolean} [d.raiz] No se antepone /api/v1.
 * @param {import('zod').ZodObject} [d.params]
 * @param {import('zod').ZodObject} [d.query]
 * @param {import('zod').ZodType} [d.headers] Cabeceras (por ejemplo If-Match o Idempotency-Key).
 * @param {import('zod').ZodType} [d.body] Cuerpo JSON.
 * @param {import('zod').ZodType} [d.bodyMultipart] Cuerpo multipart/form-data.
 * @param {Record<number, { descripcion: string, esquema?: import('zod').ZodType }>} d.respuestas
 * @param {number[]} [d.errores] Códigos de error adicionales a los comunes.
 */
function registrarRuta(d) {
  const ruta = (d.raiz ? '' : PREFIJO_API) + d.ruta.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');

  const responses = {};
  for (const [status, r] of Object.entries(d.respuestas)) {
    responses[status] = r.esquema
      ? { description: r.descripcion, content: contenidoJson(r.esquema) }
      : { description: r.descripcion };
  }
  const tieneEntrada = Boolean(d.params || d.query || d.body || d.bodyMultipart || d.headers);
  const codigos = new Set([
    ...(d.publica ? [] : [401, 403]),
    ...(tieneEntrada ? [400] : []),
    ...(d.params ? [404] : []),
    ...(d.errores ?? []),
  ]);
  for (const c of codigos) {
    responses[c] ??= {
      description: DESCRIPCION_ERROR[c] ?? 'Error',
      content: contenidoJson(esquemaError),
    };
  }

  const request = {};
  if (d.params) request.params = d.params;
  if (d.query) request.query = d.query;
  if (d.headers) request.headers = d.headers;
  if (d.body) request.body = { content: contenidoJson(d.body) };
  if (d.bodyMultipart)
    request.body = { content: { 'multipart/form-data': { schema: d.bodyMultipart } } };

  registro.registerPath({
    method: d.metodo,
    path: ruta,
    summary: d.resumen,
    description: d.descripcion,
    tags: d.etiquetas,
    security: d.publica ? [] : [{ [bearerAuth.name]: [] }],
    request,
    responses,
  });
}

/** Genera el documento OpenAPI 3.1 con todo lo registrado hasta el momento. */
function generarDocumento() {
  const generador = new OpenApiGeneratorV31(registro.definitions);
  return generador.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'API de Vanguardia',
      version: paquete.version,
      description:
        'Backend de Vanguardia. Todas las rutas de negocio están bajo /api/v1 y usan JWT, salvo /auth/*. ' +
        'Errores: `{ codigo, mensaje, campos }`.',
    },
    servers: [{ url: '/' }],
  });
}

module.exports = {
  registro,
  registrarRuta,
  generarDocumento,
  respuestaPaginadaDe,
  esquemaError,
  esquemaPaginacion,
  PREFIJO_API,
};
