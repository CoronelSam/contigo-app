'use strict';

// Relación del usuario con el caso y ventanas de edición.
//
// - Familia: vinculada al niño (paciente_tutor → tutores.usuario_id).
// - Voluntario: asignación activa en el caso.
// - Coordinador: todos los casos.
// - Administrador: ninguno (no abre expedientes clínicos).
// Sin relación, se responde 404 para no revelar que el recurso existe.

const { Op } = require('sequelize');
const { ESTADOS_SOLICITUD: E, ESTADOS_FINALES, ROLES, RUTAS } = require('../estados/constantes');
const { noEncontrado, conflicto } = require('../errores');
const { obtenerSeccion } = require('../expediente/secciones');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (v) => typeof v === 'string' && UUID.test(v);

const modelos = () => require('../../models');

async function existe(sql, replacements, transaction) {
  const { sequelize } = modelos();
  const filas = await sequelize.query(`SELECT EXISTS (${sql}) AS existe`, {
    replacements,
    transaction,
    type: sequelize.QueryTypes.SELECT,
  });
  return filas[0].existe === true;
}

/** ¿La cuenta de familia está vinculada a este niño? */
function familiaVinculada(usuarioId, pacienteId, transaction) {
  return existe(
    `SELECT 1 FROM paciente_tutor pt
       JOIN tutores t ON t.id = pt.tutor_id
      WHERE t.usuario_id = :usuarioId AND pt.paciente_id = :pacienteId`,
    { usuarioId, pacienteId },
    transaction,
  );
}

/** ¿El voluntario tiene una asignación activa en este caso? */
function voluntarioAsignado(usuarioId, solicitudId, transaction) {
  return existe(
    `SELECT 1 FROM asignaciones
      WHERE voluntario_id = :usuarioId AND solicitud_id = :solicitudId AND activa`,
    { usuarioId, solicitudId },
    transaction,
  );
}

/**
 * ¿El usuario tiene relación con la solicitud?
 * @param {{ id: string, rol: string }} usuario
 * @param {{ id: string, pacienteId: string }} solicitud
 */
async function tieneRelacion(usuario, solicitud, { transaction } = {}) {
  switch (usuario?.rol) {
    case ROLES.COORDINADOR:
      return true;
    case ROLES.FAMILIA:
      return familiaVinculada(usuario.id, solicitud.pacienteId, transaction);
    case ROLES.VOLUNTARIO:
      return voluntarioAsignado(usuario.id, solicitud.id, transaction);
    default:
      return false;
  }
}

/**
 * Carga la solicitud si el usuario tiene relación con ella; si no, 404.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {{ transaction?: import('sequelize').Transaction, include?: any, lock?: any }} [opciones]
 */
async function obtenerSolicitudConAcceso(
  usuario,
  solicitudId,
  { transaction, include, lock } = {},
) {
  if (!esUuid(solicitudId)) throw noEncontrado();
  const { Solicitud } = modelos();
  const solicitud = await Solicitud.findByPk(solicitudId, { transaction, include, lock });
  if (!solicitud || !(await tieneRelacion(usuario, solicitud, { transaction }))) {
    throw noEncontrado();
  }
  return solicitud;
}

/**
 * Carga el niño si el usuario es su familia vinculada o coordinador; si no, 404.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} pacienteId
 */
async function obtenerPacienteConAcceso(usuario, pacienteId, { transaction, include } = {}) {
  if (!esUuid(pacienteId)) throw noEncontrado();
  const { Paciente } = modelos();
  const paciente = await Paciente.findByPk(pacienteId, { transaction, include });
  if (!paciente) throw noEncontrado();
  const permitido =
    usuario?.rol === ROLES.COORDINADOR ||
    (usuario?.rol === ROLES.FAMILIA &&
      (await familiaVinculada(usuario.id, paciente.id, transaction)));
  if (!permitido) throw noEncontrado();
  return paciente;
}

/**
 * `where` de Sequelize para listar solo las solicitudes visibles para el usuario.
 * @param {{ id: string, rol: string }} usuario
 */
function filtroSolicitudesVisibles(usuario) {
  const { sequelize } = modelos();
  const id = sequelize.escape(usuario?.id ?? '');
  switch (usuario?.rol) {
    case ROLES.COORDINADOR:
      return {};
    case ROLES.FAMILIA:
      return {
        pacienteId: {
          [Op.in]: sequelize.literal(
            `(SELECT pt.paciente_id FROM paciente_tutor pt JOIN tutores t ON t.id = pt.tutor_id WHERE t.usuario_id = ${id})`,
          ),
        },
      };
    case ROLES.VOLUNTARIO:
      return {
        id: {
          [Op.in]: sequelize.literal(
            `(SELECT solicitud_id FROM asignaciones WHERE voluntario_id = ${id} AND activa)`,
          ),
        },
      };
    default:
      return { [Op.and]: sequelize.literal('FALSE') };
  }
}

/**
 * Ids de usuario de la familia del caso (tutores vinculados con cuenta activa), para notificar.
 * @param {string} solicitudId
 */
async function usuariosFamiliaDe(solicitudId, { transaction } = {}) {
  const { sequelize } = modelos();
  const filas = await sequelize.query(
    `SELECT DISTINCT u.id
       FROM solicitudes s
       JOIN paciente_tutor pt ON pt.paciente_id = s.paciente_id
       JOIN tutores t ON t.id = pt.tutor_id
       JOIN usuarios u ON u.id = t.usuario_id
      WHERE s.id = :solicitudId AND u.estado = 'activo'`,
    { replacements: { solicitudId }, transaction, type: sequelize.QueryTypes.SELECT },
  );
  return filas.map((f) => f.id);
}

/**
 * Coordinadores a notificar: el del caso o, si no tiene, todos los activos.
 * @param {{ coordinadorId?: string | null }} solicitud
 */
async function coordinadoresDe(solicitud, { transaction } = {}) {
  if (solicitud.coordinadorId) return [solicitud.coordinadorId];
  const { Usuario } = modelos();
  const coordinadores = await Usuario.findAll({
    where: { estado: 'activo' },
    attributes: ['id'],
    include: [{ association: 'rol', where: { codigo: ROLES.COORDINADOR }, attributes: [] }],
    transaction,
  });
  return coordinadores.map((u) => u.id);
}

async function requisitoDeRuta(ruta, tipoDocumentoId, transaction) {
  if (!ruta || !tipoDocumentoId) return false;
  const { RequisitoRuta } = modelos();
  return Boolean(
    await RequisitoRuta.findOne({ where: { ruta, tipoDocumentoId, activo: true }, transaction }),
  );
}

async function correccionAbierta(solicitud, { seccion, tipoDocumentoId }, transaction) {
  const { SolicitudCorreccion } = modelos();
  const abiertas = await SolicitudCorreccion.findAll({
    where: { solicitudId: solicitud.id, estado: 'abierta' },
    include: [{ association: 'documento', attributes: ['tipoDocumentoId'] }],
    transaction,
  });
  return abiertas.some(
    (c) =>
      (seccion && c.seccion === seccion) ||
      (tipoDocumentoId && c.documento?.tipoDocumentoId === tipoDocumentoId),
  );
}

async function edicionFamilia(solicitud, { seccion, tipoDocumentoId }, transaction) {
  switch (solicitud.estado) {
    case E.BORRADOR:
    case E.CAPTURA:
      return true;
    case E.PAQUETE_EXTERIOR:
      if (seccion) return obtenerSeccion(seccion)?.obligatoriaEn === 'paquete';
      return requisitoDeRuta(solicitud.paquete, tipoDocumentoId, transaction);
    case E.INFO_ADICIONAL:
      return correccionAbierta(solicitud, { seccion, tipoDocumentoId }, transaction);
    case E.EN_EVALUACION:
      return (
        solicitud.rutaDecidida === RUTAS.HONDURAS &&
        !seccion &&
        requisitoDeRuta(RUTAS.HONDURAS, tipoDocumentoId, transaction)
      );
    default:
      return false;
  }
}

/**
 * ¿Puede el usuario editar esta parte del caso en el estado actual?
 *
 * - Familia: todo en BORRADOR y CAPTURA; en PAQUETE_EXTERIOR, los documentos del paquete fijado y
 *   las secciones que se piden en la etapa de paquete; en INFO_ADICIONAL, solo lo que tenga una
 *   corrección abierta; en EN_EVALUACION con ruta Honduras, solo los requisitos de Honduras.
 * - Voluntario asignado: en CAPTURA, EN_REVISION, INFO_ADICIONAL y PAQUETE_EXTERIOR.
 * - Coordinador: en cualquier estado no final.
 *
 * @param {{ id: string, rol: string }} usuario
 * @param {object} solicitud Instancia de Solicitud.
 * @param {{ seccion?: string, tipoDocumentoId?: string, transaction?: import('sequelize').Transaction }} [objetivo]
 * @returns {Promise<boolean>}
 */
async function puedeEditar(usuario, solicitud, { seccion, tipoDocumentoId, transaction } = {}) {
  switch (usuario?.rol) {
    case ROLES.COORDINADOR:
      return !ESTADOS_FINALES.includes(solicitud.estado);
    case ROLES.VOLUNTARIO:
      return (
        [E.CAPTURA, E.EN_REVISION, E.INFO_ADICIONAL, E.PAQUETE_EXTERIOR].includes(
          solicitud.estado,
        ) && voluntarioAsignado(usuario.id, solicitud.id, transaction)
      );
    case ROLES.FAMILIA:
      return edicionFamilia(solicitud, { seccion, tipoDocumentoId }, transaction);
    default:
      return false;
  }
}

/** Igual que puedeEditar, pero lanza 409 SOLICITUD_EDICION_BLOQUEADA. */
async function exigirEdicion(usuario, solicitud, objetivo = {}) {
  if (!(await puedeEditar(usuario, solicitud, objetivo))) {
    throw conflicto(
      'SOLICITUD_EDICION_BLOQUEADA',
      `No se puede editar en el estado ${solicitud.estado}`,
    );
  }
}

module.exports = {
  esUuid,
  tieneRelacion,
  obtenerSolicitudConAcceso,
  obtenerPacienteConAcceso,
  filtroSolicitudesVisibles,
  usuariosFamiliaDe,
  coordinadoresDe,
  puedeEditar,
  exigirEdicion,
};
