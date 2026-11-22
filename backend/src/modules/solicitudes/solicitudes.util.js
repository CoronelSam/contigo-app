'use strict';

// Utilidades del módulo solicitudes.

const { ESTADOS_SOLICITUD: E, ROLES } = require('../../core/estados/constantes');
const { transicionesPosibles } = require('../../core/estados');

/** Estados en los que una solicitud ya no cuenta como abierta (DR, pantalla 11). */
const ESTADOS_CERRADOS = Object.freeze([E.ACEPTADA, E.ATENDIDA_HN, E.DENEGADA]);

const modelos = () => require('../../models');

/** ¿Es personal de Vanguardia (voluntario o coordinador)? */
const esPersonal = (usuario) => [ROLES.VOLUNTARIO, ROLES.COORDINADOR].includes(usuario?.rol);

const iso = (fecha) => (fecha ? new Date(fecha).toISOString() : null);

/** Idioma de los textos para el usuario: `es` salvo que pida `en`. */
const idiomaDe = (usuario) => (usuario?.idioma === 'en' ? 'en' : 'es');

/**
 * Valor de la tabla `configuracion`, o `porDefecto` si la clave no existe.
 * @param {string} clave
 */
async function leerConfiguracion(clave, porDefecto, transaction) {
  const { Configuracion } = modelos();
  const fila = await Configuracion.findByPk(clave, { transaction });
  return fila ? fila.valor : porDefecto;
}

/**
 * Crea la fila hija de la solicitud si no existe (INSERT … ON CONFLICT DO NOTHING) y la devuelve
 * bloqueada con FOR UPDATE. Si otra petición la crea a la vez, esta espera su commit y lee la fila
 * ya creada: nunca hay un error de llave única.
 * @param {import('sequelize').ModelStatic<any>} Modelo
 * @param {Record<string, unknown>} llave Columnas (en camelCase) de la llave única.
 * @param {import('sequelize').Transaction} transaction
 */
async function filaBloqueada(Modelo, llave, transaction) {
  const { sequelize } = modelos();
  const columnas = Object.keys(llave).map((k) => Modelo.getAttributes()[k].field);
  const marcadores = Object.keys(llave).map((k) => `:${k}`);
  await sequelize.query(
    `INSERT INTO ${Modelo.getTableName()} (${columnas.join(', ')})
     VALUES (${marcadores.join(', ')})
     ON CONFLICT (${columnas.join(', ')}) DO NOTHING`,
    { replacements: llave, transaction },
  );
  return Modelo.findOne({ where: llave, lock: transaction.LOCK.UPDATE, transaction });
}

/**
 * Datos básicos de la solicitud y las acciones que el usuario puede hacer.
 * @param {object} solicitud Instancia de Solicitud.
 * @param {{ rol: string }} usuario
 */
function formatearSolicitud(solicitud, usuario) {
  return {
    id: solicitud.id,
    codigo: solicitud.codigo,
    pacienteId: solicitud.pacienteId,
    estado: solicitud.estado,
    etapa: solicitud.etapa,
    modalidad: solicitud.modalidad ?? null,
    creadaEn: iso(solicitud.createdAt),
    enviadaEn: iso(solicitud.enviadaEn),
    ultimoCambioEstado: iso(solicitud.ultimoCambioEstado),
    acciones: transicionesPosibles(solicitud, usuario),
  };
}

module.exports = {
  ESTADOS_CERRADOS,
  esPersonal,
  iso,
  idiomaDe,
  leerConfiguracion,
  filaBloqueada,
  formatearSolicitud,
};
