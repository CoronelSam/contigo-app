'use strict';

// Factories de prueba: crean registros válidos con valores por defecto sobreescribibles.
// Todo es ficticio. Uso: const f = require('../../test/factories'); const fam = await f.crearFamilia();
//
// Cada factory acepta un objeto con atributos del modelo (camelCase) que reemplazan los valores
// por defecto, más algunas opciones propias (por ejemplo `paginas` en crearDocumento).

const crypto = require('node:crypto');
const argon2 = require('argon2');
const db = require('../../src/models');
const { ESTADOS_SOLICITUD: E, RUTAS, ETAPAS } = require('../../src/core/estados/constantes');

const CONTRASENA_PRUEBA = 'ContrasenaDePrueba-123';
const DIA_MS = 24 * 60 * 60 * 1000;

let secuencia = 0;
const siguiente = () => {
  secuencia += 1;
  return secuencia;
};

let hashCache;
async function hashPrueba() {
  hashCache ??= await argon2.hash(CONTRASENA_PRUEBA, { type: argon2.argon2id });
  return hashCache;
}

const rolesCache = new Map();
async function idRol(codigo) {
  if (!rolesCache.has(codigo)) {
    const rol = await db.Rol.findOne({ where: { codigo } });
    if (!rol) throw new Error(`Rol desconocido: ${codigo}`);
    rolesCache.set(codigo, rol.id);
  }
  return rolesCache.get(codigo);
}

/** Id del tipo de documento sembrado con ese código (se recarga en cada limpiarBase). */
async function idTipoDocumento(codigo) {
  const tipo = await db.TipoDocumento.findOne({ where: { codigo } });
  if (!tipo) throw new Error(`Tipo de documento desconocido: ${codigo}`);
  return tipo.id;
}

const fechaIso = (msDesdeHoy = 0) => new Date(Date.now() + msDesdeHoy).toISOString().slice(0, 10);
const hexAleatorio = (bytes) => crypto.randomBytes(bytes).toString('hex');

// --- Acceso

/**
 * @param {{ rol?: 'familia' | 'voluntario' | 'coordinador' | 'administrador' } & Record<string, unknown>} [datos]
 */
async function crearUsuario({ rol = 'familia', ...datos } = {}) {
  const n = siguiente();
  const usuario = await db.Usuario.create({
    correo: `persona${n}@pruebas.test`,
    hashContrasena: await hashPrueba(),
    nombres: `Persona ${n}`,
    apellidos: 'Prueba',
    telefono: '+50400000000',
    idioma: 'es',
    estado: 'activo',
    rolId: await idRol(rol),
    ...datos,
  });
  usuario.rolCodigo = rol;
  return usuario;
}

// --- Archivos

async function crearArchivo(datos = {}) {
  const mime = datos.mime ?? 'image/jpeg';
  const extension = mime === 'application/pdf' ? 'pdf' : 'jpg';
  return db.Archivo.create({
    clave: `pruebas/${crypto.randomUUID()}.${extension}`,
    mime,
    bytes: 1024,
    sha256: hexAleatorio(32),
    ancho: mime.startsWith('image/') ? 800 : null,
    alto: mime.startsWith('image/') ? 600 : null,
    ...datos,
  });
}

// --- Pacientes y familias

async function crearPaciente(datos = {}) {
  const n = siguiente();
  return db.Paciente.create({
    nombres: `Niña ${n}`,
    apellidoPaterno: 'Prueba',
    apellidoMaterno: 'Ficticia',
    fechaNacimiento: '2016-05-10',
    sexo: 'femenino',
    municipioCodigo: '0801',
    direccion: 'Dirección ficticia',
    ...datos,
  });
}

async function crearTutor(datos = {}) {
  const n = siguiente();
  return db.Tutor.create({
    nombres: `Tutor ${n}`,
    apellidos: 'Prueba',
    parentesco: 'madre',
    telefono: '+50400000000',
    correo: `tutor${n}@pruebas.test`,
    ...datos,
  });
}

/** Vincula un tutor con un niño. */
async function vincularTutor({ paciente, tutor, esResponsableLegal = true, confirmadoPor = null }) {
  return db.PacienteTutor.create({
    pacienteId: paciente.id,
    tutorId: tutor.id,
    esResponsableLegal,
    confirmadoEn: esResponsableLegal ? new Date() : null,
    confirmadoPor,
  });
}

/**
 * Usuario de familia + su perfil de tutor + niños vinculados.
 * @param {{ hijos?: number, usuario?: object, paciente?: object }} [opciones]
 * @returns {Promise<{ usuario: object, tutor: object, pacientes: object[], paciente: object }>}
 */
async function crearFamilia({
  hijos = 1,
  usuario: datosUsuario = {},
  paciente: datosPaciente = {},
} = {}) {
  const usuario = await crearUsuario({ rol: 'familia', ...datosUsuario });
  const tutor = await crearTutor({
    usuarioId: usuario.id,
    nombres: usuario.nombres,
    apellidos: usuario.apellidos,
    correo: usuario.correo,
  });
  const pacientes = [];
  for (let i = 0; i < hijos; i += 1) {
    const paciente = await crearPaciente({ creadoPor: usuario.id, ...datosPaciente });
    await vincularTutor({ paciente, tutor, confirmadoPor: usuario.id });
    pacientes.push(paciente);
  }
  return { usuario, tutor, pacientes, paciente: pacientes[0] };
}

// --- Solicitudes

const ESTADOS_DE_PAQUETE = [E.PAQUETE_EXTERIOR, E.COMPLETA, E.ENVIADA, E.ACEPTADA, E.DENEGADA];

/**
 * Solicitud en el estado pedido. Sin `paciente`, crea una familia nueva.
 * La etapa y el paquete se deducen de la ruta y el estado si no se pasan.
 */
async function crearSolicitud({ paciente, estado = E.BORRADOR, ...datos } = {}) {
  const pacienteFinal = paciente ?? (await crearFamilia()).paciente;
  const [[{ n }]] = await db.sequelize.query("SELECT nextval('solicitud_codigo_seq') AS n");
  const rutaDecidida = datos.rutaDecidida ?? null;
  const alExterior = rutaDecidida === RUTAS.MEXICO || rutaDecidida === RUTAS.INTERNACIONAL;
  return db.Solicitud.create({
    codigo: `HN-${String(n).padStart(4, '0')}`,
    pacienteId: pacienteFinal.id,
    estado,
    modalidad: estado === E.BORRADOR ? null : 'app',
    etapa: alExterior && ESTADOS_DE_PAQUETE.includes(estado) ? ETAPAS.PAQUETE : ETAPAS.EVALUACION,
    paquete: alExterior ? rutaDecidida : null,
    enviadaEn: [E.BORRADOR, E.CAPTURA].includes(estado) ? null : new Date(),
    ...datos,
  });
}

async function crearSeccion({ solicitud, ...datos } = {}) {
  const solicitudFinal = solicitud ?? (await crearSolicitud({ estado: E.CAPTURA }));
  return db.SolicitudSeccion.create({
    solicitudId: solicitudFinal.id,
    seccion: 'informacion_medica',
    datos: {},
    estado: 'incompleta',
    version: 1,
    idioma: 'es',
    origen: 'app',
    ...datos,
  });
}

// --- Documentos

/**
 * Documento con sus páginas.
 * @param {{ solicitud?: object, tipo?: string, paginas?: number } & Record<string, unknown>} [opciones]
 */
async function crearDocumento({ solicitud, tipo = 'fotos_condicion', paginas = 1, ...datos } = {}) {
  const solicitudFinal = solicitud ?? (await crearSolicitud({ estado: E.CAPTURA }));
  const estado = datos.estado ?? 'CAPTURADO';
  const capturado = estado !== 'FALTA';
  const documento = await db.Documento.create({
    solicitudId: solicitudFinal.id,
    tipoDocumentoId: await idTipoDocumento(tipo),
    version: 1,
    vigente: true,
    estado,
    paginasDeclaradas: capturado && paginas > 0 ? paginas : null,
    origen: 'app',
    capturadoEn: capturado ? new Date() : null,
    validadoEn: estado === 'VALIDADO' ? new Date() : null,
    ...datos,
  });
  for (let orden = 1; orden <= paginas; orden += 1) {
    const archivo = await crearArchivo();
    await db.DocumentoPagina.create({ documentoId: documento.id, orden, archivoId: archivo.id });
  }
  return documento;
}

async function crearPlantilla(datos = {}) {
  const archivo = await crearArchivo({ mime: 'application/pdf' });
  return db.PlantillaFormulario.create({
    codigo: `plantilla_prueba_${siguiente()}`,
    nombre: 'Plantilla de prueba',
    version: 1,
    paquete: 'INTERNACIONAL',
    archivoPdfId: archivo.id,
    mapaCampos: [],
    metodo: 'campo',
    zonasOcr: [],
    orden: 0,
    activa: true,
    ...datos,
  });
}

const CAMPOS_POR_DEFECTO = [
  {
    campo: 'diagnostico',
    seccion: 'informacion_medica',
    rutaDato: '/diagnostico',
    tipo: 'texto',
    valorLeido: 'Diagnóstico ficticio',
    confianza: 0.95,
  },
  {
    campo: 'fecha_inicio',
    seccion: 'informacion_medica',
    rutaDato: '/fechaInicio',
    tipo: 'fecha',
    valorLeido: '01/02/2020',
    confianza: 0.62,
  },
];

/**
 * Extracción de OCR con sus campos (por defecto, uno confiable y uno dudoso).
 * @param {{ documento?: object, campos?: object[] } & Record<string, unknown>} [opciones]
 */
async function crearExtraccion({ documento, campos = CAMPOS_POR_DEFECTO, ...datos } = {}) {
  const documentoFinal = documento ?? (await crearDocumento({ tipo: 'solicitud_internacional' }));
  const extraccion = await db.Extraccion.create({
    documentoId: documentoFinal.id,
    motor: 'simulado',
    estado: 'por_confirmar',
    progreso: 100,
    confianzaPromedio: campos.length
      ? campos.reduce((s, c) => s + (c.confianza ?? 0), 0) / campos.length
      : null,
    ...datos,
  });
  for (const [i, campo] of campos.entries()) {
    await db.CampoExtraido.create({
      extraccionId: extraccion.id,
      pagina: 1,
      coordenadas: { x: 0.1, y: 0.1 + i * 0.05, ancho: 0.5, alto: 0.04 },
      estado: 'propuesto',
      ...campo,
    });
  }
  return extraccion;
}

async function crearAsignacion({ solicitud, voluntario, ...datos } = {}) {
  return db.Asignacion.create({
    solicitudId: (solicitud ?? (await crearSolicitud({ estado: E.CAPTURA }))).id,
    voluntarioId: (voluntario ?? (await crearUsuario({ rol: 'voluntario' }))).id,
    estado: 'asignado',
    activa: true,
    ...datos,
  });
}

/**
 * Corrección abierta. Sin documento ni sección, crea un documento rechazado del tipo `tipo`
 * (ojo: solo puede haber un documento vigente por solicitud y tipo).
 */
async function crearCorreccion({
  solicitud,
  documento,
  tipo = 'radiografias_informes',
  ...datos
} = {}) {
  const solicitudFinal = solicitud ?? (await crearSolicitud({ estado: E.INFO_ADICIONAL }));
  const documentoFinal =
    documento ??
    (datos.seccion
      ? null
      : await crearDocumento({ solicitud: solicitudFinal, tipo, estado: 'RECHAZADO' }));
  return db.SolicitudCorreccion.create({
    solicitudId: solicitudFinal.id,
    documentoId: documentoFinal?.id ?? null,
    motivo: datos.seccion ? 'dato_incompleto' : 'imagen_borrosa',
    observaciones: 'Observación de prueba',
    estado: 'abierta',
    ...datos,
  });
}

// --- Ruta y Honduras

async function crearProveedorLocal(datos = {}) {
  return db.ProveedorLocal.create({
    nombre: `Clínica de prueba ${siguiente()}`,
    tipo: 'clinica',
    departamentoCodigo: '08',
    municipioCodigo: '0801',
    especialidades: ['ortopedia_pediatrica'],
    contacto: { telefono: '+504 0000-0000', correo: 'proveedor@pruebas.test' },
    activo: true,
    ...datos,
  });
}

async function crearEvaluacion({ solicitud, ...datos } = {}) {
  return db.Evaluacion.create({
    solicitudId: (solicitud ?? (await crearSolicitud({ estado: E.EN_EVALUACION }))).id,
    rutaSugerida: 'POR_EVALUAR',
    motivos: [],
    hechos: {},
    versionReglas: 1,
    rutaDecidida: RUTAS.HONDURAS,
    justificacion: 'Justificación ficticia de prueba, sin valor clínico.',
    evaluadorNombre: 'Médico Evaluador Prueba',
    evaluadorCargo: 'Cargo de prueba',
    tipoDictamen: 'medico_evaluador',
    fechaDictamen: fechaIso(),
    vigente: true,
    ...datos,
  });
}

async function crearDerivacion({ solicitud, proveedor, ...datos } = {}) {
  return db.DerivacionLocal.create({
    solicitudId: (
      solicitud ?? (await crearSolicitud({ estado: E.DERIVADA_HN, rutaDecidida: RUTAS.HONDURAS }))
    ).id,
    proveedorId: (proveedor ?? (await crearProveedorLocal())).id,
    especialidad: 'ortopedia_pediatrica',
    fechaCita: fechaIso(7 * DIA_MS),
    estado: 'programada',
    ...datos,
  });
}

// --- Paquete y envío

async function crearPaquetePdf({ solicitud, ...datos } = {}) {
  const solicitudFinal =
    solicitud ?? (await crearSolicitud({ estado: E.COMPLETA, rutaDecidida: RUTAS.INTERNACIONAL }));
  const estado = datos.estado ?? 'listo';
  const archivo = estado === 'listo' ? await crearArchivo({ mime: 'application/pdf' }) : null;
  return db.PaquetePdf.create({
    solicitudId: solicitudFinal.id,
    paquete: solicitudFinal.paquete ?? 'INTERNACIONAL',
    tipo: 'final',
    estado,
    progreso: estado === 'listo' ? 100 : 0,
    archivoId: archivo?.id ?? null,
    numeroPaginas: estado === 'listo' ? 20 : null,
    plantillasUsadas: [],
    avisos: [],
    ...datos,
  });
}

/** Solicitud COMPLETA (internacional) con un paquete final listo y revisado. */
async function crearPaqueteCompleto({ coordinador } = {}) {
  const revisor = coordinador ?? (await crearUsuario({ rol: 'coordinador' }));
  const solicitud = await crearSolicitud({
    estado: E.COMPLETA,
    rutaDecidida: RUTAS.INTERNACIONAL,
    coordinadorId: revisor.id,
  });
  const paquete = await crearPaquetePdf({
    solicitud,
    generadoPor: revisor.id,
    revisadoPor: revisor.id,
    revisadoEn: new Date(),
  });
  return { solicitud, paquete, coordinador: revisor };
}

// --- Comunicación

async function crearMensaje({ solicitud, autor, ...datos } = {}) {
  return db.Mensaje.create({
    solicitudId: (solicitud ?? (await crearSolicitud({ estado: E.EN_REVISION }))).id,
    autorId: (autor ?? (await crearUsuario({ rol: 'coordinador' }))).id,
    cuerpo: 'Mensaje de prueba',
    ...datos,
  });
}

async function crearNotificacion({ usuario, ...datos } = {}) {
  return db.Notificacion.create({
    usuarioId: (usuario ?? (await crearUsuario())).id,
    tipo: 'CAMBIO_ESTADO',
    titulo: 'Título de prueba',
    cuerpo: 'Cuerpo de prueba',
    idioma: 'es',
    datos: {},
    ...datos,
  });
}

module.exports = {
  CONTRASENA_PRUEBA,
  idRol,
  idTipoDocumento,
  crearUsuario,
  crearArchivo,
  crearPaciente,
  crearTutor,
  vincularTutor,
  crearFamilia,
  crearSolicitud,
  crearSeccion,
  crearDocumento,
  crearPlantilla,
  crearExtraccion,
  crearAsignacion,
  crearCorreccion,
  crearProveedorLocal,
  crearEvaluacion,
  crearDerivacion,
  crearPaquetePdf,
  crearPaqueteCompleto,
  crearMensaje,
  crearNotificacion,
};
