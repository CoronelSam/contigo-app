'use strict';

// Estado del expediente: qué secciones, documentos, profesional y consentimientos faltan
// para la etapa actual. Lo usan el resumen (21, 28), la validación (45), el envío y el paquete.
// Lee el estado guardado de cada sección (lo calcula el agente 05 al guardar).

const {
  ETAPAS,
  MODALIDADES,
  RUTAS,
  RUTAS_REQUISITO,
  ESTADOS_DOCUMENTO: D,
} = require('../estados/constantes');
const { noEncontrado } = require('../errores');
const { SECCIONES, CODIGOS_SECCIONES_JSON, esObligatoria } = require('./secciones');

const TIPOS_CONSENTIMIENTO = Object.freeze([
  'divulgacion_informacion_medica',
  'marketing',
  'telesalud',
  'condiciones_atencion',
]);

const TIPO_CERTIFICACION = 'certificacion_medica';

/** Estados de extracción que significan "el OCR todavía no está revisado". */
const OCR_PENDIENTE = new Set(['en_cola', 'procesando', 'por_confirmar', 'fallida']);

const modelos = () => require('../../models');

async function leerConfiguracion(claves, transaction) {
  const { Configuracion } = modelos();
  const filas = await Configuracion.findAll({ where: { clave: claves }, transaction });
  return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
}

/**
 * Corre las consultas en paralelo, salvo dentro de una transacción: ahí comparten una sola
 * conexión y `pg` no admite consultas simultáneas en la misma conexión (error en pg@9).
 * @template T
 * @param {import('sequelize').Transaction | undefined} transaction
 * @param {Array<() => Promise<T>>} tareas
 * @returns {Promise<T[]>}
 */
async function consultar(transaction, tareas) {
  if (!transaction) return Promise.all(tareas.map((t) => t()));
  const resultados = [];
  for (const tarea of tareas) resultados.push(await tarea());
  return resultados;
}

/** Rutas de requisitos activas según el paquete fijado y la ruta decidida. */
function rutasActivas(solicitud) {
  const rutas = [RUTAS_REQUISITO.EVALUACION];
  if (solicitud.paquete) rutas.push(solicitud.paquete);
  if (solicitud.rutaDecidida === RUTAS.HONDURAS) rutas.push(RUTAS_REQUISITO.HONDURAS);
  return rutas;
}

/**
 * La certificación es el documento vigente del tipo `certificacion_medica` (hay a lo sumo uno por
 * solicitud). Se busca por tipo y no por `documento_certificacion_id` para que una versión nueva
 * del documento cuente aunque el vínculo siga apuntando a la anterior.
 */
function estadoProfesional(profesional, documentos) {
  if (!profesional) return 'vacia';
  const certificacion = documentos.find((d) => d.tipoDocumento?.codigo === TIPO_CERTIFICACION);
  const completo =
    profesional.nombre &&
    profesional.especialidad &&
    profesional.telefono &&
    certificacion &&
    [D.CAPTURADO, D.VALIDADO].includes(certificacion.estado);
  return completo ? 'completa' : 'incompleta';
}

/**
 * @typedef {{ tipo: 'seccion' | 'documento' | 'profesional' | 'consentimiento', codigo: string,
 *   motivo: 'falta' | 'incompleta' | 'rechazado' | 'sin_validar' | 'ocr_sin_revisar' | 'firma_pendiente' }} Faltante
 */

/**
 * Calcula el estado completo del expediente.
 * @param {string} solicitudId
 * @param {{ transaction?: import('sequelize').Transaction }} [opciones]
 */
async function estadoExpediente(solicitudId, { transaction } = {}) {
  const {
    Solicitud,
    SolicitudSeccion,
    RequisitoRuta,
    Documento,
    Extraccion,
    ProfesionalSalud,
    Consentimiento,
  } = modelos();

  const solicitud = await Solicitud.findByPk(solicitudId, { transaction });
  if (!solicitud) throw noEncontrado();
  const { etapa, modalidad } = solicitud;

  const [filasSecciones, requisitos, documentos, profesional, consentimientos, config] =
    await consultar(transaction, [
      () => SolicitudSeccion.findAll({ where: { solicitudId }, transaction }),
      () =>
        RequisitoRuta.findAll({
          where: { ruta: rutasActivas(solicitud), activo: true },
          include: [{ association: 'tipoDocumento' }],
          order: [['orden', 'ASC']],
          transaction,
        }),
      () =>
        Documento.findAll({
          where: { solicitudId, vigente: true },
          include: [{ association: 'tipoDocumento', attributes: ['codigo'] }],
          transaction,
        }),
      () => ProfesionalSalud.findOne({ where: { solicitudId }, transaction }),
      () => Consentimiento.findAll({ where: { solicitudId }, transaction }),
      () =>
        leerConfiguracion(
          ['consentimientos.requieren_firma', 'paquete.bloquear_firmas_pendientes'],
          transaction,
        ),
    ]);

  const extracciones = documentos.length
    ? await Extraccion.findAll({
        where: { documentoId: documentos.map((d) => d.id) },
        order: [['createdAt', 'DESC']],
        transaction,
      })
    : [];
  const ultimaExtraccion = new Map();
  for (const e of extracciones)
    if (!ultimaExtraccion.has(e.documentoId)) ultimaExtraccion.set(e.documentoId, e);

  const faltantes = [];

  // Secciones con JSON
  const estadoSeccion = new Map(filasSecciones.map((s) => [s.seccion, s.estado]));
  for (const codigo of CODIGOS_SECCIONES_JSON) {
    if (!estadoSeccion.has(codigo)) estadoSeccion.set(codigo, 'vacia');
  }

  // Profesional de salud (19)
  const estadoProf = estadoProfesional(profesional, documentos);
  estadoSeccion.set('profesional_salud', estadoProf);

  // Consentimientos (20)
  const requierenFirma = new Set(config['consentimientos.requieren_firma'] ?? TIPOS_CONSENTIMIENTO);
  const porTipo = new Map(consentimientos.map((c) => [c.tipo, c]));
  const listaConsentimientos = TIPOS_CONSENTIMIENTO.map((tipo) => {
    const c = porTipo.get(tipo);
    const decidido = Boolean(c?.decision);
    return {
      tipo,
      decision: c?.decision ?? null,
      estadoFirma: c?.estadoFirma ?? null,
      firmaPendiente: decidido && requierenFirma.has(tipo) && c.estadoFirma === 'pendiente',
    };
  });
  const decididos = listaConsentimientos.filter((c) => c.decision).length;
  estadoSeccion.set(
    'consentimientos',
    decididos === TIPOS_CONSENTIMIENTO.length ? 'completa' : decididos ? 'incompleta' : 'vacia',
  );

  const secciones = SECCIONES.map((s) => ({
    codigo: s.codigo,
    orden: s.orden,
    tituloEs: s.tituloEs,
    tituloEn: s.tituloEn,
    estado: estadoSeccion.get(s.codigo),
    obligatoria: esObligatoria(s.codigo, etapa),
  }));

  for (const s of secciones) {
    if (!s.obligatoria || s.estado === 'completa') continue;
    const motivo = s.estado === 'vacia' ? 'falta' : 'incompleta';
    if (s.codigo === 'profesional_salud')
      faltantes.push({ tipo: 'profesional', codigo: s.codigo, motivo });
    else if (s.codigo !== 'consentimientos')
      faltantes.push({ tipo: 'seccion', codigo: s.codigo, motivo });
  }
  if (esObligatoria('consentimientos', etapa)) {
    for (const c of listaConsentimientos) {
      if (!c.decision) faltantes.push({ tipo: 'consentimiento', codigo: c.tipo, motivo: 'falta' });
      else if (c.firmaPendiente)
        faltantes.push({ tipo: 'consentimiento', codigo: c.tipo, motivo: 'firma_pendiente' });
    }
  }

  // Documentos requeridos
  const documentoPorTipo = new Map(documentos.map((d) => [d.tipoDocumentoId, d]));
  const listaDocumentos = requisitos.map((r) => {
    const documento = documentoPorTipo.get(r.tipoDocumentoId) ?? null;
    const extraccion = documento ? (ultimaExtraccion.get(documento.id) ?? null) : null;
    const cubierto =
      modalidad === MODALIDADES.APP &&
      r.cubiertoPorSecciones.length > 0 &&
      r.cubiertoPorSecciones.every((s) => estadoSeccion.get(s) === 'completa');
    const estado = documento?.estado ?? D.FALTA;

    let motivo = null;
    if (!cubierto) {
      if (estado === D.FALTA) motivo = 'falta';
      else if (estado === D.RECHAZADO) motivo = 'rechazado';
      else if (estado === D.CAPTURADO) {
        motivo =
          extraccion && OCR_PENDIENTE.has(extraccion.estado) ? 'ocr_sin_revisar' : 'sin_validar';
      }
    }
    if (motivo && r.obligatorio)
      faltantes.push({ tipo: 'documento', codigo: r.tipoDocumento.codigo, motivo });

    return {
      requisitoId: r.id,
      ruta: r.ruta,
      tipoDocumentoId: r.tipoDocumentoId,
      codigo: r.tipoDocumento.codigo,
      nombreEs: r.tipoDocumento.nombreEs,
      nombreEn: r.tipoDocumento.nombreEn,
      obligatorio: r.obligatorio,
      orden: r.orden,
      cubiertoPorFormulario: cubierto,
      documentoId: documento?.id ?? null,
      estado,
      version: documento?.version ?? null,
      extraccion: extraccion
        ? { id: extraccion.id, estado: extraccion.estado, progreso: extraccion.progreso }
        : null,
      cumplido: cubierto || estado === D.VALIDADO,
    };
  });

  const bloquearFirmas =
    etapa === ETAPAS.PAQUETE && config['paquete.bloquear_firmas_pendientes'] !== false;
  const bloqueantes = faltantes.filter((f) => f.motivo !== 'firma_pendiente' || bloquearFirmas);

  return {
    solicitudId,
    etapa,
    modalidad,
    rutasRequisitos: rutasActivas(solicitud),
    secciones,
    documentos: listaDocumentos,
    profesional: { estado: estadoProf, obligatorio: esObligatoria('profesional_salud', etapa) },
    consentimientos: listaConsentimientos,
    faltantes,
    listoParaConfirmar: bloqueantes.length === 0,
  };
}

module.exports = { estadoExpediente, rutasActivas, TIPOS_CONSENTIMIENTO };
