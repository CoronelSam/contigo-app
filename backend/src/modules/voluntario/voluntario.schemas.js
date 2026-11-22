'use strict';

// Esquemas Zod del módulo voluntario (entrada y salida; también documentan OpenAPI).

const { z } = require('../../openapi/zod');
const { esquemaPaginacion } = require('../../core/http/paginar');
const { LISTA_ESTADOS_SOLICITUD } = require('../../core/estados/constantes');
const { ESTADOS } = require('./estado');

const uuid = z.uuid();
const fechaHora = z.string().openapi({ format: 'date-time' });
const estadoAsignacion = z.enum(Object.values(ESTADOS));
const notas = z.string().trim().min(1).max(1000).nullable().optional();

// --- Entrada

const paramsId = z.object({ id: uuid });

const crearAsignacion = z.strictObject({ voluntarioId: uuid, notas }).openapi('AsignacionNueva');

const cambiarAsignacion = z
  .strictObject({
    activa: z.literal(false).optional().openapi({ description: 'Cierra la asignación' }),
    voluntarioId: uuid.optional().openapi({
      description: 'Reasigna: cierra esta asignación y crea una para este voluntario',
    }),
    notas,
  })
  .refine((v) => Object.keys(v).length > 0, {
    params: { codigo: 'SIN_CAMBIOS' },
    when: (p) => p.issues.length === 0,
  })
  .refine((v) => !v.voluntarioId || v.activa === false, {
    params: { codigo: 'REQUERIDO' },
    path: ['activa'],
    when: (p) => p.issues.length === 0,
  })
  .openapi('AsignacionCambios');

const listarCasos = esquemaPaginacion.extend({
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .openapi({ description: 'Nombre del niño (sin acentos) o código del caso' }),
  estado: estadoAsignacion.optional(),
});

// --- Salida

const asignacion = z
  .object({
    id: uuid,
    solicitudId: uuid,
    voluntario: z.object({ id: uuid, nombres: z.string(), apellidos: z.string() }),
    estado: estadoAsignacion,
    activa: z.boolean(),
    notas: z.string().nullable(),
    creadaEn: fechaHora,
    actualizadaEn: fechaHora,
  })
  .openapi('Asignacion');

const resultadoCambio = asignacion
  .extend({ reemplazo: asignacion.nullable() })
  .openapi('AsignacionCambiada');

const resumen = z
  .object({
    casosAsignados: z.number().int(),
    pendientesRevision: z.number().int(),
    capturasPendientes: z.number().int(),
    revisados: z.number().int(),
  })
  .openapi('ResumenVoluntario', {
    description:
      'Casos con asignación activa. `capturasPendientes`: asignado, pendiente de captura o captura ' +
      'en proceso. Los 3 últimos suman `casosAsignados`',
  });

const caso = z
  .object({
    asignacionId: uuid,
    solicitudId: uuid,
    codigo: z.string(),
    estadoSolicitud: z.enum(LISTA_ESTADOS_SOLICITUD),
    paciente: z.object({
      nombreCompleto: z.string(),
      edad: z.object({ anios: z.number().int(), meses: z.number().int() }),
      municipio: z.object({ codigo: z.string(), nombre: z.string() }).nullable(),
    }),
    estadoAsignacion,
    pendientes: z.object({
      documentos: z
        .number()
        .int()
        .openapi({ description: 'Obligatorios sin capturar o rechazados' }),
      revisionesOcr: z.number().int().openapi({ description: 'Extracciones por confirmar' }),
    }),
    asignadaEn: fechaHora,
  })
  .openapi('CasoVoluntario');

module.exports = {
  entrada: { paramsId, crearAsignacion, cambiarAsignacion, listarCasos },
  salida: { asignacion, resultadoCambio, resumen, caso },
};
