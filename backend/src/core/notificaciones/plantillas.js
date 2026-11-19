'use strict';

// Textos de las notificaciones en español e inglés.
// Reglas: ningún texto presenta el envío a revisión como aceptación médica, ninguno promete
// plazos y la ruta decidida se explica en lenguaje claro, nunca como diagnóstico.
// Ante la familia el personal es "el equipo Vanguardia" o "el coordinador del caso".

/** Categoría de cada tipo para las preferencias de push (pantalla 06). */
const CATEGORIAS = Object.freeze({
  MENSAJES: 'mensajes',
  CORRECCIONES: 'correcciones',
  DOCUMENTOS: 'documentos',
  CITAS: 'citas',
  ESTADOS: 'estados',
});

const nombreDe = (v, idioma) =>
  v.nombre ?? v.codigo ?? (idioma === 'en' ? 'your child' : 'tu niño o niña');

/** YYYY-MM-DD → DD/MM/AAAA (es) o MM/DD/YYYY (en). */
function fecha(valor, idioma) {
  if (!valor) return '';
  const [a, m, d] = String(valor).slice(0, 10).split('-');
  return idioma === 'en' ? `${m}/${d}/${a}` : `${d}/${m}/${a}`;
}

const enlaceCaso = (sufijo) => (v) =>
  v.solicitudId ? `solicitudes/${v.solicitudId}${sufijo}` : 'notificaciones';

const CAMBIO_ESTADO = {
  es: {
    EN_EVALUACION: (n) =>
      `La solicitud de ${n} pasó a evaluación del equipo Vanguardia, que definirá el siguiente paso de atención.`,
    COMPLETA: (n) => `El expediente de ${n} está completo. El equipo Vanguardia prepara el envío.`,
    ENVIADA: (n) =>
      `El equipo Vanguardia envió el expediente de ${n} a Shriners. Shriners revisará el caso y tomará la decisión; te avisaremos cuando haya novedades.`,
    DERIVADA_HN: (n) =>
      `El equipo Vanguardia registró una cita de atención en Honduras para ${n}. Revisa los detalles en la app.`,
    ATENDIDA_HN: (n) =>
      `Registramos la atención de ${n} en Honduras. Gracias por confiar en el equipo Vanguardia.`,
    otro: (n) => `La solicitud de ${n} tiene un nuevo estado. Revisa el seguimiento en la app.`,
  },
  en: {
    EN_EVALUACION: (n) =>
      `The request for ${n} is now being evaluated by the Vanguardia team, who will define the next care step.`,
    COMPLETA: (n) => `The file for ${n} is complete. The Vanguardia team is preparing to send it.`,
    ENVIADA: (n) =>
      `The Vanguardia team sent the file for ${n} to Shriners. Shriners will review the case and make the decision; we will let you know when there is news.`,
    DERIVADA_HN: (n) =>
      `The Vanguardia team scheduled a care appointment in Honduras for ${n}. Check the details in the app.`,
    ATENDIDA_HN: (n) =>
      `We recorded that ${n} received care in Honduras. Thank you for trusting the Vanguardia team.`,
    otro: (n) => `The request for ${n} has a new status. Check the follow-up in the app.`,
  },
};

const RUTA_DECIDIDA = {
  es: {
    HONDURAS: (n) =>
      `El siguiente paso para ${n} es la atención en Honduras. El equipo Vanguardia coordinará la cita contigo.`,
    MEXICO: (n) =>
      `El siguiente paso para ${n} es preparar su expediente para el Hospital Shriners México. Shriners decidirá si recibe el caso. Revisa en la app los documentos que faltan.`,
    INTERNACIONAL: (n) =>
      `El siguiente paso para ${n} es preparar su expediente para el programa internacional de Shriners. Shriners decidirá si recibe el caso. Revisa en la app los documentos que faltan.`,
  },
  en: {
    HONDURAS: (n) =>
      `The next step for ${n} is care in Honduras. The Vanguardia team will arrange the appointment with you.`,
    MEXICO: (n) =>
      `The next step for ${n} is preparing the file for Shriners Hospital Mexico. Shriners will decide whether to take the case. Check the app for the missing documents.`,
    INTERNACIONAL: (n) =>
      `The next step for ${n} is preparing the file for the Shriners international program. Shriners will decide whether to take the case. Check the app for the missing documents.`,
  },
};

/**
 * Cada tipo: categoría, destinatario habitual, enlace interno y textos es/en.
 * Las variables habituales son { nombre, codigo, solicitudId } más las propias del tipo.
 */
const PLANTILLAS = Object.freeze({
  SOLICITUD_ENVIADA: {
    categoria: CATEGORIAS.ESTADOS,
    para: 'familia',
    enlace: enlaceCaso('/seguimiento'),
    es: (v) => ({
      titulo: 'Solicitud enviada a revisión',
      cuerpo: `Recibimos la solicitud${v.codigo ? ` ${v.codigo}` : ''} de ${nombreDe(v, 'es')}. El equipo Vanguardia la revisará. Esto no es una aceptación médica ni una recepción en un hospital.`,
    }),
    en: (v) => ({
      titulo: 'Request sent for review',
      cuerpo: `We received request${v.codigo ? ` ${v.codigo}` : ''} for ${nombreDe(v, 'en')}. The Vanguardia team will review it. This is not a medical acceptance or a hospital admission.`,
    }),
  },
  SOLICITUD_EN_REVISION: {
    categoria: CATEGORIAS.ESTADOS,
    para: 'coordinador',
    enlace: enlaceCaso(''),
    es: (v) => ({
      titulo: 'Solicitud en revisión',
      cuerpo: `La solicitud ${v.codigo} llegó a revisión.`,
    }),
    en: (v) => ({ titulo: 'Request in review', cuerpo: `Request ${v.codigo} arrived for review.` }),
  },
  CORRECCION_SOLICITADA: {
    categoria: CATEGORIAS.CORRECCIONES,
    para: 'familia',
    enlace: enlaceCaso('/documentos'),
    es: (v) => ({
      titulo: 'Hace falta información',
      cuerpo: `El equipo Vanguardia necesita que revises o completes información de la solicitud de ${nombreDe(v, 'es')}. Abre la app para ver qué falta.`,
    }),
    en: (v) => ({
      titulo: 'More information needed',
      cuerpo: `The Vanguardia team needs you to review or complete information in the request for ${nombreDe(v, 'en')}. Open the app to see what is missing.`,
    }),
  },
  CAMBIO_ESTADO: {
    categoria: CATEGORIAS.ESTADOS,
    para: 'familia',
    enlace: enlaceCaso('/seguimiento'),
    es: (v) => ({
      titulo: 'Novedades de tu solicitud',
      cuerpo: (CAMBIO_ESTADO.es[v.estado] ?? CAMBIO_ESTADO.es.otro)(nombreDe(v, 'es')),
    }),
    en: (v) => ({
      titulo: 'Update on your request',
      cuerpo: (CAMBIO_ESTADO.en[v.estado] ?? CAMBIO_ESTADO.en.otro)(nombreDe(v, 'en')),
    }),
  },
  RUTA_DECIDIDA: {
    categoria: CATEGORIAS.ESTADOS,
    para: 'familia',
    enlace: enlaceCaso('/seguimiento'),
    es: (v) => ({
      titulo: 'Siguiente paso definido',
      cuerpo: (RUTA_DECIDIDA.es[v.ruta] ?? CAMBIO_ESTADO.es.otro)(nombreDe(v, 'es')),
    }),
    en: (v) => ({
      titulo: 'Next step defined',
      cuerpo: (RUTA_DECIDIDA.en[v.ruta] ?? CAMBIO_ESTADO.en.otro)(nombreDe(v, 'en')),
    }),
  },
  DOCUMENTOS_PENDIENTES: {
    categoria: CATEGORIAS.DOCUMENTOS,
    para: 'familia',
    enlace: enlaceCaso('/documentos'),
    es: (v) => ({
      titulo: 'Documentos pendientes',
      cuerpo: `Para continuar con la solicitud de ${nombreDe(v, 'es')}, sube los documentos que aparecen como pendientes en la app.`,
    }),
    en: (v) => ({
      titulo: 'Pending documents',
      cuerpo: `To continue with the request for ${nombreDe(v, 'en')}, upload the documents shown as pending in the app.`,
    }),
  },
  CITA_PROGRAMADA: {
    categoria: CATEGORIAS.CITAS,
    para: 'familia',
    enlace: enlaceCaso('/seguimiento'),
    es: (v) => ({
      titulo: 'Cita programada',
      cuerpo: `${nombreDe(v, 'es')} tiene una cita el ${fecha(v.fecha, 'es')}${v.hora ? ` a las ${v.hora}` : ''}${v.proveedor ? ` en ${v.proveedor}` : ''}. Revisa los detalles en la app.`,
    }),
    en: (v) => ({
      titulo: 'Appointment scheduled',
      cuerpo: `${nombreDe(v, 'en')} has an appointment on ${fecha(v.fecha, 'en')}${v.hora ? ` at ${v.hora}` : ''}${v.proveedor ? ` at ${v.proveedor}` : ''}. Check the details in the app.`,
    }),
  },
  CITA_ACTUALIZADA: {
    categoria: CATEGORIAS.CITAS,
    para: 'familia',
    enlace: enlaceCaso('/seguimiento'),
    es: (v) => ({
      titulo: 'Cita actualizada',
      cuerpo: `La cita de ${nombreDe(v, 'es')} cambió${v.fecha ? `: ahora es el ${fecha(v.fecha, 'es')}${v.hora ? ` a las ${v.hora}` : ''}` : ''}. Revisa los detalles en la app.`,
    }),
    en: (v) => ({
      titulo: 'Appointment updated',
      cuerpo: `The appointment for ${nombreDe(v, 'en')} changed${v.fecha ? `: it is now on ${fecha(v.fecha, 'en')}${v.hora ? ` at ${v.hora}` : ''}` : ''}. Check the details in the app.`,
    }),
  },
  RESPUESTA_REGISTRADA: {
    categoria: CATEGORIAS.ESTADOS,
    para: 'familia',
    enlace: enlaceCaso('/mensajes'),
    es: (v) => ({
      titulo: 'Hay novedades',
      cuerpo: `Hay novedades sobre la solicitud de ${nombreDe(v, 'es')}. El coordinador del caso te escribirá con los siguientes pasos.`,
    }),
    en: (v) => ({
      titulo: 'There is news',
      cuerpo: `There is news about the request for ${nombreDe(v, 'en')}. The case coordinator will write to you with the next steps.`,
    }),
  },
  MENSAJE_NUEVO: {
    categoria: CATEGORIAS.MENSAJES,
    para: 'familia o coordinador',
    enlace: enlaceCaso('/mensajes'),
    es: (v) => ({
      titulo: 'Mensaje nuevo',
      cuerpo: `Tienes un mensaje nuevo sobre la solicitud ${v.codigo}.`,
    }),
    en: (v) => ({
      titulo: 'New message',
      cuerpo: `You have a new message about request ${v.codigo}.`,
    }),
  },
  ASIGNACION_NUEVA: {
    categoria: CATEGORIAS.ESTADOS,
    para: 'voluntario',
    enlace: enlaceCaso(''),
    es: (v) => ({ titulo: 'Caso asignado', cuerpo: `Te asignaron el caso ${v.codigo}.` }),
    en: (v) => ({ titulo: 'Case assigned', cuerpo: `Case ${v.codigo} was assigned to you.` }),
  },
  REVISION_OCR_LISTA: {
    categoria: CATEGORIAS.ESTADOS,
    para: 'coordinador',
    enlace: enlaceCaso(''),
    es: (v) => ({
      titulo: 'Revisión de OCR lista',
      cuerpo: `Se confirmó la revisión de un documento del caso ${v.codigo}.`,
    }),
    en: (v) => ({
      titulo: 'OCR review ready',
      cuerpo: `A document review was confirmed for case ${v.codigo}.`,
    }),
  },
});

const TIPOS = Object.freeze(Object.keys(PLANTILLAS));

/**
 * Arma título, cuerpo, categoría y enlace de una notificación.
 * @param {string} tipo
 * @param {'es' | 'en'} idioma
 * @param {Record<string, unknown>} variables
 */
function renderizar(tipo, idioma, variables = {}) {
  const plantilla = PLANTILLAS[tipo];
  if (!plantilla) throw new Error(`Tipo de notificación desconocido: ${tipo}`);
  const textos = (plantilla[idioma] ?? plantilla.es)(variables);
  return { ...textos, categoria: plantilla.categoria, enlace: plantilla.enlace(variables) };
}

module.exports = { PLANTILLAS, TIPOS, CATEGORIAS, renderizar };
