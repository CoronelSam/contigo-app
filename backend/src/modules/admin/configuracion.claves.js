'use strict';

// Claves de `configuracion` que el administrador puede cambiar, cada una con su esquema Zod.
// Una clave que no está aquí no se lee ni se escribe por /admin/configuracion (404).
// Los esquemas siguen la forma que leen los módulos dueños de cada regla.

const { z } = require('../../openapi/zod');
const { CODIGOS_SECCIONES_JSON, TIPOS_CONSENTIMIENTO } = require('../../core/expediente');
const { LISTA_ESTADOS_SOLICITUD } = require('../../core/estados/constantes');
const { TipoDocumento } = require('../../models');

const texto = (max) => z.string().trim().min(1).max(max);
const bilingue = (max) => z.strictObject({ es: texto(max), en: texto(max) });
const sinRepetidos = (lista) => new Set(lista).size === lista.length;
const listaSinRepetidos = (elemento) =>
  z.array(elemento).refine(sinRepetidos, { params: { codigo: 'REPETIDO' } });

const consentimiento = z.enum(TIPOS_CONSENTIMIENTO);

const articulo = z.strictObject({
  codigo: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
  titulo: texto(200),
  cuerpo: texto(20000),
});
const codigosDe = (lista) => lista.map((a) => a.codigo).sort();
const articulos = z
  .array(articulo)
  .max(50)
  .refine((lista) => sinRepetidos(lista.map((a) => a.codigo)), {
    params: { codigo: 'CODIGO_REPETIDO' },
  });

/** @type {Record<string, { esquema: import('zod').ZodType, quien: string }>} */
const CLAVES = Object.freeze({
  'contactos.oficiales': {
    quien: 'Contactos oficiales de la pantalla 33 (agente 04)',
    esquema: z.strictObject({
      dePrueba: z.boolean().optional(),
      organizacion: texto(200),
      telefono: texto(30),
      whatsapp: texto(30).optional(),
      correo: z.string().trim().toLowerCase().max(254).pipe(z.email()),
      horario: bilingue(300),
      direccion: bilingue(500).optional(),
    }),
  },
  'ayuda.articulos': {
    quien: 'Artículos de ayuda de la pantalla 33 (agente 04)',
    esquema: z
      .strictObject({ es: articulos, en: articulos })
      .refine((v) => JSON.stringify(codigosDe(v.es)) === JSON.stringify(codigosDe(v.en)), {
        params: { codigo: 'IDIOMAS_DISTINTOS' },
      }),
  },
  'solicitudes.permitir_multiples_abiertas': {
    quien: 'Una solicitud abierta por niño (agente 05)',
    esquema: z.boolean(),
  },
  'consentimientos.requieren_firma': {
    quien: 'Consentimientos con firma pendiente (agente 05)',
    esquema: listaSinRepetidos(consentimiento),
  },
  'ocr.umbral_confianza': {
    quien: 'Campos dudosos del OCR (agente 07)',
    esquema: z.number().min(0).max(1),
  },
  'paquete.bloquear_firmas_pendientes': {
    quien: 'Firmas pendientes en el paquete final (agentes 02 y 11)',
    esquema: z.boolean(),
  },
  'paquete.consentimiento_secciones': {
    quien: 'Consentimiento que exige cada sección para entrar al paquete (agente 11)',
    esquema: z.partialRecord(z.enum(CODIGOS_SECCIONES_JSON), consentimiento),
  },
  'paquete.consentimiento_anexos': {
    quien: 'Consentimiento que exige cada categoría de documento para anexarse (agente 11)',
    esquema: z.partialRecord(z.enum(TipoDocumento.VALORES.categoria), consentimiento),
  },
  'auth.exigir_correo_verificado': {
    quien: 'Inicio de sesión con correo verificado (agente 03)',
    esquema: z.boolean(),
  },
  'asignaciones.varios_voluntarios': {
    quien: 'Varios voluntarios a la vez en un caso (agente 08)',
    esquema: z.boolean(),
  },
  'tablero.estados_ocultos': {
    quien: 'Estados que el tablero del coordinador oculta sin filtro (agente 09)',
    esquema: listaSinRepetidos(z.enum(LISTA_ESTADOS_SOLICITUD)).refine(
      (lista) => lista.length < LISTA_ESTADOS_SOLICITUD.length,
      { params: { codigo: 'OCULTA_TODOS' } },
    ),
  },
});

const LISTA_CLAVES = Object.freeze(Object.keys(CLAVES));

module.exports = { CLAVES, LISTA_CLAVES };
