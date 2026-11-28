'use strict';

// Esquemas Zod del módulo comunicacion (entrada y salida; también documentan OpenAPI).

const { z } = require('../../openapi/zod');
const { respuestaPaginadaDe } = require('../../openapi/registro');
const { esquemaPaginacion } = require('../../core/http/paginar');
const { TIPOS, CATEGORIAS } = require('../../core/notificaciones');
const { MAX_CUERPO } = require('./chat');

const uuid = z.uuid();
const fechaHora = z.string().openapi({ format: 'date-time' });

// --- Entrada

const paramsId = z.object({ id: uuid });

const filtrosMensajes = z.object({
  antesDe: uuid.optional().openapi({
    description: 'Id del último mensaje recibido: devuelve los anteriores (cursor)',
  }),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const mensaje = z
  .strictObject({
    cuerpo: z
      .string()
      .trim()
      .max(MAX_CUERPO)
      .optional()
      .openapi({ description: `De 1 a ${MAX_CUERPO} caracteres; opcional si hay adjunto` }),
  })
  .openapi('MensajeNuevo');

const mensajeMultipart = z.object({
  cuerpo: z.string().max(MAX_CUERPO).optional(),
  archivo: z.string().optional().openapi({
    type: 'string',
    format: 'binary',
    description: 'Imagen JPEG, PNG o WebP, o PDF (mismos límites que los documentos)',
  }),
});

const cabeceraIdempotencia = z.object({
  'idempotency-key': uuid.optional().openapi({
    description: 'Recomendado: un reintento con la misma clave y el mismo cuerpo no duplica',
  }),
});

const leidos = z
  .strictObject({
    hastaId: uuid.openapi({ description: 'Último mensaje leído (incluido)' }),
  })
  .openapi('MensajesLeidos');

const filtrosNotificaciones = esquemaPaginacion.extend({
  estado: z.enum(['todas', 'no_leidas', 'leidas']).default('todas'),
});

// --- Salida

const autor = z
  .object({
    tipo: z.enum(['familia', 'equipo']),
    id: uuid.nullable().optional(),
    nombre: z.string().nullable().optional(),
    etiqueta: z.string().optional().openapi({
      description: 'Ante la familia, el personal aparece solo con esta etiqueta, sin nombre',
    }),
  })
  .openapi('MensajeAutor');

const mensajeSalida = z
  .object({
    id: uuid,
    autor,
    cuerpo: z.string().nullable(),
    archivo: z
      .object({ id: uuid, mime: z.string() })
      .nullable()
      .openapi({ description: 'Se abre con `GET /archivos/{id}/url`' }),
    creadoEn: fechaHora,
    leidoEn: fechaHora.nullable(),
    esMio: z.boolean(),
  })
  .openapi('Mensaje');

const listaMensajes = z
  .object({
    datos: z.array(mensajeSalida),
    siguiente: uuid
      .nullable()
      .openapi({ description: 'Cursor para `antesDe`, o null si no hay más' }),
    noLeidos: z.number().int().openapi({ description: 'Mensajes de la otra parte sin leer' }),
  })
  .openapi('Mensajes');

const leidosSalida = z
  .object({ marcados: z.number().int(), noLeidos: z.number().int() })
  .openapi('MensajesLeidosResultado');

const notificacion = z
  .object({
    id: uuid,
    tipo: z.enum(TIPOS),
    categoria: z.enum(Object.values(CATEGORIAS)).nullable(),
    titulo: z.string(),
    cuerpo: z.string(),
    enlace: z.string().nullable().openapi({ description: 'Pantalla de la app que corresponde' }),
    solicitudId: uuid.nullable(),
    leidaEn: fechaHora.nullable(),
    creadaEn: fechaHora,
  })
  .openapi('Notificacion');

const bandeja = respuestaPaginadaDe(notificacion)
  .extend({ noLeidas: z.number().int() })
  .openapi('BandejaNotificaciones');

module.exports = {
  entrada: {
    paramsId,
    filtrosMensajes,
    mensaje,
    mensajeMultipart,
    cabeceraIdempotencia,
    leidos,
    filtrosNotificaciones,
  },
  salida: {
    mensajeSalida,
    listaMensajes,
    leidosSalida,
    notificacion,
    bandeja,
    notificacionLeida: z
      .object({ notificacion, noLeidas: z.number().int() })
      .openapi('NotificacionLeida'),
    leerTodas: z
      .object({ marcadas: z.number().int(), noLeidas: z.number().int() })
      .openapi('NotificacionesLeidas'),
  },
};
