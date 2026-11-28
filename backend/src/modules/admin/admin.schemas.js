'use strict';

// Esquemas Zod del módulo admin (entrada y salida; también documentan OpenAPI).
// Ninguna salida lleva datos de niños, de solicitudes individuales ni credenciales.

const { z } = require('../../openapi/zod');
const { respuestaPaginadaDe } = require('../../openapi/registro');
const { esquemaPaginacion } = require('../../core/http/paginar');
const { normalizarTelefono } = require('../auth/auth.schemas');
const { CODIGOS_SECCIONES } = require('../../core/expediente');
const {
  LISTA_ROLES,
  LISTA_RUTAS_REQUISITO,
  LISTA_ESTADOS_SOLICITUD,
  LISTA_PAQUETES,
  ROLES,
} = require('../../core/estados/constantes');
const { TipoDocumento } = require('../../models');
const { LISTA_CLAVES } = require('./configuracion.claves');

const uuid = z.uuid();
const fechaHora = z.string().openapi({ format: 'date-time' });
const texto = (max) => z.string().trim().min(1).max(max);
const textoOpcional = (max) => texto(max).nullable().optional();
const booleanoQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional()
  .openapi({ type: 'string' });
const sinCambios = {
  params: { codigo: 'SIN_CAMBIOS' },
  when: (p) => p.issues.length === 0,
};
const conAlgo = (v) => Object.keys(v).length > 0;

/** Roles que se dan de alta por invitación (el registro público crea familias). */
const ROLES_PERSONAL = Object.freeze([ROLES.VOLUNTARIO, ROLES.COORDINADOR, ROLES.ADMINISTRADOR]);
const ESTADOS_USUARIO = Object.freeze(['invitado', 'activo', 'inactivo']);
const CATEGORIAS = TipoDocumento.VALORES.categoria;

const correo = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email())
  .openapi({ example: 'persona@ejemplo.test' });
const telefono = z
  .string()
  .trim()
  .transform(normalizarTelefono)
  .refine((v) => /^\+504\d{8}$/.test(v), { params: { codigo: 'TELEFONO_INVALIDO' } })
  .openapi({ example: '+50499990000', description: 'Honduras: +504 y 8 dígitos (se normaliza)' });
const codigo = (max) => z.string().regex(new RegExp(`^[a-z][a-z0-9_]{1,${max - 1}}$`));

// --- Entrada

const paramsId = z.object({ id: uuid });
const paramsClave = z.object({
  clave: z
    .string()
    .max(100)
    .openapi({ description: `Una de: ${LISTA_CLAVES.join(', ')}` }),
});

const filtrosUsuarios = esquemaPaginacion.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: 'Busca en nombres, apellidos y correo' }),
  rol: z.enum(LISTA_ROLES).optional(),
  estado: z.enum(ESTADOS_USUARIO).optional(),
});

const invitacion = z
  .strictObject({
    correo,
    nombres: texto(120),
    apellidos: texto(120),
    telefono: telefono.optional(),
    rol: z.enum(ROLES_PERSONAL),
    idioma: z.enum(['es', 'en']).default('es'),
  })
  .openapi('InvitacionPersonal');

const cambiarUsuario = z
  .strictObject({
    nombres: texto(120).optional(),
    apellidos: texto(120).optional(),
    telefono: telefono.nullable().optional(),
    rol: z.enum(LISTA_ROLES).optional(),
    estado: z.enum(['activo', 'inactivo']).optional(),
    motivo: texto(500)
      .optional()
      .openapi({ description: 'Obligatorio al cambiar el rol; queda en la bitácora' }),
    reenviarInvitacion: z
      .literal(true)
      .optional()
      .openapi({ description: 'Emite un enlace nuevo e invalida el anterior' }),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'motivo'), sinCambios)
  .refine((v) => !(v.reenviarInvitacion && v.estado), {
    params: { codigo: 'NO_COMBINABLE' },
    path: ['estado'],
    when: (p) => p.issues.length === 0,
  })
  .openapi('UsuarioCambios');

const filtrosTipos = z.object({
  categoria: z.enum(CATEGORIAS).optional(),
  activo: booleanoQuery,
});

const camposTipo = {
  nombreEs: texto(200),
  nombreEn: texto(200),
  categoria: z.enum(CATEGORIAS),
  paraQueSirveEs: textoOpcional(2000),
  paraQueSirveEn: textoOpcional(2000),
  comoFotografiarEs: textoOpcional(2000),
  comoFotografiarEn: textoOpcional(2000),
  admiteVariasPaginas: z.boolean().optional(),
  paginasEsperadas: z.number().int().min(1).max(200).nullable().optional(),
  plantillaId: uuid.nullable().optional(),
};

const tipoDocumento = z
  .strictObject({ codigo: codigo(60), ...camposTipo })
  .openapi('TipoDocumentoNuevo');

const cambiarTipoDocumento = z
  .strictObject(camposTipo)
  .partial()
  .extend({
    activo: z.boolean().optional().openapi({ description: '`false` lo desactiva; no se borra' }),
  })
  .refine(conAlgo, sinCambios)
  .openapi('TipoDocumentoCambios');

const filtrosRequisitos = z.object({
  ruta: z.enum(LISTA_RUTAS_REQUISITO).optional(),
  tipoDocumentoId: uuid.optional(),
  activo: booleanoQuery,
});

const secciones = z
  .array(z.enum(CODIGOS_SECCIONES))
  .max(CODIGOS_SECCIONES.length)
  .refine((l) => new Set(l).size === l.length, { params: { codigo: 'REPETIDO' } })
  .openapi({
    description: 'Secciones del formulario que, completas en la modalidad app, cubren el documento',
  });

const requisito = z
  .strictObject({
    ruta: z.enum(LISTA_RUTAS_REQUISITO),
    tipoDocumentoId: uuid,
    obligatorio: z.boolean().default(true),
    orden: z.number().int().min(0).max(1000).default(0),
    cubiertoPorSecciones: secciones.default([]),
  })
  .openapi('RequisitoRutaNuevo');

const cambiarRequisito = z
  .strictObject({
    obligatorio: z.boolean().optional(),
    orden: z.number().int().min(0).max(1000).optional(),
    cubiertoPorSecciones: secciones.optional(),
    activo: z.boolean().optional(),
  })
  .refine(conAlgo, sinCambios)
  .openapi('RequisitoRutaCambios');

const filtrosCatalogos = z.object({
  tipo: codigo(40).optional(),
  activo: booleanoQuery,
});

const metadatos = z
  .record(z.string().max(60), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 4000, { params: { codigo: 'MUY_GRANDE' } })
  .openapi({ description: 'Datos extra del ítem (por ejemplo la especialidad de una atención)' });

const catalogoItem = z
  .strictObject({
    tipo: codigo(40).openapi({ description: 'Un catálogo existente' }),
    codigo: codigo(60),
    etiquetaEs: texto(200),
    etiquetaEn: texto(200),
    orden: z.number().int().min(0).max(10000).default(0),
    metadatos: metadatos.default({}),
  })
  .openapi('CatalogoItemNuevo');

const cambiarCatalogoItem = z
  .strictObject({
    etiquetaEs: texto(200).optional(),
    etiquetaEn: texto(200).optional(),
    orden: z.number().int().min(0).max(10000).optional(),
    metadatos: metadatos.optional(),
    activo: z.boolean().optional(),
  })
  .refine(conAlgo, sinCambios)
  .openapi('CatalogoItemCambios');

const cambiarConfiguracion = z
  .strictObject({
    valor: z.unknown().openapi({ description: 'Valor nuevo; cada clave tiene su propio esquema' }),
  })
  .refine((v) => v.valor !== undefined, { params: { codigo: 'REQUERIDO' }, path: ['valor'] })
  .openapi('ConfiguracionCambio');

const fecha = z.iso.date().openapi({ example: '2026-11-01' });
const filtrosReportes = z.object({
  desde: fecha.optional().openapi({ description: 'Por defecto, el primer día de hace 11 meses' }),
  hasta: fecha.optional().openapi({ description: 'Por defecto, hoy (America/Tegucigalpa)' }),
});

// --- Salida

const usuarioAdmin = z
  .object({
    id: uuid,
    correo: z.string(),
    nombres: z.string(),
    apellidos: z.string(),
    telefono: z.string().nullable(),
    rol: z.enum(LISTA_ROLES),
    estado: z.enum(ESTADOS_USUARIO),
    idioma: z.enum(['es', 'en']),
    correoVerificado: z.boolean(),
    ultimoAccesoEn: fechaHora.nullable(),
    creadoEn: fechaHora,
  })
  .openapi('UsuarioAdmin');

const invitacionSalida = z
  .object({
    expiraEn: fechaHora,
    correoEnviado: z
      .boolean()
      .openapi({ description: 'Si es `false`, reenvía la invitación más tarde' }),
  })
  .openapi('InvitacionEmitida');

const usuarioCambiado = usuarioAdmin
  .extend({
    invitacion: invitacionSalida.optional(),
    sesionesRevocadas: z.number().int().optional(),
  })
  .openapi('UsuarioAdminCambiado');

const rolSalida = z
  .object({
    codigo: z.enum(LISTA_ROLES),
    nombreEs: z.string(),
    nombreEn: z.string(),
    descripcion: z.string().nullable(),
    usuarios: z.object({
      invitado: z.number().int(),
      activo: z.number().int(),
      inactivo: z.number().int(),
    }),
    permisos: z.array(z.object({ codigo: z.string(), descripcion: z.string().nullable() })),
  })
  .openapi('RolConPermisos');

const tipoDocumentoAdmin = z
  .object({
    id: uuid,
    codigo: z.string(),
    nombreEs: z.string(),
    nombreEn: z.string(),
    categoria: z.enum(CATEGORIAS),
    paraQueSirveEs: z.string().nullable(),
    paraQueSirveEn: z.string().nullable(),
    comoFotografiarEs: z.string().nullable(),
    comoFotografiarEn: z.string().nullable(),
    admiteVariasPaginas: z.boolean(),
    paginasEsperadas: z.number().int().nullable(),
    plantillaId: uuid.nullable(),
    version: z.number().int(),
    activo: z.boolean(),
    actualizadoEn: fechaHora,
  })
  .openapi('TipoDocumentoAdmin');

const requisitoAdmin = z
  .object({
    id: uuid,
    ruta: z.enum(LISTA_RUTAS_REQUISITO),
    tipoDocumento: z.object({
      id: uuid,
      codigo: z.string(),
      nombreEs: z.string(),
      nombreEn: z.string(),
      activo: z.boolean(),
    }),
    obligatorio: z.boolean(),
    orden: z.number().int(),
    cubiertoPorSecciones: z.array(z.string()),
    activo: z.boolean(),
    actualizadoEn: fechaHora,
  })
  .openapi('RequisitoRutaAdmin');

const catalogoItemAdmin = z
  .object({
    id: uuid,
    tipo: z.string(),
    codigo: z.string(),
    etiquetaEs: z.string(),
    etiquetaEn: z.string(),
    orden: z.number().int(),
    activo: z.boolean(),
    metadatos: z.record(z.string(), z.unknown()),
    actualizadoEn: fechaHora,
  })
  .openapi('CatalogoItemAdmin');

const configuracionItem = z
  .object({
    clave: z.enum(LISTA_CLAVES),
    valor: z.unknown().openapi({ description: '`null` si la clave todavía no se cargó' }),
    descripcion: z.string().nullable(),
    actualizadoPor: z.object({ id: uuid, nombre: z.string() }).nullable(),
    actualizadoEn: fechaHora.nullable(),
  })
  .openapi('ConfiguracionItem');

const conteoPorEstadoUsuario = z.object({
  invitado: z.number().int(),
  activo: z.number().int(),
  inactivo: z.number().int(),
  total: z.number().int(),
});

const resumen = z
  .object({
    usuarios: z.object({
      total: z.number().int(),
      porRol: z.record(z.enum(LISTA_ROLES), conteoPorEstadoUsuario),
    }),
    solicitudes: z.object({
      total: z.number().int(),
      porEstado: z.record(z.enum(LISTA_ESTADOS_SOLICITUD), z.number().int()),
    }),
    documentosProcesados: z
      .number()
      .int()
      .openapi({ description: 'Extracciones de OCR confirmadas' }),
    sistema: z.object({
      estado: z.enum(['operativo', 'degradado']),
      chequeos: z.record(z.string(), z.object({ ok: z.boolean(), ms: z.number().int() })),
    }),
    actividad: z.array(
      z.object({
        id: uuid,
        accion: z.string(),
        entidad: z.string(),
        entidadId: z.string().nullable(),
        usuario: z.object({ id: uuid, nombre: z.string() }).nullable(),
        fecha: fechaHora,
      }),
    ),
  })
  .openapi('ResumenAdmin');

const dias = z.number().nullable().openapi({ description: 'Días, con 2 decimales' });
const tasa = z.number().nullable().openapi({ description: 'De 0 a 1, con 4 decimales' });

const reportes = z
  .object({
    desde: fecha,
    hasta: fecha,
    zonaHoraria: z.literal('America/Tegucigalpa'),
    casosPorMes: z.array(
      z.object({
        mes: z.string().openapi({ example: '2026-11' }),
        creados: z.number().int(),
        cerrados: z.number().int(),
        aceptadas: z.number().int(),
        atendidasHn: z.number().int(),
        denegadas: z.number().int(),
      }),
    ),
    tiemposRevision: z.array(
      z.object({
        estado: z.enum(LISTA_ESTADOS_SOLICITUD),
        etapa: z.string().nullable(),
        casos: z.number().int().openapi({ description: 'Veces que un caso salió de ese estado' }),
        medianaDias: dias,
        promedioDias: dias,
      }),
    ),
    precisionOcr: z.object({
      confirmados: z.number().int(),
      corregidos: z.number().int(),
      revisados: z.number().int(),
      precision: tasa,
      porMes: z.array(
        z.object({
          mes: z.string(),
          confirmados: z.number().int(),
          corregidos: z.number().int(),
          precision: tasa,
        }),
      ),
    }),
    rutas: z.object({
      honduras: z.number().int(),
      mexico: z.number().int(),
      internacional: z.number().int(),
      exterior: z.number().int(),
      atendidosEnHonduras: z.number().int(),
    }),
    tiempoHastaDecision: z.object({
      casos: z.number().int(),
      medianaDias: dias,
      promedioDias: dias,
    }),
    aceptacionPorDestino: z.array(
      z.object({
        destino: z.enum(LISTA_PAQUETES),
        aceptadas: z.number().int(),
        denegadas: z.number().int(),
        respuestasFinales: z.number().int(),
        tasa,
      }),
    ),
  })
  .openapi('ReportesAdmin');

module.exports = {
  ROLES_PERSONAL,
  entrada: {
    paramsId,
    paramsClave,
    filtrosUsuarios,
    invitacion,
    cambiarUsuario,
    filtrosTipos,
    tipoDocumento,
    cambiarTipoDocumento,
    filtrosRequisitos,
    requisito,
    cambiarRequisito,
    filtrosCatalogos,
    catalogoItem,
    cambiarCatalogoItem,
    cambiarConfiguracion,
    filtrosReportes,
  },
  salida: {
    usuarioAdmin,
    usuarioCambiado,
    listaUsuarios: respuestaPaginadaDe(usuarioAdmin),
    rolSalida,
    tipoDocumentoAdmin,
    requisitoAdmin,
    catalogoItemAdmin,
    configuracionItem,
    resumen,
    reportes,
  },
};
