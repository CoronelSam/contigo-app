'use strict';

// Tabla de transiciones de la solicitud (brief 02). Cada cambio de estado debe pasar por aquí.

const { ESTADOS_SOLICITUD: E, ETAPAS, ROLES, RUTAS } = require('./constantes');

const COORD = [ROLES.COORDINADOR];
const AL_EXTERIOR = [RUTAS.MEXICO, RUTAS.INTERNACIONAL];

/**
 * @typedef {object} Transicion
 * @property {string} accion
 * @property {Array<string | null>} de
 * @property {string} a
 * @property {string[]} roles
 * @property {'evaluacion' | 'paquete'} [etapa] Etapa que debe tener la solicitud.
 * @property {(solicitud: object) => boolean} [disponible] Si la acción se ofrece en la app.
 * @property {(solicitud: object, campos: object) => string | null} [validar] Mensaje si no aplica.
 * @property {(solicitud: object, campos: object) => object} [forzar] Campos que la transición fija.
 * @property {Array<{ para: 'familia' | 'coordinadores', tipo: string }>} notificaciones
 */

/** @type {ReadonlyArray<Transicion>} */
const TRANSICIONES = Object.freeze([
  {
    accion: 'crear',
    de: [null],
    a: E.BORRADOR,
    roles: [ROLES.FAMILIA],
    forzar: () => ({ etapa: ETAPAS.EVALUACION }),
    notificaciones: [],
  },
  {
    accion: 'elegir_modalidad',
    de: [E.BORRADOR],
    a: E.CAPTURA,
    roles: [ROLES.FAMILIA],
    notificaciones: [],
  },
  {
    accion: 'enviar',
    de: [E.CAPTURA, E.INFO_ADICIONAL, E.PAQUETE_EXTERIOR],
    a: E.EN_REVISION,
    roles: [ROLES.FAMILIA],
    notificaciones: [
      { para: 'familia', tipo: 'SOLICITUD_ENVIADA' },
      { para: 'coordinadores', tipo: 'SOLICITUD_EN_REVISION' },
    ],
  },
  {
    accion: 'solicitar_correccion',
    de: [E.EN_REVISION],
    a: E.INFO_ADICIONAL,
    roles: [ROLES.VOLUNTARIO, ROLES.COORDINADOR],
    notificaciones: [{ para: 'familia', tipo: 'CORRECCION_SOLICITADA' }],
  },
  {
    accion: 'confirmar_evaluacion',
    de: [E.EN_REVISION],
    a: E.EN_EVALUACION,
    roles: COORD,
    etapa: ETAPAS.EVALUACION,
    notificaciones: [{ para: 'familia', tipo: 'CAMBIO_ESTADO' }],
  },
  {
    accion: 'confirmar_paquete',
    de: [E.EN_REVISION],
    a: E.COMPLETA,
    roles: COORD,
    etapa: ETAPAS.PAQUETE,
    notificaciones: [{ para: 'familia', tipo: 'CAMBIO_ESTADO' }],
  },
  {
    accion: 'decidir_ruta_exterior',
    de: [E.EN_EVALUACION],
    a: E.PAQUETE_EXTERIOR,
    roles: COORD,
    validar: (_s, campos) =>
      AL_EXTERIOR.includes(campos.rutaDecidida)
        ? null
        : 'La ruta decidida debe ser MEXICO o INTERNACIONAL',
    forzar: (_s, campos) => ({ paquete: campos.rutaDecidida, etapa: ETAPAS.PAQUETE }),
    notificaciones: [
      { para: 'familia', tipo: 'RUTA_DECIDIDA' },
      { para: 'familia', tipo: 'DOCUMENTOS_PENDIENTES' },
    ],
  },
  {
    accion: 'derivar_honduras',
    de: [E.EN_EVALUACION],
    a: E.DERIVADA_HN,
    roles: COORD,
    disponible: (s) => s.rutaDecidida === RUTAS.HONDURAS,
    validar: (s) =>
      s.rutaDecidida === RUTAS.HONDURAS ? null : 'La ruta decidida debe ser HONDURAS',
    notificaciones: [{ para: 'familia', tipo: 'CAMBIO_ESTADO' }],
  },
  {
    accion: 'registrar_atencion',
    de: [E.DERIVADA_HN],
    a: E.ATENDIDA_HN,
    roles: COORD,
    notificaciones: [{ para: 'familia', tipo: 'CAMBIO_ESTADO' }],
  },
  {
    accion: 'reabrir_evaluacion',
    de: [E.PAQUETE_EXTERIOR, E.DERIVADA_HN, E.DENEGADA],
    a: E.EN_EVALUACION,
    roles: COORD,
    forzar: () => ({ etapa: ETAPAS.EVALUACION, rutaDecidida: null, paquete: null }),
    notificaciones: [{ para: 'familia', tipo: 'CAMBIO_ESTADO' }],
  },
  {
    accion: 'registrar_envio',
    de: [E.COMPLETA],
    a: E.ENVIADA,
    roles: COORD,
    notificaciones: [{ para: 'familia', tipo: 'CAMBIO_ESTADO' }],
  },
  {
    accion: 'respuesta_info_adicional',
    de: [E.ENVIADA],
    a: E.INFO_ADICIONAL,
    roles: COORD,
    notificaciones: [{ para: 'familia', tipo: 'CORRECCION_SOLICITADA' }],
  },
  {
    accion: 'respuesta_aceptada',
    de: [E.ENVIADA],
    a: E.ACEPTADA,
    roles: COORD,
    notificaciones: [{ para: 'familia', tipo: 'RESPUESTA_REGISTRADA' }],
  },
  {
    accion: 'respuesta_denegada',
    de: [E.ENVIADA],
    a: E.DENEGADA,
    roles: COORD,
    notificaciones: [{ para: 'familia', tipo: 'RESPUESTA_REGISTRADA' }],
  },
]);

/** Transiciones que salen de `de` hacia `a` (sin revisar rol ni etapa). */
function candidatas(de, a) {
  return TRANSICIONES.filter((t) => t.a === a && t.de.includes(de));
}

module.exports = { TRANSICIONES, candidatas };
