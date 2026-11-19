'use strict';

// Lista única de secciones del expediente (pantallas 21, 28 y 45 la leen del mismo lugar).
// Qué se pide en cada etapa es una decisión pendiente de la organización: se cambia aquí.

const { ETAPAS } = require('../estados/constantes');

/**
 * @typedef {{ codigo: string, pantalla: number, orden: number, tituloEs: string, tituloEn: string,
 *   obligatoriaEn: 'evaluacion' | 'paquete', origen: 'solicitud_secciones' | 'profesionales_salud' | 'consentimientos' }} Seccion
 */

/** @type {ReadonlyArray<Readonly<Seccion>>} */
const SECCIONES = Object.freeze(
  [
    {
      codigo: 'informacion_medica',
      pantalla: 13,
      tituloEs: 'Información médica',
      tituloEn: 'Medical information',
      obligatoriaEn: ETAPAS.EVALUACION,
      origen: 'solicitud_secciones',
    },
    {
      codigo: 'embarazo_nacimiento',
      pantalla: 14,
      tituloEs: 'Embarazo y nacimiento',
      tituloEn: 'Pregnancy and birth',
      obligatoriaEn: ETAPAS.PAQUETE,
      origen: 'solicitud_secciones',
    },
    {
      codigo: 'antecedentes_medicos',
      pantalla: 15,
      tituloEs: 'Antecedentes médicos',
      tituloEn: 'Medical history',
      obligatoriaEn: ETAPAS.EVALUACION,
      origen: 'solicitud_secciones',
    },
    {
      codigo: 'medicamentos_alergias',
      pantalla: 16,
      tituloEs: 'Medicamentos y alergias',
      tituloEn: 'Medications and allergies',
      obligatoriaEn: ETAPAS.PAQUETE,
      origen: 'solicitud_secciones',
    },
    {
      codigo: 'crecimiento_movilidad',
      pantalla: 17,
      tituloEs: 'Crecimiento y movilidad',
      tituloEn: 'Growth and mobility',
      obligatoriaEn: ETAPAS.EVALUACION,
      origen: 'solicitud_secciones',
    },
    {
      codigo: 'educacion',
      pantalla: 18,
      tituloEs: 'Educación',
      tituloEn: 'Education',
      obligatoriaEn: ETAPAS.PAQUETE,
      origen: 'solicitud_secciones',
    },
    {
      codigo: 'profesional_salud',
      pantalla: 19,
      tituloEs: 'Profesional de salud',
      tituloEn: 'Health professional',
      obligatoriaEn: ETAPAS.EVALUACION,
      origen: 'profesionales_salud',
    },
    {
      codigo: 'consentimientos',
      pantalla: 20,
      tituloEs: 'Consentimientos',
      tituloEn: 'Consents',
      obligatoriaEn: ETAPAS.PAQUETE,
      origen: 'consentimientos',
    },
  ].map((s, i) => Object.freeze({ ...s, orden: i + 1 })),
);

/** Códigos de las 6 secciones que se guardan como JSON en `solicitud_secciones`. */
const CODIGOS_SECCIONES_JSON = Object.freeze(
  SECCIONES.filter((s) => s.origen === 'solicitud_secciones').map((s) => s.codigo),
);

const CODIGOS_SECCIONES = Object.freeze(SECCIONES.map((s) => s.codigo));

const porCodigo = new Map(SECCIONES.map((s) => [s.codigo, s]));

/** @param {string} codigo */
const obtenerSeccion = (codigo) => porCodigo.get(codigo) ?? null;

/**
 * ¿La sección es obligatoria en esta etapa? En la etapa de paquete se exige todo.
 * @param {string} codigo
 * @param {'evaluacion' | 'paquete'} etapa
 */
function esObligatoria(codigo, etapa) {
  const seccion = porCodigo.get(codigo);
  if (!seccion) return false;
  return etapa === ETAPAS.PAQUETE || seccion.obligatoriaEn === ETAPAS.EVALUACION;
}

module.exports = {
  SECCIONES,
  CODIGOS_SECCIONES,
  CODIGOS_SECCIONES_JSON,
  obtenerSeccion,
  esObligatoria,
};
