'use strict';

// Mapa de campos de una plantilla oficial: de dónde sale cada valor del paquete y dónde se
// escribe (por nombre de campo del PDF o por coordenadas). No existe un tipo `firma`: las firmas
// nunca se rellenan.

const { z } = require('../../openapi/zod');
const { CODIGOS_SECCIONES_JSON, TIPOS_CONSENTIMIENTO } = require('../../core/expediente');
const { esquemaDe } = require('../solicitudes/esquemas');

const FORMATOS_FECHA = Object.freeze(['DD/MM/AAAA', 'MM/DD/AAAA', 'AAAA-MM-DD']);

/** Campos de cada grupo que se pueden usar como origen. */
const CAMPOS = Object.freeze({
  paciente: Object.freeze([
    'nombres',
    'apellidoPaterno',
    'apellidoMaterno',
    'apellidos',
    'nombreCompleto',
    'fechaNacimiento',
    'sexo',
    'direccion',
    'municipio',
    'departamento',
  ]),
  tutorResponsable: Object.freeze([
    'nombres',
    'apellidos',
    'nombreCompleto',
    'parentesco',
    'telefono',
    'correo',
    'direccion',
  ]),
  profesional: Object.freeze(['nombre', 'especialidad', 'telefono', 'correo']),
  solicitud: Object.freeze(['codigo']),
});

/** Campos fijos cuyo valor es un código de catálogo. */
const CATALOGO_DE_CAMPO = Object.freeze({
  'tutorResponsable.parentesco': 'parentesco',
  'profesional.especialidad': 'especialidad_medica',
});

const elemento = z
  .strictObject({
    destino: z
      .strictObject({ campoPdf: z.string().min(1).max(200) })
      .optional()
      .openapi({ description: 'Método `campo`: nombre del campo del formulario PDF' }),
    destinoCoordenadas: z
      .strictObject({
        pagina: z.number().int().min(1).max(200),
        x: z.number().min(0).max(5000),
        y: z.number().min(0).max(5000),
        tamano: z.number().min(4).max(36).optional(),
        ancho: z.number().positive().max(5000).optional(),
      })
      .optional()
      .openapi({
        description:
          'Método `coordenadas`: página (desde 1) y posición en puntos PDF desde la esquina ' +
          'inferior izquierda. `ancho` limita el texto (se reduce la letra hasta 6 pt).',
      }),
    origen: z
      .string()
      .min(3)
      .max(200)
      .openapi({
        description:
          '`paciente.<campo>`, `tutorResponsable.<campo>`, `profesional.<campo>`, ' +
          '`solicitud.codigo`, `consentimiento.<tipo>.decision` o `seccion.<codigo>./<puntero>`',
        example: 'seccion.informacion_medica./diagnostico',
      }),
    tipo: z.enum(['texto', 'fecha', 'casilla']),
    formato: z.enum(FORMATOS_FECHA).optional(),
    valor: z.string().min(1).max(100).optional().openapi({
      description: 'Casillas: se marca si el dato es este código (o lo contiene, en listas)',
    }),
    requiereConsentimiento: z.enum(TIPOS_CONSENTIMIENTO).optional().openapi({
      description: 'Si el consentimiento no es `acepta`, el campo queda en blanco',
    }),
  })
  .superRefine((v, ctx) => {
    const problema = (path, codigo) => ctx.addIssue({ code: 'custom', path, params: { codigo } });
    if (!interpretarOrigen(v.origen)) problema(['origen'], 'ORIGEN_DESCONOCIDO');
    if (!v.destino && !v.destinoCoordenadas) problema(['destino'], 'REQUERIDO');
    if (v.destino && v.destinoCoordenadas) problema(['destinoCoordenadas'], 'SOLO_UN_DESTINO');
    if (v.formato && v.tipo !== 'fecha') problema(['formato'], 'SOLO_PARA_FECHAS');
    if (v.valor !== undefined && v.tipo !== 'casilla') problema(['valor'], 'SOLO_PARA_CASILLAS');
  });

/** Formato de `plantillas_formulario.mapa_campos`. */
const esquemaMapaCampos = z.array(elemento).min(1).max(1000).openapi('MapaCampos');

/** Nodo del JSON Schema de una sección que corresponde a un puntero (`/a/0/b`), o null. */
function nodoDeEsquema(esquema, tokens) {
  let nodo = esquema;
  for (const t of tokens) {
    if (!nodo) return null;
    if (nodo.type === 'array') nodo = /^\d+$/.test(t) ? nodo.items : null;
    else nodo = nodo.properties?.[t] ?? null;
  }
  return nodo;
}

/**
 * Interpreta un origen. Devuelve null si no es uno conocido.
 * @param {string} origen
 * @returns {null | { tipo: string, campo?: string, seccion?: string, tokens?: string[],
 *   nodo?: object, consentimiento?: string }}
 */
function interpretarOrigen(origen) {
  const seccion = /^seccion\.([a-z_]+)\.(\/[A-Za-z0-9_/]+)$/.exec(origen);
  if (seccion) {
    const [, codigo, puntero] = seccion;
    if (!CODIGOS_SECCIONES_JSON.includes(codigo)) return null;
    const tokens = puntero.split('/').slice(1);
    if (tokens.some((t) => t === '')) return null;
    const nodo = nodoDeEsquema(esquemaDe(codigo), tokens);
    return nodo ? { tipo: 'seccion', seccion: codigo, tokens, nodo } : null;
  }
  const consentimiento = /^consentimiento\.([a-z_]+)\.decision$/.exec(origen);
  if (consentimiento) {
    return TIPOS_CONSENTIMIENTO.includes(consentimiento[1])
      ? { tipo: 'consentimiento', consentimiento: consentimiento[1] }
      : null;
  }
  const [grupo, campo, ...resto] = origen.split('.');
  if (resto.length || !Object.hasOwn(CAMPOS, grupo) || !CAMPOS[grupo].includes(campo)) {
    return null;
  }
  const catalogo = CATALOGO_DE_CAMPO[`${grupo}.${campo}`];
  return { tipo: grupo, campo, nodo: catalogo ? { catalogo } : null };
}

/** Textos de algunos códigos de respuesta, para escribirlos en el idioma de la plantilla. */
const TEXTOS = Object.freeze({
  si: ['Sí', 'Yes'],
  no: ['No', 'No'],
  no_se: ['No sé', "Don't know"],
  logrado: ['Logrado', 'Achieved'],
  aun_no: ['Aún no', 'Not yet'],
  femenino: ['Femenino', 'Female'],
  masculino: ['Masculino', 'Male'],
  acepta: ['Acepta', 'Accepts'],
  no_acepta: ['No acepta', 'Does not accept'],
});

const textoDe = (valor, idioma) =>
  (Object.hasOwn(TEXTOS, valor) ? TEXTOS[valor][idioma === 'en' ? 1 : 0] : null) ?? valor;

/** Fecha ISO (AAAA, AAAA-MM o AAAA-MM-DD) en el formato de la plantilla. */
function formatearFecha(valor, formato = 'DD/MM/AAAA') {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(valor).slice(0, 10));
  if (!m) return String(valor);
  const [, a, mes, dia] = m;
  if (!mes) return a;
  if (!dia) return formato === 'AAAA-MM-DD' ? `${a}-${mes}` : `${mes}/${a}`;
  if (formato === 'MM/DD/AAAA') return `${mes}/${dia}/${a}`;
  if (formato === 'AAAA-MM-DD') return `${a}-${mes}-${dia}`;
  return `${dia}/${mes}/${a}`;
}

/** Valor crudo de un dato de sección, siguiendo el puntero. */
function valorEnDatos(datos, tokens) {
  let actual = datos;
  for (const t of tokens) {
    if (actual === null || typeof actual !== 'object') return undefined;
    actual = actual[t];
  }
  return actual;
}

/**
 * Texto legible de un valor: listas separadas por comas, objetos por espacios, códigos de
 * catálogo y respuestas en el idioma de la plantilla. null si no hay dato.
 */
function legible(valor, nodo, ctx, idioma) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (Array.isArray(valor)) {
    const partes = valor.map((x) => legible(x, nodo?.items, ctx, idioma)).filter((x) => x !== null);
    return partes.length ? partes.join(', ') : null;
  }
  if (typeof valor === 'object') {
    const partes = Object.entries(valor)
      .map(([k, x]) => legible(x, nodo?.properties?.[k], ctx, idioma))
      .filter((x) => x !== null);
    return partes.length ? partes.join(' ') : null;
  }
  if (typeof valor === 'boolean') return textoDe(valor ? 'si' : 'no', idioma);
  if (typeof nodo?.catalogo === 'string') return ctx.etiqueta(nodo.catalogo, String(valor), idioma);
  return textoDe(String(valor), idioma);
}

/** Valor crudo de un origen ya interpretado. */
function crudoDe(origen, ctx) {
  switch (origen.tipo) {
    case 'seccion':
      return valorEnDatos(ctx.secciones.get(origen.seccion), origen.tokens);
    case 'consentimiento':
      return ctx.consentimientos.get(origen.consentimiento)?.decision ?? null;
    default:
      return ctx[origen.tipo]?.[origen.campo] ?? null;
  }
}

/** ¿Una casilla va marcada? Sin `valor`: si el dato es verdadero (`true`, `si`, `acepta`…). */
function marcada(crudo, valor) {
  if (crudo === null || crudo === undefined || crudo === '') return false;
  if (valor === undefined) {
    if (Array.isArray(crudo)) return crudo.length > 0;
    return crudo === true || ['si', 'acepta', 'logrado'].includes(String(crudo));
  }
  if (Array.isArray(crudo)) return crudo.map(String).includes(valor);
  return String(crudo) === valor;
}

/**
 * Lo que se escribe para un elemento del mapa: `{ texto }` (texto o fecha) o `{ marcada }`.
 * Devuelve null si no hay dato.
 * @param {object} el Elemento del mapa de campos.
 * @param {object} origen Resultado de interpretarOrigen(el.origen).
 * @param {object} ctx Datos del caso (ver generador.js).
 * @param {'es' | 'en'} idioma
 */
function resolverElemento(el, origen, ctx, idioma) {
  const crudo = crudoDe(origen, ctx);
  if (el.tipo === 'casilla') return { marcada: marcada(crudo, el.valor) };
  if (el.tipo === 'fecha') {
    if (crudo === null || crudo === undefined || crudo === '') return null;
    const iso = crudo instanceof Date ? crudo.toISOString() : String(crudo);
    return { texto: formatearFecha(iso, el.formato) };
  }
  const texto = legible(crudo, origen.nodo, ctx, idioma);
  return texto === null ? null : { texto };
}

module.exports = {
  FORMATOS_FECHA,
  CAMPOS,
  esquemaMapaCampos,
  interpretarOrigen,
  resolverElemento,
  formatearFecha,
};
