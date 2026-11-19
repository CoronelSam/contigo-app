'use strict';

const { validacion } = require('../errores');
const { camposDesdeZod } = require('../errores/zod');

const PARTES = ['params', 'query', 'body'];

/**
 * Valida `params`, `query` y `body` con esquemas Zod y deja los datos parseados
 * en `req.validado`. En Express 5 `req.query` es de solo lectura: usa siempre `req.validado`.
 *
 * @param {{ params?: import('zod').ZodType, query?: import('zod').ZodType, body?: import('zod').ZodType }} esquemas
 * @returns {import('express').RequestHandler}
 */
function validar(esquemas) {
  return (req, res, next) => {
    const validado = {};
    const campos = {};
    for (const parte of PARTES) {
      const esquema = esquemas[parte];
      if (!esquema) continue;
      const datos = req[parte] ?? {};
      const resultado = esquema.safeParse(datos);
      if (resultado.success) {
        validado[parte] = resultado.data;
      } else {
        Object.assign(
          campos,
          camposDesdeZod(resultado.error, { datos, prefijo: parte === 'body' ? '' : parte }),
        );
      }
    }
    if (Object.keys(campos).length) return next(validacion(campos));
    req.validado = { ...(req.validado ?? {}), ...validado };
    return next();
  };
}

module.exports = { validar };
