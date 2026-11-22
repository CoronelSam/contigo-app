'use strict';

// Validación de las secciones del formulario con los JSON Schema 2020-12 de `esquemas/v1/`.
//
// Un mismo esquema se valida en 2 niveles:
// - borrador: tipos, formatos, catálogos y contradicciones. Decide si el guardado se acepta.
// - completo: lo anterior más los campos obligatorios. Decide el estado de la sección.
//
// Los obligatorios van en la palabra clave propia `obligatorios` (no en `required`), que en el
// nivel borrador no exige nada. Así un campo condicional (dentro de `then`) solo se exige cuando
// aplica y nunca se pide un campo oculto. Las contradicciones se escriben con `false` (el campo no
// aplica) y se rechazan en los 2 niveles.
//
// Otras palabras clave propias:
// - `catalogo: "<tipo>"`: el valor es el código de un ítem activo de `catalogos_items`.
// - `noFutura: true`: la fecha no es posterior a hoy (hora de Honduras).
// Y el formato `fecha-aproximada`: AAAA, AAAA-MM o AAAA-MM-DD.

const Ajv2020 = require('ajv/dist/2020');
const { CODIGOS_SECCIONES_JSON } = require('../../../core/expediente');
const { validacion } = require('../../../core/errores');

const VERSION_PLANTILLA = 'v1';
const ZONA_HORARIA = 'America/Tegucigalpa';

/** Hoy en Honduras, AAAA-MM-DD. */
const hoyIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date());

/** AAAA, AAAA-MM o AAAA-MM-DD con mes y día reales. */
function esFechaAproximada(valor) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(valor);
  if (!m) return false;
  const [, anio, mes, dia] = m;
  if (Number(anio) < 1900) return false;
  if (mes === undefined) return true;
  if (Number(mes) < 1 || Number(mes) > 12) return false;
  if (dia === undefined) return true;
  const fecha = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)));
  return fecha.getUTCMonth() === Number(mes) - 1 && fecha.getUTCDate() === Number(dia);
}

/** Un campo obligatorio no cuenta como respondido si es null, texto en blanco o lista vacía. */
const NO_VACIO = Object.freeze({
  not: {
    anyOf: [
      { type: 'null' },
      { type: 'string', pattern: '^\\s*$' },
      { type: 'array', maxItems: 0 },
    ],
  },
});

/** @param {'borrador' | 'completo'} nivel */
function crearAjv(nivel) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, passContext: true });
  ajv.addFormat('fecha-aproximada', { type: 'string', validate: esFechaAproximada });
  ajv.addKeyword({
    keyword: 'noFutura',
    type: 'string',
    schemaType: 'boolean',
    errors: false,
    validate: (activo, valor) =>
      !activo || !esFechaAproximada(valor) || valor <= hoyIso().slice(0, valor.length),
  });
  ajv.addKeyword({
    keyword: 'catalogo',
    type: 'string',
    schemaType: 'string',
    errors: false,
    // `this` es el contexto de validate.call(): { catalogos: Map<tipo, Set<codigo>> }.
    validate: function validarCatalogo(tipo, valor) {
      return Boolean(this?.catalogos?.get(tipo)?.has(valor));
    },
  });
  ajv.addKeyword({
    keyword: 'obligatorios',
    type: 'object',
    schemaType: 'array',
    macro:
      nivel === 'completo'
        ? (campos) => ({
            type: 'object',
            required: campos,
            properties: Object.fromEntries(campos.map((c) => [c, NO_VACIO])),
          })
        : () => true,
  });
  return ajv;
}

/** Tipos de catálogo que usa un esquema (para cargarlos antes de validar). */
function tiposDeCatalogo(nodo, tipos = new Set()) {
  if (Array.isArray(nodo)) nodo.forEach((n) => tiposDeCatalogo(n, tipos));
  else if (nodo && typeof nodo === 'object') {
    if (typeof nodo.catalogo === 'string') tipos.add(nodo.catalogo);
    Object.values(nodo).forEach((n) => tiposDeCatalogo(n, tipos));
  }
  return tipos;
}

const ajvBorrador = crearAjv('borrador');
const ajvCompleto = crearAjv('completo');

/** @type {Map<string, { esquema: object, borrador: Function, completo: Function, catalogos: string[] }>} */
const VALIDADORES = new Map(
  CODIGOS_SECCIONES_JSON.map((codigo) => {
    const esquema = require(`./${VERSION_PLANTILLA}/${codigo}.json`);
    return [
      codigo,
      {
        esquema,
        borrador: ajvBorrador.compile(esquema),
        completo: ajvCompleto.compile(esquema),
        catalogos: [...tiposDeCatalogo(esquema)],
      },
    ];
  }),
);

/** ¿Es una de las 6 secciones con JSON Schema? */
const tieneEsquema = (seccion) => VALIDADORES.has(seccion);

/** Esquema JSON de una sección (para documentación o para la app). */
const esquemaDe = (seccion) => VALIDADORES.get(seccion)?.esquema ?? null;

/** Ítems activos de los catálogos indicados: Map<tipo, Set<codigo>>. */
async function cargarCatalogos(tipos, transaction) {
  const catalogos = new Map(tipos.map((t) => [t, new Set()]));
  if (!tipos.length) return catalogos;
  const { CatalogoItem } = require('../../../models');
  const items = await CatalogoItem.findAll({
    where: { tipo: tipos, activo: true },
    attributes: ['tipo', 'codigo'],
    transaction,
  });
  for (const i of items) catalogos.get(i.tipo).add(i.codigo);
  return catalogos;
}

const sinValor = (v) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Copia limpia de los datos: textos sin espacios al inicio ni al final, y sin las claves con
 * null, texto vacío o lista vacía (un campo que se borró en la app equivale a no responderlo).
 */
function normalizar(valor) {
  if (typeof valor === 'string') return valor.trim();
  if (Array.isArray(valor)) return valor.map(normalizar);
  if (valor && typeof valor === 'object') {
    const limpio = {};
    for (const [k, v] of Object.entries(valor)) {
      const n = normalizar(v);
      if (!sinValor(n)) limpio[k] = n;
    }
    return limpio;
  }
  return valor;
}

const CODIGO_POR_KEYWORD = Object.freeze({
  type: 'TIPO_INVALIDO',
  enum: 'VALOR_NO_PERMITIDO',
  const: 'VALOR_NO_PERMITIDO',
  catalogo: 'VALOR_NO_PERMITIDO',
  format: 'FORMATO_INVALIDO',
  noFutura: 'FECHA_FUTURA',
  minLength: 'MUY_CORTO',
  maxLength: 'MUY_LARGO',
  minItems: 'MUY_POCOS',
  maxItems: 'DEMASIADOS',
  minimum: 'MUY_PEQUENO',
  exclusiveMinimum: 'MUY_PEQUENO',
  maximum: 'MUY_GRANDE',
  exclusiveMaximum: 'MUY_GRANDE',
  uniqueItems: 'REPETIDO',
  additionalProperties: 'CAMPO_NO_PERMITIDO',
  required: 'REQUERIDO',
  'false schema': 'NO_APLICA',
});

/** Ruta JSON Pointer del campo de un error de Ajv. */
function punteroDe(error) {
  if (error.keyword === 'additionalProperties')
    return `${error.instancePath}/${error.params.additionalProperty}`;
  if (error.keyword === 'required') return `${error.instancePath}/${error.params.missingProperty}`;
  return error.instancePath;
}

const segmentos = (puntero) =>
  puntero
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

/**
 * Errores de Ajv → `campos` de la respuesta de error.
 * @param {object[]} errores
 * @param {{ prefijo?: string, formato?: 'punto' | 'puntero' }} [opciones] `punto`: `datos.alergias`;
 *   `puntero`: `/alergias` (la rutaDato del OCR).
 */
function camposDesdeAjv(errores, { prefijo = 'datos', formato = 'punto' } = {}) {
  const campos = {};
  for (const e of errores) {
    // `if`, `not`, `anyOf`… solo envuelven a los errores de verdad, que vienen aparte.
    if (!(e.keyword in CODIGO_POR_KEYWORD)) continue;
    const puntero = punteroDe(e);
    const clave =
      formato === 'puntero' ? puntero || '/' : [prefijo, ...segmentos(puntero)].join('.');
    campos[clave] ??= CODIGO_POR_KEYWORD[e.keyword];
  }
  return Object.keys(campos).length ? campos : { [prefijo]: 'INVALIDO' };
}

/** Campos obligatorios que faltan (rutas con punto, sin prefijo), del nivel completo. */
function pendientesDesdeAjv(errores) {
  const pendientes = new Set();
  for (const e of errores ?? []) {
    if (e.keyword === 'required' || e.keyword === 'not') {
      pendientes.add(segmentos(punteroDe(e)).join('.'));
    }
  }
  return [...pendientes];
}

/**
 * Valida los datos de una sección y calcula su estado.
 *
 * @param {string} seccion Código de una de las 6 secciones con JSON.
 * @param {unknown} datos
 * @param {{ transaction?: import('sequelize').Transaction, formato?: 'punto' | 'puntero' }} [opciones]
 * @returns {Promise<{ datos: object, estado: 'vacia' | 'incompleta' | 'completa', pendientes: string[] }>}
 * @throws 400 VALIDACION con `campos` si los datos no pasan el nivel borrador.
 */
async function validarSeccion(seccion, datos, { transaction, formato = 'punto' } = {}) {
  const v = VALIDADORES.get(seccion);
  if (!v) throw new Error(`Sección sin esquema: ${seccion}`);
  const limpios = normalizar(datos);
  const contexto = { catalogos: await cargarCatalogos(v.catalogos, transaction) };

  if (!v.borrador.call(contexto, limpios)) {
    throw validacion(
      camposDesdeAjv(v.borrador.errors, { formato }),
      'Los datos de la sección no son válidos',
    );
  }
  if (!limpios || Object.keys(limpios).length === 0) {
    return { datos: {}, estado: 'vacia', pendientes: pendientesDe(v, {}, contexto) };
  }
  const pendientes = pendientesDe(v, limpios, contexto);
  return { datos: limpios, estado: pendientes.length ? 'incompleta' : 'completa', pendientes };
}

function pendientesDe(v, datos, contexto) {
  return v.completo.call(contexto, datos) ? [] : pendientesDesdeAjv(v.completo.errors);
}

/**
 * Campos obligatorios que faltan en datos ya guardados (para la respuesta de GET).
 * @param {string} seccion
 * @param {object} datos
 */
async function pendientesDeSeccion(seccion, datos, { transaction } = {}) {
  const v = VALIDADORES.get(seccion);
  const contexto = { catalogos: await cargarCatalogos(v.catalogos, transaction) };
  return pendientesDe(v, datos ?? {}, contexto);
}

module.exports = {
  VERSION_PLANTILLA,
  tieneEsquema,
  esquemaDe,
  validarSeccion,
  pendientesDeSeccion,
  camposDesdeAjv,
  normalizar,
  esFechaAproximada,
};
