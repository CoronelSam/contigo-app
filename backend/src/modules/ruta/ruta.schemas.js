'use strict';

// Esquemas Zod del módulo ruta (entrada y salida; también documentan OpenAPI).

const { z } = require('../../openapi/zod');
const { LISTA_RUTAS, LISTA_RUTAS_SUGERIDAS } = require('../../core/estados/constantes');
const { HECHOS } = require('./hechos');

const uuid = z.uuid();
const fechaHora = z.string().openapi({ format: 'date-time' });
const fecha = z.iso.date().openapi({ example: '2026-12-01' });
const hora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .openapi({ example: '08:30' });
const codigo = (max = 60) => z.string().regex(new RegExp(`^[a-z_]{2,${max}}$`));
const texto = (min, max) => z.string().trim().min(min).max(max);
const ruta = z.enum(LISTA_RUTAS);
const rutaSugerida = z.enum(LISTA_RUTAS_SUGERIDAS);
const TIPOS_PROVEEDOR = ['hospital_publico', 'hospital_privado', 'clinica', 'jornada_medica'];

// --- Entrada

const paramsId = z.object({ id: uuid });
const paramsVersion = z.object({ version: z.coerce.number().int().min(1) });

const evaluacion = z
  .strictObject({
    rutaDecidida: ruta,
    justificacion: texto(30, 5000).openapi({ description: 'Al menos 30 caracteres' }),
    evaluadorNombre: texto(3, 200),
    evaluadorCargo: texto(2, 200),
    tipoDictamen: z.enum(['medico_evaluador', 'comite_medico']),
    fechaDictamen: fecha.openapi({ description: 'No puede ser futura' }),
  })
  .openapi('EvaluacionNueva');

const reabrir = z.strictObject({ motivo: texto(10, 2000) }).openapi('ReaperturaEvaluacion');

const derivacion = z
  .strictObject({
    proveedorId: uuid,
    especialidad: codigo().openapi({ description: 'Código del catálogo `especialidad_medica`' }),
    fechaCita: fecha,
    horaCita: hora.nullable().optional(),
    observaciones: texto(1, 2000).nullable().optional(),
  })
  .openapi('DerivacionNueva');

const cambiarDerivacion = z
  .strictObject({
    fechaCita: fecha.optional(),
    horaCita: hora.nullable().optional(),
    observaciones: texto(1, 2000).nullable().optional(),
    estado: z.enum(['atendida', 'no_asistio', 'cancelada']).optional(),
    volverAEvaluacion: z
      .boolean()
      .optional()
      .openapi({ description: 'Solo con no_asistio o cancelada: reabre la evaluación' }),
  })
  .refine((v) => Object.keys(v).length > 0, {
    params: { codigo: 'SIN_CAMBIOS' },
    when: (p) => p.issues.length === 0,
  })
  .refine((v) => !v.estado || (v.fechaCita === undefined && v.horaCita === undefined), {
    params: { codigo: 'NO_SE_COMBINA_CON_ESTADO' },
    path: ['fechaCita'],
    when: (p) => p.issues.length === 0,
  })
  .refine(
    (v) => v.volverAEvaluacion === undefined || ['no_asistio', 'cancelada'].includes(v.estado),
    {
      params: { codigo: 'SOLO_CON_NO_ASISTIO_O_CANCELADA' },
      path: ['volverAEvaluacion'],
      when: (p) => p.issues.length === 0,
    },
  )
  .openapi('DerivacionCambios');

const filtrosProveedores = z.object({
  especialidad: codigo().optional(),
  departamento: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  municipio: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});

const filtrosProveedoresAdmin = filtrosProveedores.extend({
  activo: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .openapi({ type: 'string' }),
});

const contacto = z
  .strictObject({
    telefono: texto(4, 30).optional(),
    correo: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
    direccion: texto(2, 500).optional(),
  })
  .openapi('ContactoProveedor');

const proveedor = z
  .strictObject({
    nombre: texto(2, 200),
    tipo: z.enum(TIPOS_PROVEEDOR),
    departamentoCodigo: z.string().regex(/^\d{2}$/),
    municipioCodigo: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .optional(),
    especialidades: z.array(codigo()).min(1).max(30),
    contacto: contacto.optional(),
    notas: texto(1, 2000).nullable().optional(),
  })
  .openapi('ProveedorNuevo');

const cambiarProveedor = proveedor
  .partial()
  .extend({
    activo: z.boolean().optional().openapi({ description: '`false` lo desactiva; no se borra' }),
  })
  .refine((v) => Object.keys(v).length > 0, {
    params: { codigo: 'SIN_CAMBIOS' },
    when: (p) => p.issues.length === 0,
  })
  .openapi('ProveedorCambios');

const condicion = z.record(z.string(), z.unknown()).openapi({
  description: `JsonLogic. Solo puede usar estos hechos: ${HECHOS.join(', ')}`,
  example: { '>': [{ var: 'proveedoresLocalesEnDepartamento' }, 0] },
});

const regla = z
  .strictObject({
    version: z.number().int().min(1),
    nombre: z.string().regex(/^[a-z][a-z0-9_]{1,99}$/),
    prioridad: z.number().int().min(0).max(10000),
    condicion,
    rutaSugerida,
    motivoEs: texto(5, 1000),
    motivoEn: texto(5, 1000),
  })
  .openapi('ReglaNueva');

const cambiarRegla = regla
  .omit({ version: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    params: { codigo: 'SIN_CAMBIOS' },
    when: (p) => p.issues.length === 0,
  })
  .openapi('ReglaCambios');

const filtrosReglas = z.object({
  version: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .openapi({ description: 'Por defecto, la activa' }),
});

// --- Salida

const motivo = z.object({
  reglaId: uuid,
  nombre: z.string(),
  rutaSugerida,
  motivo: z.string(),
});

const sugerencia = z
  .object({
    rutaSugerida,
    motivos: z.array(motivo),
    versionReglas: z.number().int().nullable(),
    hechos: z.record(z.string(), z.unknown()),
  })
  .openapi('RutaSugerida', { description: 'Las reglas sugieren; una persona decide' });

const evaluacionSalida = z
  .object({
    id: uuid,
    solicitudId: uuid,
    rutaSugerida,
    motivos: z.array(motivo),
    versionReglas: z.number().int().nullable(),
    hechos: z.record(z.string(), z.unknown()),
    rutaDecidida: ruta,
    justificacion: z.string(),
    evaluadorNombre: z.string(),
    evaluadorCargo: z.string(),
    tipoDictamen: z.string(),
    fechaDictamen: z.string(),
    registradoPor: z.object({ id: uuid, nombre: z.string() }).nullable(),
    vigente: z.boolean(),
    creadaEn: fechaHora,
  })
  .openapi('Evaluacion');

const resultadoEvaluacion = z
  .object({
    evaluacion: evaluacionSalida,
    solicitud: z.object({
      id: uuid,
      estado: z.string(),
      etapa: z.string(),
      rutaDecidida: ruta.nullable(),
      paquete: z.string().nullable(),
    }),
  })
  .openapi('EvaluacionRegistrada');

const proveedorSalida = z
  .object({
    id: uuid,
    nombre: z.string(),
    tipo: z.string(),
    departamento: z.object({ codigo: z.string(), nombre: z.string() }),
    municipio: z.object({ codigo: z.string(), nombre: z.string() }).nullable(),
    especialidades: z.array(z.string()),
    contacto: z.record(z.string(), z.string()),
    activo: z.boolean(),
    notas: z.string().nullable(),
  })
  .openapi('ProveedorLocal');

const derivacionSalida = z
  .object({
    id: uuid,
    solicitudId: uuid,
    proveedor: z.object({ id: uuid, nombre: z.string() }),
    especialidad: z.string(),
    fechaCita: z.string(),
    horaCita: z.string().nullable(),
    estado: z.enum(['programada', 'atendida', 'no_asistio', 'cancelada']),
    observaciones: z.string().nullable(),
    reemplazaA: uuid.nullable(),
    creadaEn: fechaHora,
  })
  .openapi('DerivacionLocal');

const resultadoDerivacion = z
  .object({
    derivacion: derivacionSalida,
    solicitud: z.object({ id: uuid, estado: z.string() }),
  })
  .openapi('DerivacionRegistrada');

const rutaFamilia = z
  .object({
    rutaDecidida: ruta.nullable(),
    siguientePaso: z.string().openapi({
      description:
        'Código que la app traduce: PENDIENTE_DECISION, COORDINANDO_CITA, ASISTIR_A_CITA, ' +
        'REPROGRAMANDO_CITA, ATENDIDO, COMPLETAR_DOCUMENTOS_PAQUETE, PAQUETE_EN_REVISION, ' +
        'ESPERAR_RESPUESTA_SHRINERS, ACEPTADA, BUSCANDO_OTRA_ATENCION',
    }),
    cita: z
      .object({
        fecha: z.string(),
        hora: z.string().nullable(),
        proveedor: z.object({
          nombre: z.string(),
          direccion: z.string().nullable(),
          telefono: z.string().nullable(),
        }),
        especialidad: z.string(),
        estado: z.string(),
      })
      .optional(),
  })
  .openapi('RutaFamilia', { description: 'Lenguaje claro, nunca un diagnóstico' });

const reglaSalida = z
  .object({
    id: uuid,
    version: z.number().int(),
    nombre: z.string(),
    prioridad: z.number().int(),
    condicion: z.record(z.string(), z.unknown()),
    rutaSugerida,
    motivoEs: z.string(),
    motivoEn: z.string(),
    activa: z.boolean(),
  })
  .openapi('ReglaRuta');

const listaReglas = z
  .object({
    versiones: z.array(
      z.object({
        version: z.number().int(),
        activa: z.boolean(),
        reglas: z.number().int(),
        usada: z
          .boolean()
          .openapi({ description: 'Ya hay evaluaciones con esta versión: no se edita' }),
      }),
    ),
    version: z.number().int().nullable(),
    hechosDisponibles: z.array(z.string()),
    reglas: z.array(reglaSalida),
  })
  .openapi('ReglasRuta');

module.exports = {
  entrada: {
    paramsId,
    paramsVersion,
    evaluacion,
    reabrir,
    derivacion,
    cambiarDerivacion,
    filtrosProveedores,
    filtrosProveedoresAdmin,
    proveedor,
    cambiarProveedor,
    regla,
    cambiarRegla,
    filtrosReglas,
  },
  salida: {
    sugerencia,
    evaluacion: evaluacionSalida,
    resultadoEvaluacion,
    proveedor: proveedorSalida,
    derivacion: derivacionSalida,
    resultadoDerivacion,
    rutaFamilia,
    regla: reglaSalida,
    listaReglas,
  },
};
