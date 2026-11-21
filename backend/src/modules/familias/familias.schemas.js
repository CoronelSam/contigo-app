'use strict';

// Esquemas Zod del módulo familias (entrada y salida; también documentan OpenAPI).

const { z } = require('../../openapi/zod');
const { esquemaPaginacion } = require('../../core/http/paginar');
const { normalizarTelefono } = require('../auth/auth.schemas');

const idioma = z.enum(['es', 'en']);
const uuid = z.uuid();
/** Texto sin espacios repetidos. */
const texto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((v) => v.replace(/\s+/g, ' '));
const textoOpcional = (max) => texto(max).nullable().optional();

const fecha = z.iso.date().openapi({ example: '2016-05-10' });
const codigoDepartamento = z
  .string()
  .regex(/^\d{2}$/)
  .openapi({ example: '08' });
const codigoMunicipio = z
  .string()
  .regex(/^\d{4}$/)
  .openapi({ example: '0801' });
const telefono = z
  .string()
  .trim()
  .transform(normalizarTelefono)
  .refine((v) => /^\+504\d{8}$/.test(v), { params: { codigo: 'TELEFONO_INVALIDO' } });
const correo = z.string().trim().toLowerCase().max(254).pipe(z.email());

// --- Catálogos

const paramsDepartamento = z.object({ id: codigoDepartamento });
const paramsTipo = z.object({ tipo: z.string().regex(/^[a-z_]{2,40}$/) });
const queryIdioma = z.object({ idioma: idioma.optional() });

const item = z
  .object({
    codigo: z.string(),
    etiqueta: z.string(),
    orden: z.number().int(),
    metadatos: z.record(z.string(), z.unknown()),
  })
  .openapi('CatalogoItem');
const lugar = z.object({ codigo: z.string(), nombre: z.string() }).openapi('Lugar');

// --- Pacientes

const datosPaciente = {
  nombres: texto(120),
  apellidoPaterno: texto(80),
  apellidoMaterno: textoOpcional(80),
  fechaNacimiento: fecha,
  sexo: z.enum(['femenino', 'masculino']),
  departamentoCodigo: codigoDepartamento,
  municipioCodigo: codigoMunicipio,
  direccion: textoOpcional(500),
};

const crearPaciente = z
  .strictObject({ ...datosPaciente, confirmarDuplicado: z.boolean().optional() })
  .openapi('PacienteNuevo');

const cambiarPaciente = z
  .strictObject({
    nombres: datosPaciente.nombres.optional(),
    apellidoPaterno: datosPaciente.apellidoPaterno.optional(),
    apellidoMaterno: datosPaciente.apellidoMaterno,
    fechaNacimiento: fecha.optional(),
    sexo: datosPaciente.sexo.optional(),
    departamentoCodigo: codigoDepartamento.optional(),
    municipioCodigo: codigoMunicipio.optional(),
    direccion: datosPaciente.direccion,
    posibleDuplicado: z.boolean().optional().openapi({ description: 'Solo el coordinador' }),
  })
  .refine((v) => !v.departamentoCodigo || v.municipioCodigo, {
    params: { codigo: 'REQUERIDO' },
    path: ['municipioCodigo'],
    when: (p) => p.issues.length === 0,
  })
  .refine((v) => Object.keys(v).length > 0, {
    params: { codigo: 'SIN_CAMBIOS' },
    when: (p) => p.issues.length === 0,
  })
  .openapi('PacienteCambios');

const paramsPaciente = z.object({ id: uuid });
const listarPacientes = esquemaPaginacion.extend({
  q: z.string().trim().min(2).max(100).optional(),
});

const tutor = z
  .object({
    id: uuid,
    nombres: z.string(),
    apellidos: z.string(),
    parentesco: z.string().nullable(),
    telefono: z.string().nullable(),
    correo: z.string().nullable(),
    direccion: z.string().nullable(),
    esResponsableLegal: z.boolean(),
    confirmadoEn: z.string().nullable(),
    tieneCuenta: z.boolean(),
    esLaCuentaActual: z.boolean(),
  })
  .openapi('Tutor');

const edad = z.object({ anios: z.number().int(), meses: z.number().int() }).openapi('Edad');

const ultimaSolicitud = z
  .object({ id: uuid, codigo: z.string(), estado: z.string(), estadoFamilia: z.string() })
  .nullable()
  .openapi('UltimaSolicitud');

const pacienteResumen = z
  .object({
    id: uuid,
    nombreCompleto: z.string(),
    edad,
    fotoArchivoId: uuid.nullable(),
    municipio: lugar,
    departamento: lugar,
    ultimaSolicitud,
  })
  .openapi('PacienteResumen');

const paciente = z
  .object({
    id: uuid,
    nombres: z.string(),
    apellidoPaterno: z.string(),
    apellidoMaterno: z.string().nullable(),
    nombreCompleto: z.string(),
    fechaNacimiento: z.string(),
    edad,
    sexo: z.enum(['femenino', 'masculino']),
    direccion: z.string().nullable(),
    municipio: lugar,
    departamento: lugar,
    fotoArchivoId: uuid.nullable(),
    posibleDuplicado: z.boolean().optional().openapi({ description: 'Solo lo ve el coordinador' }),
    tutores: z.array(tutor),
  })
  .openapi('Paciente');

// --- Tutores

const datosTutor = {
  nombres: texto(120),
  apellidos: texto(120),
  parentesco: z.string().regex(/^[a-z_]{2,60}$/),
  telefono: telefono.nullable().optional(),
  correo: correo.nullable().optional(),
  direccion: textoOpcional(500),
};

const agregarTutor = z
  .strictObject({
    esLaCuentaActual: z.boolean().optional(),
    ...datosTutor,
    esResponsableLegal: z.boolean(),
    confirmoResponsableLegal: z.boolean().optional(),
  })
  .refine((v) => !v.esResponsableLegal || v.confirmoResponsableLegal === true, {
    params: { codigo: 'CONFIRMACION_REQUERIDA' },
    path: ['confirmoResponsableLegal'],
    when: (p) => p.issues.length === 0,
  })
  .openapi('TutorNuevo');

const cambiarTutor = z
  .strictObject({
    nombres: datosTutor.nombres.optional(),
    apellidos: datosTutor.apellidos.optional(),
    parentesco: datosTutor.parentesco.optional(),
    telefono: datosTutor.telefono,
    correo: datosTutor.correo,
    direccion: datosTutor.direccion,
  })
  .refine((v) => Object.keys(v).length > 0, {
    params: { codigo: 'SIN_CAMBIOS' },
    when: (p) => p.issues.length === 0,
  })
  .openapi('TutorCambios');

const paramsTutor = z.object({ id: uuid });
const paramsVinculo = z.object({ id: uuid, tutorId: uuid });

// --- Resumen de la familia (07)

const resumen = z
  .object({
    contadores: z.object({
      ninos: z.number().int(),
      solicitudesAbiertas: z.number().int(),
      documentosPendientes: z.number().int(),
      notificacionesNoLeidas: z.number().int(),
    }),
    ninos: z.array(pacienteResumen),
  })
  .openapi('ResumenFamilia');

module.exports = {
  entrada: {
    paramsDepartamento,
    paramsTipo,
    queryIdioma,
    crearPaciente,
    cambiarPaciente,
    paramsPaciente,
    listarPacientes,
    agregarTutor,
    cambiarTutor,
    paramsTutor,
    paramsVinculo,
  },
  salida: { item, lugar, paciente, pacienteResumen, tutor, resumen },
};
