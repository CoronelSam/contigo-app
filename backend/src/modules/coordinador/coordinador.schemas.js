'use strict';

// Esquemas Zod del módulo coordinador (entrada y salida; también documentan OpenAPI).

const { z } = require('../../openapi/zod');
const { esquemaPaginacion } = require('../../core/http/paginar');
const { LISTA_ESTADOS_SOLICITUD } = require('../../core/estados/constantes');

const uuid = z.uuid();
const fechaHora = z.string().openapi({ format: 'date-time' });
const estado = z.enum(LISTA_ESTADOS_SOLICITUD);
const persona = z.object({ id: uuid, nombre: z.string() });

// --- Entrada

const paramsId = z.object({ id: uuid });

const booleanoQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const tablero = esquemaPaginacion
  .extend({
    q: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .optional()
      .openapi({ description: 'Nombre del niño (sin acentos) o código del caso' }),
    estado: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((e) => e.trim()) : undefined))
      .pipe(z.array(estado).min(1).optional())
      .openapi({
        type: 'string',
        description:
          'Uno o varios estados separados por coma. Sin él, todos salvo los de la configuración ' +
          '`tablero.estados_ocultos` (por defecto BORRADOR, ACEPTADA y ATENDIDA_HN)',
      }),
    destino: z.enum(['HONDURAS', 'MEXICO', 'INTERNACIONAL', 'sin_decidir']).optional(),
    etapa: z.enum(['evaluacion', 'paquete']).optional(),
    mios: booleanoQuery.openapi({ type: 'string', description: 'Solo los casos a mi cargo' }),
  })
  .openapi('FiltrosTablero');

const actividad = esquemaPaginacion;

const bitacora = esquemaPaginacion.extend({
  incluirAccesos: booleanoQuery.openapi({ type: 'string' }),
});

const confirmar = z
  .strictObject({ nota: z.string().trim().min(1).max(1000).optional() })
  .openapi('ConfirmarCompleto');

// --- Salida

const fila = z
  .object({
    id: uuid,
    codigo: z.string(),
    paciente: z.object({
      nombreCompleto: z.string(),
      edad: z.object({ anios: z.number().int(), meses: z.number().int() }),
      departamento: z.object({ codigo: z.string(), nombre: z.string() }).nullable(),
    }),
    estado,
    etapa: z.enum(['evaluacion', 'paquete']),
    rutaSugerida: z.string().nullable(),
    rutaDecidida: z.string().nullable(),
    diasEnEstado: z
      .number()
      .int()
      .openapi({ description: 'Solo seguimiento interno, no es un plazo' }),
    faltantesAlEnviar: z.array(
      z.object({ tipo: z.string(), codigo: z.string(), motivo: z.string() }),
    ),
    voluntarios: z.array(persona),
    coordinador: persona.nullable(),
    posibleDuplicado: z.boolean(),
  })
  .openapi('FilaTablero');

const evento = z
  .object({
    id: uuid,
    accion: z.string(),
    descripcion: z.string(),
    solicitudId: uuid.nullable(),
    codigoCaso: z.string().nullable(),
    autor: z.object({ id: uuid, nombre: z.string(), rol: z.string() }).nullable(),
    fecha: fechaHora,
    estadoAnterior: estado.nullable().openapi({ description: 'Solo en los cambios de estado' }),
    estadoNuevo: estado.nullable().openapi({ description: 'Solo en los cambios de estado' }),
    nota: z.string().nullable().openapi({ description: 'Nota del cambio de estado, si la hay' }),
  })
  .openapi('Actividad', {
    description:
      'Los cambios de estado salen del historial de estados; el resto de las acciones, de la bitácora',
  });

const resumen = z
  .object({
    contadores: z.object({
      EN_REVISION: z.number().int(),
      COMPLETA: z.number().int(),
      ENVIADA: z.number().int(),
      INFO_ADICIONAL: z.number().int(),
      EN_EVALUACION: z.number().int(),
      DERIVADA_HN: z.number().int(),
    }),
    actividad: z.array(evento),
  })
  .openapi('ResumenCoordinador');

const entradaBitacora = z
  .object({
    id: uuid,
    accion: z.string(),
    entidad: z.string(),
    entidadId: z.string().nullable(),
    antes: z.unknown().nullable(),
    despues: z.unknown().nullable(),
    autor: z.object({ id: uuid, nombre: z.string(), rol: z.string() }).nullable(),
    fecha: fechaHora,
  })
  .openapi('EntradaBitacora');

const acceso = z
  .object({
    id: uuid,
    usuario: z.object({ id: uuid, nombre: z.string(), rol: z.string() }),
    recurso: z.string(),
    recursoId: uuid.nullable(),
    fecha: fechaHora,
  })
  .openapi('AccesoExpediente');

const paginacion = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
});

const bitacoraCaso = z
  .object({
    datos: z.array(entradaBitacora),
    paginacion,
    accesos: z.object({ datos: z.array(acceso), paginacion }).optional(),
  })
  .openapi('BitacoraCaso');

const valorCatalogo = z.object({ codigo: z.string(), etiqueta: z.string() });

const historiaClinica = z
  .object({
    solicitudId: uuid,
    codigo: z.string(),
    paciente: z.object({
      nombreCompleto: z.string(),
      fechaNacimiento: z.string(),
      edad: z.object({ anios: z.number().int(), meses: z.number().int() }),
      sexo: z.string(),
    }),
    secciones: z.array(
      z.object({
        codigo: z.string(),
        titulo: z.string(),
        estado: z.enum(['vacia', 'incompleta', 'completa']),
        version: z.number().int(),
        idioma: z.string().nullable(),
        origen: z.string().nullable(),
        datos: z.record(z.string(), z.unknown()).openapi({
          description: 'Los valores de catálogo vienen como `{ codigo, etiqueta }`',
        }),
      }),
    ),
    profesional: z.object({
      nombre: z.string().nullable(),
      especialidad: valorCatalogo.nullable(),
      telefono: z.string().nullable(),
      correo: z.string().nullable(),
      documentoCertificacionId: uuid.nullable(),
      estado: z.string(),
    }),
    consentimientos: z.array(
      z.object({
        tipo: z.string(),
        decision: z.string().nullable(),
        textoVersion: z.number().int().nullable(),
        textoIdioma: z.string().nullable(),
        decididoEn: fechaHora.nullable(),
        estadoFirma: z.string().nullable(),
        firmaPendiente: z.boolean(),
      }),
    ),
  })
  .openapi('HistoriaClinica');

const bloque = z
  .object({
    tipo: z.enum(['seccion', 'documento', 'profesional', 'consentimiento']),
    codigo: z.string(),
    titulo: z.string(),
    obligatorio: z.boolean(),
    estado: z.string(),
    motivo: z.string().nullable().openapi({ description: 'Por qué falta, si falta' }),
    documentoId: uuid.nullable(),
    acciones: z.array(z.string()).openapi({
      description:
        'Acciones disponibles en la app: `validar_documento`, `rechazar_documento`, ' +
        '`pedir_nueva_captura` (agente 06) o `solicitar_correccion_seccion`',
    }),
  })
  .openapi('BloqueValidacion');

const validacion = z
  .object({
    solicitudId: uuid,
    estado,
    etapa: z.enum(['evaluacion', 'paquete']),
    bloques: z.array(bloque),
    faltantes: z.array(z.object({ tipo: z.string(), codigo: z.string(), motivo: z.string() })),
    listoParaConfirmar: z.boolean(),
    puedeConfirmar: z.boolean().openapi({ description: 'En EN_REVISION y sin faltantes' }),
    destinoAlConfirmar: estado.nullable(),
  })
  .openapi('Validacion');

const confirmado = z
  .object({
    id: uuid,
    codigo: z.string(),
    estado,
    etapa: z.enum(['evaluacion', 'paquete']),
    coordinadorId: uuid.nullable(),
    ultimoCambioEstado: fechaHora,
  })
  .openapi('ExpedienteConfirmado');

module.exports = {
  entrada: { paramsId, tablero, actividad, bitacora, confirmar },
  salida: { fila, evento, resumen, bitacoraCaso, historiaClinica, validacion, confirmado },
};
