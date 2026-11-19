'use strict';

/** Lee el valor en una ruta de un objeto (para saber si un campo faltaba). */
function valorEn(datos, ruta) {
  let actual = datos;
  for (const parte of ruta) {
    if (actual === null || typeof actual !== 'object') return undefined;
    actual = actual[parte];
  }
  return actual;
}

const SEGUN_ORIGEN_MIN = { string: 'MUY_CORTO', array: 'MUY_POCOS', set: 'MUY_POCOS' };
const SEGUN_ORIGEN_MAX = { string: 'MUY_LARGO', array: 'DEMASIADOS', set: 'DEMASIADOS' };

/** ¿El campo no venía? Con los datos originales se sabe con certeza; sin ellos, por el issue. */
function faltaba(issue, datos, hayDatos) {
  if (hayDatos) return valorEn(datos, issue.path) === undefined;
  if ('input' in issue) return issue.input === undefined;
  return /received undefined/.test(issue.message ?? '');
}

/** Traduce un issue de Zod a un código estable en español. */
function codigoDeIssue(issue, datos, hayDatos) {
  switch (issue.code) {
    case 'invalid_type':
      return faltaba(issue, datos, hayDatos) ? 'REQUERIDO' : 'TIPO_INVALIDO';
    case 'too_small':
      return SEGUN_ORIGEN_MIN[issue.origin] ?? 'MUY_PEQUENO';
    case 'too_big':
      return SEGUN_ORIGEN_MAX[issue.origin] ?? 'MUY_GRANDE';
    case 'invalid_format':
      return 'FORMATO_INVALIDO';
    case 'invalid_value':
    case 'invalid_union':
      return 'VALOR_NO_PERMITIDO';
    case 'custom':
      return issue.params?.codigo ?? 'INVALIDO';
    default:
      return 'INVALIDO';
  }
}

/**
 * Convierte un ZodError en `campos` para la respuesta de error.
 * @param {import('zod').ZodError} error
 * @param {{ datos?: unknown, prefijo?: string }} [opciones]
 * @returns {Record<string, string>}
 */
function camposDesdeZod(error, opciones = {}) {
  const { datos, prefijo = '' } = opciones;
  const hayDatos = 'datos' in opciones;
  const campos = {};
  const clave = (ruta) =>
    [prefijo, ...ruta].filter((p) => p !== '').join('.') || prefijo || 'cuerpo';

  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const k of issue.keys) campos[clave([...issue.path, k])] = 'CAMPO_NO_PERMITIDO';
      continue;
    }
    const k = clave(issue.path.map(String));
    if (!campos[k]) campos[k] = codigoDeIssue(issue, datos, hayDatos);
  }
  return campos;
}

module.exports = { camposDesdeZod };
