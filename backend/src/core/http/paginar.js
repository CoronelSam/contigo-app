'use strict';

const { z } = require('../../openapi/zod');
const { validacion } = require('../errores');
const { camposDesdeZod } = require('../errores/zod');

const LIMITE_MAXIMO = 100;

/** Esquema de `?page=&limit=` para combinar en los esquemas de query de cada endpoint. */
const esquemaPaginacion = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(20),
});

/**
 * Lee la paginación de un query (ya validado o crudo).
 * @param {Record<string, unknown>} [query]
 * @returns {{ page: number, limit: number, offset: number }}
 */
function leerPaginacion(query = {}) {
  const resultado = esquemaPaginacion.safeParse({ page: query.page, limit: query.limit });
  if (!resultado.success) {
    throw validacion(camposDesdeZod(resultado.error, { datos: query, prefijo: 'query' }));
  }
  const { page, limit } = resultado.data;
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Arma la respuesta paginada común: `{ datos, paginacion: { page, limit, total } }`.
 * @template T
 * @param {{ datos: T[], total: number, page: number, limit: number }} p
 */
function respuestaPaginada({ datos, total, page, limit }) {
  return { datos, paginacion: { page, limit, total } };
}

module.exports = { esquemaPaginacion, leerPaginacion, respuestaPaginada, LIMITE_MAXIMO };
