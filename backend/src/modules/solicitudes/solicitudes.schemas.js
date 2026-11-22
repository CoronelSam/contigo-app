'use strict';

// Esquemas Zod del módulo solicitudes (entrada y salida; también documentan OpenAPI).
// Los datos de cada sección se validan con Ajv (esquemas/v1/*.json), no aquí.

const { z } = require('../../openapi/zod');
const { normalizarTelefono } = require('../auth/auth.schemas');
const { TIPOS_CONSENTIMIENTO } = require('../../core/expediente');
const { LISTA_ESTADOS_SOLICITUD } = require('../../core/estados/constantes');

const uuid = z.uuid();
const idioma = z.enum(['es', 'en']);
const estadoSeccion = z.enum(['vacia', 'incompleta', 'completa']);
const estadoSolicitud = z.enum(LISTA_ESTADOS_SOLICITUD);
const tipoConsentimiento = z.enum(TIPOS_CONSENTIMIENTO);
const fechaHora = z.string().openapi({ format: 'date-time' });

const textoOpcional = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((v) => v.replace(/\s+/g, ' '))
    .nullable()
    .optional();

/** Teléfono del profesional: Honduras se normaliza a +504; otros países con su prefijo. */
const telefono = z
  .string()
  .trim()
  .transform(normalizarTelefono)
  .refine((v) => /^\+\d{8,15}$/.test(v), { params: { codigo: 'TELEFONO_INVALIDO' } })
  .openapi({ example: '+50422220000' });
const correo = z.string().trim().toLowerCase().max(254).pipe(z.email());

const sinCambios = (v) => Object.keys(v).length > 0;
const reglaSinCambios = {
  params: { codigo: 'SIN_CAMBIOS' },
  when: (p) => p.issues.length === 0,
};

// --- Entrada

const paramsSolicitud = z.object({ id: uuid });
const paramsSeccion = z.object({
  id: uuid,
  seccion: z
    .string()
    .regex(/^[a-z_]{2,40}$/)
    .openapi({ example: 'informacion_medica' }),
});
const paramsTexto = z.object({ id: uuid });
const paramsConsentimiento = z.object({ id: uuid, tipo: tipoConsentimiento });

const crearSolicitud = z.strictObject({ pacienteId: uuid }).openapi('SolicitudNueva');

const modalidad = z
  .strictObject({ modalidad: z.enum(['app', 'fotos']) })
  .openapi('SolicitudModalidad', {
    description: '`app`: llenar en la aplicación. `fotos`: fotografiar formularios llenos.',
  });

const guardarSeccion = z
  .strictObject({
    datos: z.record(z.string(), z.unknown()).openapi({
      description:
        'Datos de la sección según su JSON Schema v1. Se aceptan incompletos (borrador); el ' +
        'servidor rechaza tipos, catálogos o respuestas contradictorias.',
    }),
    idioma: idioma.optional().openapi({ description: 'Por defecto, el idioma del usuario' }),
  })
  .openapi('SeccionGuardar');

const cabeceraIfMatch = z.object({
  'if-match': z.string().optional().openapi({
    description: 'ETag de la sección (`"v3"`). Obligatorio cuando la versión es mayor que 0',
    example: '"v3"',
  }),
});

const cabeceraIdempotencia = z.object({
  'idempotency-key': z.uuid().openapi({ description: 'UUID generado por la app' }),
});

const profesional = z
  .strictObject({
    nombre: textoOpcional(200),
    especialidad: z
      .string()
      .regex(/^[a-z_]{2,60}$/)
      .nullable()
      .optional()
      .openapi({ description: 'Código del catálogo `especialidad_medica`' }),
    telefono: telefono.nullable().optional(),
    correo: correo.nullable().optional(),
    documentoCertificacionId: uuid.nullable().optional().openapi({
      description: 'Documento de esta solicitud del tipo `certificacion_medica`',
    }),
  })
  .refine(sinCambios, reglaSinCambios)
  .openapi('ProfesionalSaludCambios', {
    description: 'Un campo que no se envía no cambia; `null` lo borra.',
  });

const queryTextos = z.object({ idioma: idioma.optional() });
const abrirTexto = z.strictObject({ solicitudId: uuid }).openapi('ConsentimientoApertura');

const decidirConsentimiento = z
  .strictObject({
    decision: z.enum(['acepta', 'no_acepta']),
    textoId: uuid,
    documentoFirmadoId: uuid.nullable().optional().openapi({
      description: 'Hoja firmada (documento de esta solicitud del tipo firmado que corresponde)',
    }),
  })
  .openapi('ConsentimientoDecision');

// --- Salida

const accion = z.object({ accion: z.string(), a: estadoSolicitud }).openapi('AccionSolicitud');

const solicitud = z
  .object({
    id: uuid,
    codigo: z.string().openapi({ example: 'HN-0258' }),
    pacienteId: uuid,
    estado: estadoSolicitud,
    etapa: z.enum(['evaluacion', 'paquete']),
    modalidad: z.enum(['app', 'fotos']).nullable(),
    creadaEn: fechaHora,
    enviadaEn: fechaHora.nullable(),
    ultimoCambioEstado: fechaHora,
    acciones: z.array(accion),
  })
  .openapi('Solicitud');

const faltante = z
  .object({
    tipo: z.enum(['seccion', 'documento', 'profesional', 'consentimiento']),
    codigo: z.string(),
    motivo: z.enum([
      'falta',
      'incompleta',
      'rechazado',
      'sin_validar',
      'ocr_sin_revisar',
      'firma_pendiente',
    ]),
  })
  .openapi('Faltante');

const seccion = z
  .object({
    seccion: z.string(),
    datos: z.record(z.string(), z.unknown()),
    estado: estadoSeccion,
    version: z.number().int(),
    idioma,
    origen: z.enum(['app', 'ocr', 'mixto']).nullable(),
    versionPlantilla: z.string().openapi({ example: 'v1' }),
    pendientes: z.array(z.string()).openapi({
      description: 'Campos obligatorios que faltan para que la sección quede completa',
    }),
    actualizadaEn: fechaHora.nullable(),
  })
  .openapi('Seccion');

const profesionalSalida = z
  .object({
    nombre: z.string().nullable(),
    especialidad: z.string().nullable(),
    telefono: z.string().nullable(),
    correo: z.string().nullable(),
    documentoCertificacionId: uuid.nullable(),
    estado: estadoSeccion,
    obligatorio: z.boolean(),
  })
  .openapi('ProfesionalSalud');

const consentimiento = z
  .object({
    tipo: tipoConsentimiento,
    decision: z.enum(['acepta', 'no_acepta']).nullable(),
    textoId: uuid.nullable(),
    textoVersion: z.number().int().nullable(),
    textoIdioma: idioma.nullable(),
    textoAbiertoEn: fechaHora.nullable(),
    decididoEn: fechaHora.nullable(),
    estadoFirma: z.enum(['pendiente', 'firmado', 'no_aplica']).nullable(),
    firmaPendiente: z.boolean(),
    documentoFirmadoId: uuid.nullable(),
  })
  .openapi('Consentimiento');

const documentoRequerido = z
  .object({
    codigo: z.string(),
    nombre: z.string(),
    ruta: z.string(),
    obligatorio: z.boolean(),
    orden: z.number().int(),
    estado: z.enum(['FALTA', 'CAPTURADO', 'VALIDADO', 'RECHAZADO']),
    documentoId: uuid.nullable(),
    version: z.number().int().nullable(),
    cubiertoPorFormulario: z.boolean(),
    cumplido: z.boolean(),
    extraccion: z
      .object({ id: uuid, estado: z.string(), progreso: z.number().nullable() })
      .nullable(),
  })
  .openapi('DocumentoRequerido');

const resumen = solicitud
  .extend({
    paciente: z.object({
      id: uuid,
      nombreCompleto: z.string(),
      fechaNacimiento: z.string(),
      sexo: z.string(),
    }),
    secciones: z.array(
      z.object({
        codigo: z.string(),
        orden: z.number().int(),
        titulo: z.string(),
        estado: estadoSeccion,
        obligatoria: z.boolean(),
        version: z.number().int().nullable(),
      }),
    ),
    documentos: z.array(documentoRequerido),
    profesional: profesionalSalida,
    consentimientos: z.array(consentimiento),
    faltantes: z.array(faltante),
    faltantesAlEnviar: z.array(faltante),
    rutaDecidida: z.enum(['HONDURAS', 'MEXICO', 'INTERNACIONAL']).nullable(),
    paquete: z.enum(['MEXICO', 'INTERNACIONAL']).nullable(),
    rutaSugerida: z
      .string()
      .nullable()
      .optional()
      .openapi({ description: 'Solo voluntario y coordinador' }),
    listoParaConfirmar: z
      .boolean()
      .optional()
      .openapi({ description: 'Solo voluntario y coordinador' }),
  })
  .openapi('SolicitudResumen');

const envio = z.object({ solicitud, faltantes: z.array(faltante) }).openapi('SolicitudEnviada', {
  description:
    'La solicitud pasó a revisión del equipo Vanguardia. No es una aceptación médica ni una ' +
    'recepción hospitalaria. `faltantes` es lo que faltaba al enviar.',
});

const texto = z
  .object({
    id: uuid,
    tipo: tipoConsentimiento,
    version: z.number().int(),
    idioma,
    titulo: z.string(),
    cuerpo: z.string(),
    vigenteDesde: fechaHora,
    obligatorio: z.boolean().openapi({ description: 'Hay que responder (aceptar o no)' }),
    requiereFirma: z.boolean(),
  })
  .openapi('TextoConsentimiento');

const apertura = z
  .object({
    tipo: tipoConsentimiento,
    textoId: uuid,
    textoAbiertoEn: fechaHora,
    decision: z.enum(['acepta', 'no_acepta']).nullable(),
  })
  .openapi('ConsentimientoAbierto');

const paso = z
  .object({
    codigo: z.enum([
      'SOLICITUD_CREADA',
      'CAPTURA',
      'EN_REVISION',
      'EVALUACION_RUTA',
      'SIGUIENTE_PASO_SEGUN_RUTA',
      'DERIVADA_HN',
      'ATENDIDA_HN',
      'PAQUETE_EXTERIOR',
      'COMPLETA',
      'ENVIADA',
      'RESPUESTA',
    ]),
    estado: z.enum(['completado', 'actual', 'pendiente']),
    fecha: fechaHora.nullable().openapi({ description: 'Solo en pasos completados o actuales' }),
    eventos: z.array(z.object({ codigo: z.literal('INFO_ADICIONAL'), fecha: fechaHora })),
    cita: z
      .object({ fecha: z.string(), hora: z.string().nullable() })
      .optional()
      .openapi({ description: 'Solo en DERIVADA_HN: la cita registrada (no es una estimación)' }),
    resultado: z.enum(['ACEPTADA', 'DENEGADA']).optional(),
  })
  .openapi('PasoSeguimiento');

const seguimiento = z
  .object({
    solicitudId: uuid,
    codigo: z.string(),
    estado: estadoSolicitud,
    ruta: z.enum(['HONDURAS', 'EXTERIOR']).nullable(),
    pasos: z.array(paso),
  })
  .openapi('Seguimiento');

module.exports = {
  entrada: {
    paramsSolicitud,
    paramsSeccion,
    paramsTexto,
    paramsConsentimiento,
    crearSolicitud,
    modalidad,
    guardarSeccion,
    cabeceraIfMatch,
    cabeceraIdempotencia,
    profesional,
    queryTextos,
    abrirTexto,
    decidirConsentimiento,
  },
  salida: {
    solicitud,
    resumen,
    seccion,
    profesional: profesionalSalida,
    consentimiento,
    envio,
    texto,
    apertura,
    seguimiento,
  },
};
