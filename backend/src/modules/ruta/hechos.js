'use strict';

// Hechos del expediente que pueden usar las reglas de ruta. Nunca texto libre clínico: solo
// códigos, números y estados que ya existen en el expediente.

const { Op } = require('sequelize');
const { estadoExpediente } = require('../../core/expediente');

const ZONA_HORARIA = 'America/Tegucigalpa';

/** Hechos disponibles para las condiciones de las reglas (las variables de JsonLogic). */
const HECHOS = Object.freeze([
  'edadAnios',
  'edadMeses',
  'sexo',
  'departamento',
  'municipio',
  'tiposAtencion',
  'condiciones',
  'cirugiasPrevias',
  'ayudasTecnicas',
  'caminaSolo',
  'especialidadesRequeridas',
  'proveedoresLocalesEnDepartamento',
  'proveedoresLocalesEnPais',
  'documentosEvaluacion',
  'tieneCertificacionMedica',
]);

/** Hechos de ejemplo para comprobar que una condición se puede evaluar antes de guardarla. */
const HECHOS_DE_EJEMPLO = Object.freeze({
  edadAnios: 8,
  edadMeses: 100,
  sexo: 'femenino',
  departamento: '08',
  municipio: '0801',
  tiposAtencion: ['pie_zambo'],
  condiciones: [],
  cirugiasPrevias: 0,
  ayudasTecnicas: [],
  caminaSolo: true,
  especialidadesRequeridas: ['ortopedia_pediatrica'],
  proveedoresLocalesEnDepartamento: 0,
  proveedoresLocalesEnPais: 0,
  documentosEvaluacion: {},
  tieneCertificacionMedica: false,
});

const modelos = () => require('../../models');

/** Edad en meses cumplidos (hora de Honduras). */
function mesesCumplidos(fechaNacimiento) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA });
  const [ha, hm, hd] = hoy.split('-').map(Number);
  const [a, m, d] = String(fechaNacimiento).slice(0, 10).split('-').map(Number);
  let meses = (ha - a) * 12 + (hm - m);
  if (hd < d) meses -= 1;
  return Math.max(meses, 0);
}

/** Proveedores activos con alguna de las especialidades (en el departamento, si se indica). */
async function contarProveedores(especialidades, departamento, transaction) {
  if (!especialidades.length) return 0;
  const { ProveedorLocal } = modelos();
  return ProveedorLocal.count({
    where: {
      activo: true,
      especialidades: { [Op.overlap]: especialidades },
      ...(departamento ? { departamentoCodigo: departamento } : {}),
    },
    transaction,
  });
}

/**
 * Calcula los hechos del expediente para el motor de reglas.
 * @param {string} solicitudId
 * @param {{ transaction?: import('sequelize').Transaction }} [opciones]
 * @returns {Promise<Record<string, unknown>>}
 */
async function construirHechos(solicitudId, { transaction } = {}) {
  const { Solicitud, Paciente, Municipio, SolicitudSeccion, CatalogoItem } = modelos();
  const solicitud = await Solicitud.findByPk(solicitudId, { transaction });
  const paciente = await Paciente.findByPk(solicitud.pacienteId, { transaction });
  const municipio = await Municipio.findByPk(paciente.municipioCodigo, { transaction });
  const filas = await SolicitudSeccion.findAll({ where: { solicitudId }, transaction });
  const datos = Object.fromEntries(filas.map((f) => [f.seccion, f.datos ?? {}]));
  const medica = datos.informacion_medica ?? {};
  const antecedentes = datos.antecedentes_medicos ?? {};
  const movilidad = datos.crecimiento_movilidad ?? {};

  const tiposAtencion = medica.atencionSolicitada ? [medica.atencionSolicitada] : [];
  const items = tiposAtencion.length
    ? await CatalogoItem.findAll({
        where: { tipo: 'tipo_atencion', codigo: tiposAtencion },
        attributes: ['metadatos'],
        transaction,
      })
    : [];
  const especialidadesRequeridas = [
    ...new Set(items.flatMap((i) => i.metadatos?.especialidades ?? [])),
  ].sort();

  const departamento = municipio?.departamentoCodigo ?? null;
  const expediente = await estadoExpediente(solicitudId, { transaction });
  const documentosEvaluacion = Object.fromEntries(
    expediente.documentos.filter((d) => d.ruta === 'EVALUACION').map((d) => [d.codigo, d.estado]),
  );
  const meses = mesesCumplidos(paciente.fechaNacimiento);

  return {
    edadAnios: Math.floor(meses / 12),
    edadMeses: meses,
    sexo: paciente.sexo,
    departamento,
    municipio: paciente.municipioCodigo,
    tiposAtencion,
    condiciones: Array.isArray(antecedentes.condiciones) ? [...antecedentes.condiciones] : [],
    cirugiasPrevias: Array.isArray(medica.cirugias) ? medica.cirugias.length : 0,
    ayudasTecnicas: Array.isArray(movilidad.ayudasTecnicas) ? [...movilidad.ayudasTecnicas] : [],
    caminaSolo: movilidad.caminarSolo ? movilidad.caminarSolo === 'logrado' : null,
    especialidadesRequeridas,
    proveedoresLocalesEnDepartamento: await contarProveedores(
      especialidadesRequeridas,
      departamento,
      transaction,
    ),
    proveedoresLocalesEnPais: await contarProveedores(especialidadesRequeridas, null, transaction),
    documentosEvaluacion,
    tieneCertificacionMedica: expediente.profesional.estado === 'completa',
  };
}

module.exports = { HECHOS, HECHOS_DE_EJEMPLO, construirHechos };
