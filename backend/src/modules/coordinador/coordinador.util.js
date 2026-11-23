'use strict';

// Utilidades del módulo coordinador.

const ZONA_HORARIA = 'America/Tegucigalpa';
const DIA_MS = 24 * 60 * 60 * 1000;

const iso = (f) => (f ? new Date(f).toISOString() : null);
const idiomaDe = (usuario) => (usuario?.idioma === 'en' ? 'en' : 'es');

const nombreCompleto = (p) =>
  [p.nombres, p.apellidoPaterno ?? p.apellido_paterno, p.apellidoMaterno ?? p.apellido_materno]
    .filter(Boolean)
    .join(' ');

const nombrePersona = (u) => (u ? [u.nombres, u.apellidos].filter(Boolean).join(' ') : null);

/** Edad en años y meses (hora de Honduras). */
function edadDe(fechaNacimiento) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA });
  const [ha, hm, hd] = hoy.split('-').map(Number);
  const [a, m, d] = String(fechaNacimiento).slice(0, 10).split('-').map(Number);
  let meses = (ha - a) * 12 + (hm - m);
  if (hd < d) meses -= 1;
  meses = Math.max(meses, 0);
  return { anios: Math.floor(meses / 12), meses: meses % 12 };
}

/** Días completos desde una fecha. Solo para seguimiento interno: nunca es un plazo. */
const diasDesde = (fecha) =>
  Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / DIA_MS));

/** `HN-0258`, `hn0258` o solo `0258`: búsqueda por código. */
const esBusquedaDeCodigo = (q) => /^(hn-?)?\d{2,}$/i.test(q.replace(/\s/g, ''));

/**
 * Descripción breve de una acción de la bitácora para la actividad reciente (42). Las que no
 * están aquí se muestran con su código.
 */
const DESCRIPCIONES = Object.freeze({
  'solicitud.crear': ['Solicitud creada', 'Request created'],
  'solicitud.elegir_modalidad': ['Modalidad elegida', 'Mode chosen'],
  'solicitud.cambiar_modalidad': ['Modalidad cambiada', 'Mode changed'],
  'solicitud.enviar': ['Solicitud enviada a revisión', 'Request sent for review'],
  'solicitud.solicitar_correccion': [
    'Información adicional solicitada',
    'More information requested',
  ],
  'solicitud.confirmar_evaluacion': [
    'Expediente confirmado para evaluación',
    'File confirmed for evaluation',
  ],
  'solicitud.confirmar_paquete': ['Expediente completo', 'File complete'],
  'solicitud.decidir_ruta_exterior': ['Ruta al exterior decidida', 'Route abroad decided'],
  'solicitud.registrar_ruta': ['Ruta registrada', 'Route recorded'],
  'solicitud.derivar_honduras': ['Derivado en Honduras', 'Referred in Honduras'],
  'solicitud.registrar_atencion': ['Atendido en Honduras', 'Seen in Honduras'],
  'solicitud.reabrir_evaluacion': ['Evaluación reabierta', 'Evaluation reopened'],
  'solicitud.registrar_envio': ['Envío registrado', 'Submission recorded'],
  'solicitud.respuesta_info_adicional': [
    'Respuesta: información adicional',
    'Response: more information',
  ],
  'solicitud.respuesta_aceptada': ['Respuesta registrada', 'Response recorded'],
  'solicitud.respuesta_denegada': ['Respuesta registrada', 'Response recorded'],
  'secciones.guardar': ['Sección del formulario guardada', 'Form section saved'],
  'secciones.fusionar_ocr': [
    'Valores del OCR pasados al formulario',
    'OCR values added to the form',
  ],
  'profesionales_salud.guardar': [
    'Profesional de salud actualizado',
    'Health professional updated',
  ],
  'consentimientos.decidir': ['Consentimiento respondido', 'Consent answered'],
  'consentimientos.firma': ['Firma de consentimiento actualizada', 'Consent signature updated'],
  'documentos.crear': ['Captura de documento iniciada', 'Document capture started'],
  'documentos.nueva_version': ['Nueva versión de documento', 'New document version'],
  'documentos.finalizar': ['Documento capturado', 'Document captured'],
  'documentos.cancelar': ['Captura de documento cancelada', 'Document capture cancelled'],
  'documentos.validar': ['Documento validado', 'Document validated'],
  'documentos.rechazar': ['Documento rechazado', 'Document rejected'],
  'documentos.pedir_nueva_captura': ['Nueva captura solicitada', 'New capture requested'],
  'correcciones.seccion': ['Corrección de sección solicitada', 'Section correction requested'],
  'correcciones.resolver': ['Corrección resuelta', 'Correction resolved'],
  'ocr.confirmar_revision': ['Revisión de OCR confirmada', 'OCR review confirmed'],
  'asignaciones.asignar': ['Voluntario asignado', 'Volunteer assigned'],
  'asignaciones.cerrar': ['Asignación cerrada', 'Assignment closed'],
  'asignaciones.reasignar': ['Caso reasignado', 'Case reassigned'],
});

/** Acciones demasiado finas para la actividad reciente (siguen en la bitácora del caso). */
const ACCIONES_SIN_ACTIVIDAD = Object.freeze([
  'documentos.agregar_pagina',
  'documentos.borrar_pagina',
  'documentos.reordenar_paginas',
  'consentimientos.abrir_texto',
  'consentimientos.nueva_version_firmada',
  'profesionales_salud.nueva_version_certificacion',
]);

function describir(accion, idioma) {
  const d = DESCRIPCIONES[accion];
  return d ? d[idioma === 'en' ? 1 : 0] : accion;
}

module.exports = {
  iso,
  idiomaDe,
  nombreCompleto,
  nombrePersona,
  edadDe,
  diasDesde,
  esBusquedaDeCodigo,
  describir,
  ACCIONES_SIN_ACTIVIDAD,
};
