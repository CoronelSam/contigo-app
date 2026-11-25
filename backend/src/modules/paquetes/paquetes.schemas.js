'use strict';

// Esquemas Zod del módulo paquetes (entrada y salida; también documentan OpenAPI).

const { z } = require('../../openapi/zod');
const { LISTA_PAQUETES, LISTA_ESTADOS_SOLICITUD } = require('../../core/estados/constantes');
const { esquemaZonasOcr } = require('../ocr/contratos');
const { esquemaMapaCampos } = require('./mapa');

const uuid = z.uuid();
const fechaHora = z.string().openapi({ format: 'date-time' });
const fecha = z.iso.date().openapi({ example: '2026-12-01' });
const texto = (min, max) => z.string().trim().min(min).max(max);
const paquete = z.enum(LISTA_PAQUETES);
const METODOS_ENVIO = ['correo', 'mensajeria', 'portal', 'entrega_personal', 'otro'];
const RESULTADOS = ['informacion_adicional', 'aceptada', 'denegada'];

/** Campo multipart con JSON: se parsea y se valida con `esquema`. */
const json = (esquema) =>
  z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s);
      } catch {
        ctx.addIssue({ code: 'custom', params: { codigo: 'JSON_INVALIDO' } });
        return z.NEVER;
      }
    })
    .pipe(esquema);

// --- Entrada

const paramsId = z.object({ id: uuid });
const paramsPagina = z.object({
  id: uuid,
  n: z.coerce.number().int().min(1).max(100000).openapi({ description: 'Página, desde 1' }),
});

const generar = z
  .strictObject({
    tipo: z.enum(['borrador', 'final']).openapi({
      description: '`borrador` para revisar; `final` exige la solicitud COMPLETA y sin faltantes',
    }),
  })
  .openapi('PaqueteGenerar');

const enlace = z
  .strictObject({
    confirmoRevision: z
      .boolean()
      .refine((v) => v === true, { params: { codigo: 'DEBE_CONFIRMAR' } })
      .openapi({ description: 'Debe ser `true`: el coordinador revisó el paquete completo' }),
  })
  .openapi('PaqueteEnlace');

const envio = z
  .strictObject({
    paqueteId: uuid,
    destino: paquete.openapi({ description: 'Debe ser el paquete de la solicitud' }),
    fecha: fecha.openapi({ description: 'No puede ser futura' }),
    metodo: z.enum(METODOS_ENVIO).openapi({
      description: 'Medio de envío (el definitivo es una decisión pendiente de la organización)',
    }),
    guia: texto(1, 200).nullable().optional(),
    observaciones: texto(1, 2000).nullable().optional(),
  })
  .openapi('EnvioNuevo');

const respuesta = z
  .strictObject({
    fecha: fecha.openapi({ description: 'No puede ser futura' }),
    resultado: z.enum(RESULTADOS),
    observaciones: texto(1, 2000).nullable().optional(),
  })
  .openapi('RespuestaShrinersNueva');

const codigoPlantilla = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,59}$/)
  .openapi({ example: 'solicitud_internacional' });

/** Campos de texto del multipart de `POST /admin/plantillas` (el PDF va en `archivo`). */
const plantilla = z.strictObject({
  codigo: codigoPlantilla,
  nombre: texto(2, 200),
  version: z.coerce.number().int().min(1).max(10000),
  paquete,
  metodo: z.enum(['campo', 'coordenadas']),
  mapaCampos: json(esquemaMapaCampos),
  zonasOcr: json(esquemaZonasOcr).optional(),
  orden: z.coerce.number().int().min(0).max(1000).default(0),
});

/** Solo para documentar el multipart en OpenAPI. */
const plantillaMultipart = z.object({
  archivo: z.string().openapi({ type: 'string', format: 'binary', description: 'PDF oficial' }),
  codigo: codigoPlantilla,
  nombre: z.string(),
  version: z.number().int().min(1),
  paquete,
  metodo: z.enum(['campo', 'coordenadas']),
  mapaCampos: z.string().openapi({ description: 'JSON con el formato de `MapaCampos`' }),
  zonasOcr: z.string().optional().openapi({ description: 'JSON con el formato de `ZonasOcr`' }),
  orden: z.number().int().min(0).optional(),
});

const cambiarPlantilla = z
  .strictObject({
    activa: z.boolean().optional().openapi({
      description: 'Activar una versión desactiva las demás versiones del mismo código',
    }),
    orden: z.number().int().min(0).max(1000).optional(),
    nombre: texto(2, 200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    params: { codigo: 'SIN_CAMBIOS' },
    path: [],
  })
  .openapi('PlantillaCambio');

const filtrosPlantillas = z.object({
  paquete: paquete.optional(),
  codigo: codigoPlantilla.optional(),
  activa: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// --- Salida

const usuarioBreve = z.object({ id: uuid, nombre: z.string().nullable() }).nullable();

const aviso = z
  .object({
    tipo: z.enum([
      'firma_pendiente',
      'campo_omitido_por_consentimiento',
      'anexo_omitido_por_consentimiento',
      'anexo_faltante',
      'campo_recortado',
    ]),
    plantilla: z.string().optional(),
    campo: z.string().optional(),
    documento: z.string().optional(),
    consentimiento: z.string().optional(),
  })
  .openapi('PaqueteAviso');

const paqueteSalida = z
  .object({
    id: uuid,
    solicitudId: uuid,
    paquete,
    tipo: z.enum(['borrador', 'final']),
    estado: z.enum(['en_cola', 'generando', 'listo', 'fallido']),
    progreso: z.number().int(),
    numeroPaginas: z.number().int().nullable(),
    plantillas: z.array(
      z.object({
        id: uuid,
        codigo: z.string(),
        nombre: z.string().nullable(),
        version: z.number().int(),
        paginas: z.number().int(),
      }),
    ),
    anexos: z.array(
      z.object({
        documentoId: uuid,
        codigo: z.string(),
        version: z.number().int().nullable(),
        paginas: z.number().int(),
      }),
    ),
    avisos: z.array(aviso),
    error: z.string().nullable().openapi({ description: 'Código del error si `fallido`' }),
    generadoPor: usuarioBreve,
    revision: z
      .object({ revisadoPor: usuarioBreve, revisadoEn: fechaHora })
      .nullable()
      .openapi({ description: 'Quién confirmó la revisión al pedir el enlace' }),
    creadoEn: fechaHora,
  })
  .openapi('PaquetePdf');

const paqueteEnCola = z
  .object({
    id: uuid,
    solicitudId: uuid,
    paquete,
    tipo: z.enum(['borrador', 'final']),
    estado: z.literal('en_cola'),
  })
  .openapi('PaqueteEnCola');

const urlFirmada = z.object({ url: z.string(), expiraEn: fechaHora });

const pagina = z
  .object({ pagina: z.number().int(), numeroPaginas: z.number().int(), ...urlFirmada.shape })
  .openapi('PaquetePagina');

const enlaceSalida = z
  .object({
    ...urlFirmada.shape,
    revision: z.object({ revisadoPor: usuarioBreve, revisadoEn: fechaHora }),
  })
  .openapi('PaqueteEnlaceFirmado');

const solicitudBreve = z.object({
  id: uuid,
  codigo: z.string(),
  estado: z.enum(LISTA_ESTADOS_SOLICITUD),
  etapa: z.string().nullable(),
});

const envioSalida = z
  .object({
    id: uuid,
    solicitudId: uuid,
    paqueteId: uuid,
    destino: paquete,
    fecha,
    metodo: z.enum(METODOS_ENVIO),
    guia: z.string().nullable(),
    observaciones: z.string().nullable(),
    registradoPor: usuarioBreve,
    creadoEn: fechaHora,
  })
  .openapi('Envio');

const respuestaSalida = z
  .object({
    id: uuid,
    solicitudId: uuid,
    envioId: uuid.nullable(),
    fecha,
    resultado: z.enum(RESULTADOS),
    observaciones: z.string().nullable(),
    registradoPor: usuarioBreve,
    creadoEn: fechaHora,
  })
  .openapi('RespuestaShriners');

const plantillaSalida = z
  .object({
    id: uuid,
    codigo: z.string(),
    nombre: z.string(),
    version: z.number().int(),
    paquete: paquete.nullable(),
    metodo: z.enum(['campo', 'coordenadas']),
    archivoPdfId: uuid,
    numeroCampos: z.number().int(),
    mapaCampos: esquemaMapaCampos,
    zonasOcr: z.array(z.record(z.string(), z.unknown())),
    orden: z.number().int(),
    activa: z.boolean(),
    creadoEn: fechaHora,
    actualizadoEn: fechaHora,
  })
  .openapi('PlantillaFormulario');

module.exports = {
  METODOS_ENVIO,
  RESULTADOS,
  entrada: {
    paramsId,
    paramsPagina,
    generar,
    enlace,
    envio,
    respuesta,
    plantilla,
    plantillaMultipart,
    cambiarPlantilla,
    filtrosPlantillas,
  },
  salida: {
    paqueteSalida,
    paqueteEnCola,
    pagina,
    enlaceSalida,
    envioRegistrado: z
      .object({ solicitud: solicitudBreve, envio: envioSalida })
      .openapi('EnvioRegistrado'),
    respuestaRegistrada: z
      .object({
        solicitud: solicitudBreve,
        respuesta: respuestaSalida,
        acciones: z.array(z.enum(['reabrir_evaluacion'])).openapi({
          description: 'Con `denegada`: buscar atención en Honduras reabriendo la evaluación',
        }),
      })
      .openapi('RespuestaRegistrada'),
    plantillaSalida,
  },
};
