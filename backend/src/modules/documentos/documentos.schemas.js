'use strict';

// Esquemas Zod del módulo documentos (entrada y salida; también documentan OpenAPI).

const { z } = require('../../openapi/zod');
const { CODIGOS_SECCIONES_JSON } = require('../../core/expediente');
const {
  LISTA_ESTADOS_DOCUMENTO,
  LISTA_ESTADOS_SOLICITUD,
} = require('../../core/estados/constantes');

/** Máximo de páginas de un documento (12 documentos de 1 a 5 páginas, con margen). */
const MAX_PAGINAS = 50;

const MOTIVOS_NUEVA_CAPTURA = Object.freeze([
  'imagen_borrosa',
  'pagina_incompleta',
  'texto_ilegible',
  'documento_incorrecto',
]);
const MOTIVOS_RECHAZO = Object.freeze([...MOTIVOS_NUEVA_CAPTURA, 'no_cumple_requisito', 'otro']);
const MOTIVOS_SECCION = Object.freeze(['dato_incompleto', 'dato_incorrecto', 'otro']);

const uuid = z.uuid();
const fechaHora = z.string().openapi({ format: 'date-time' });
const estadoDocumento = z.enum(LISTA_ESTADOS_DOCUMENTO);
const observaciones = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .optional()
  .openapi({ description: 'Texto para la familia' });

// --- Entrada

const paramsId = z.object({ id: uuid });
const paramsPagina = z.object({ id: uuid, pid: uuid });

const crearDocumento = z
  .strictObject({
    id: uuid.optional().openapi({
      description:
        'UUID generado por el teléfono: un reintento sin conexión no duplica el documento',
    }),
    tipoDocumentoId: uuid,
    origen: z
      .enum(['app', 'jornada'])
      .optional()
      .openapi({ description: '`jornada` solo para el voluntario asignado o el coordinador' }),
  })
  .openapi('DocumentoNuevo');

const pagina = z
  .strictObject({
    orden: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGINAS)
      .optional()
      .openapi({ description: 'Posición donde se inserta. Sin ella, va al final' }),
  })
  .openapi('PaginaNueva');

const ordenPaginas = z
  .strictObject({ paginas: z.array(uuid).min(1).max(MAX_PAGINAS) })
  .openapi('PaginasOrden', {
    description: 'Todos los ids de página del documento, en el orden nuevo',
  });

const finalizar = z
  .strictObject({ paginasDeclaradas: z.number().int().min(1).max(MAX_PAGINAS) })
  .openapi('DocumentoFinalizar', {
    description: 'Total de hojas que la familia dice tener. Debe coincidir con las páginas subidas',
  });

const rechazar = z
  .strictObject({ motivo: z.enum(MOTIVOS_RECHAZO), observaciones })
  .openapi('DocumentoRechazo');

const nuevaCaptura = z
  .strictObject({ motivo: z.enum(MOTIVOS_NUEVA_CAPTURA), observaciones })
  .openapi('NuevaCaptura');

const correccionSeccion = z
  .strictObject({
    seccion: z.enum(CODIGOS_SECCIONES_JSON),
    motivo: z.enum(MOTIVOS_SECCION),
    observaciones,
  })
  .openapi('CorreccionSeccion');

const listarCorrecciones = z.object({
  estado: z.enum(['abierta', 'resuelta', 'anulada']).optional(),
});

const cabeceraIdempotencia = z.object({
  'idempotency-key': z.uuid().openapi({ description: 'UUID generado por la app' }),
});

// --- Salida

const paginaSalida = z
  .object({
    id: uuid,
    orden: z.number().int(),
    archivoId: uuid,
    mime: z.string(),
    ancho: z.number().int().nullable(),
    alto: z.number().int().nullable(),
  })
  .openapi('PaginaDocumento');

const extraccion = z
  .object({ id: uuid, estado: z.string(), progreso: z.number().int() })
  .nullable()
  .openapi('ExtraccionResumen');

const tipoResumen = z.object({ id: uuid, codigo: z.string(), nombre: z.string() });

const documento = z
  .object({
    id: uuid,
    solicitudId: uuid,
    tipoDocumento: tipoResumen,
    version: z.number().int(),
    vigente: z.boolean(),
    reemplazaA: uuid.nullable(),
    estado: estadoDocumento,
    origen: z.enum(['app', 'jornada']),
    paginasDeclaradas: z.number().int().nullable(),
    capturadoEn: fechaHora.nullable(),
    validadoEn: fechaHora.nullable(),
    motivoRechazo: z.string().nullable(),
    paginas: z.array(paginaSalida),
    extraccion,
    creadoEn: fechaHora,
  })
  .openapi('Documento');

const documentoCreado = documento
  .extend({
    paciente: z
      .object({ nombreCompleto: z.string(), fotoArchivoId: uuid.nullable() })
      .openapi({ description: 'Para confirmar que las hojas son del niño correcto (37)' }),
  })
  .openapi('DocumentoCreado');

const documentoDetalle = documento
  .extend({
    versionAnterior: z
      .object({
        id: uuid,
        version: z.number().int(),
        estado: estadoDocumento,
        motivoRechazo: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi('DocumentoDetalle');

const tipoDocumento = z
  .object({
    id: uuid,
    codigo: z.string(),
    nombre: z.string(),
    categoria: z.string(),
    paraQueSirve: z.string().nullable(),
    comoFotografiar: z.string().nullable(),
    admiteVariasPaginas: z.boolean(),
    paginasEsperadas: z.number().int().nullable(),
  })
  .openapi('TipoDocumento');

const correccion = z
  .object({
    id: uuid,
    tipo: z.enum(['documento', 'seccion']),
    documentoId: uuid.nullable(),
    tipoDocumento: tipoResumen.nullable(),
    seccion: z.string().nullable(),
    motivo: z.string(),
    observaciones: z.string().nullable(),
    estado: z.enum(['abierta', 'resuelta', 'anulada']),
    creadaEn: fechaHora,
    resueltaEn: fechaHora.nullable(),
    resueltaConDocumentoId: uuid.nullable(),
  })
  .openapi('Correccion');

const requisito = z
  .object({
    requisitoId: uuid,
    ruta: z.string(),
    tipoDocumento: tipoDocumento,
    obligatorio: z.boolean(),
    orden: z.number().int(),
    cubiertoPorFormulario: z.boolean(),
    cumplido: z.boolean(),
    estado: estadoDocumento,
    documento: z
      .object({
        id: uuid,
        estado: estadoDocumento,
        version: z.number().int(),
        paginas: z.array(paginaSalida),
        extraccion,
      })
      .nullable(),
    correccion: correccion.nullable(),
  })
  .openapi('RequisitoDocumento');

const listaRequisitos = z
  .object({
    solicitudId: uuid,
    etapa: z.enum(['evaluacion', 'paquete']),
    rutas: z.array(z.string()),
    requisitos: z.array(requisito),
  })
  .openapi('DocumentosRequeridos');

const resultadoCorreccion = z
  .object({
    correccion,
    documento: documento.nullable(),
    solicitud: z.object({ id: uuid, estado: z.enum(LISTA_ESTADOS_SOLICITUD) }),
  })
  .openapi('CorreccionCreada');

const urlFirmada = z
  .object({ url: z.string(), expiraEn: fechaHora })
  .openapi('UrlFirmada', { description: 'URL de lectura firmada. Vence en 5 minutos' });

module.exports = {
  MAX_PAGINAS,
  MOTIVOS_NUEVA_CAPTURA,
  MOTIVOS_RECHAZO,
  MOTIVOS_SECCION,
  entrada: {
    paramsId,
    paramsPagina,
    crearDocumento,
    pagina,
    ordenPaginas,
    finalizar,
    rechazar,
    nuevaCaptura,
    correccionSeccion,
    listarCorrecciones,
    cabeceraIdempotencia,
  },
  salida: {
    documento,
    documentoCreado,
    documentoDetalle,
    paginaSalida,
    tipoDocumento,
    correccion,
    listaRequisitos,
    resultadoCorreccion,
    urlFirmada,
  },
};
