'use strict';

// GET /archivos/:id/url: ningún archivo es público. Se busca a qué pertenece el archivo y se aplica
// el acceso de ese dueño. Sin relación (o sin el permiso del dueño) → 404, para no revelar que
// existe. Cada URL emitida queda en `registro_accesos` (core/archivos).

const { esUuid, tieneRelacion } = require('../../core/acceso');
const { urlFirmada } = require('../../core/archivos');
const { noEncontrado } = require('../../core/errores');
const { ROLES } = require('../../core/estados/constantes');

const modelos = () => require('../../models');

const tiene = (usuario, ...permisos) => permisos.some((p) => usuario?.permisos?.has(p));

/** ¿El voluntario tiene una asignación activa en algún caso del niño? */
async function voluntarioDelNino(usuario, pacienteId) {
  const { sequelize } = modelos();
  const [fila] = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1 FROM asignaciones a JOIN solicitudes s ON s.id = a.solicitud_id
        WHERE a.voluntario_id = :usuarioId AND a.activa AND s.paciente_id = :pacienteId
     ) AS existe`,
    { replacements: { usuarioId: usuario.id, pacienteId }, type: sequelize.QueryTypes.SELECT },
  );
  return fila.existe === true;
}

/** Familia vinculada al niño (sin depender del rol del usuario). */
async function familiaDelNino(usuario, pacienteId) {
  const { sequelize } = modelos();
  const [fila] = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1 FROM paciente_tutor pt JOIN tutores t ON t.id = pt.tutor_id
        WHERE t.usuario_id = :usuarioId AND pt.paciente_id = :pacienteId
     ) AS existe`,
    { replacements: { usuarioId: usuario.id, pacienteId }, type: sequelize.QueryTypes.SELECT },
  );
  return fila.existe === true;
}

/**
 * Dueño del archivo y si el usuario puede abrirlo.
 * @returns {Promise<{ permitido: boolean, solicitudId?: string | null, recurso?: string }>}
 */
async function resolverDueno(usuario, archivoId) {
  const { DocumentoPagina, Paciente, Mensaje, PaquetePdf, PlantillaFormulario, Solicitud } =
    modelos();

  // Página de un documento: familia vinculada, voluntario asignado o coordinador.
  const pagina = await DocumentoPagina.findOne({
    where: { archivoId },
    include: [{ association: 'documento', attributes: ['id', 'solicitudId'] }],
  });
  if (pagina) {
    const solicitud = await Solicitud.findByPk(pagina.documento.solicitudId);
    const permitido = tiene(usuario, 'solicitud.leer') && (await tieneRelacion(usuario, solicitud));
    return { permitido, solicitudId: solicitud.id, recurso: 'documento' };
  }

  // Foto del niño: familia vinculada, coordinador o voluntario asignado a un caso del niño.
  const paciente = await Paciente.findOne({ where: { fotoArchivoId: archivoId } });
  if (paciente) {
    let permitido = false;
    if (usuario.rol === ROLES.COORDINADOR) permitido = tiene(usuario, 'paciente.leer');
    else if (usuario.rol === ROLES.FAMILIA)
      permitido = tiene(usuario, 'paciente.leer') && (await familiaDelNino(usuario, paciente.id));
    else if (usuario.rol === ROLES.VOLUNTARIO)
      permitido =
        tiene(usuario, 'solicitud.leer') && (await voluntarioDelNino(usuario, paciente.id));
    return { permitido, solicitudId: null, recurso: 'archivo' };
  }

  // Adjunto del chat: solo los participantes (familia vinculada y coordinadores, `mensaje.enviar`).
  const mensaje = await Mensaje.findOne({ where: { archivoId } });
  if (mensaje) {
    const solicitud = await Solicitud.findByPk(mensaje.solicitudId);
    const permitido = tiene(usuario, 'mensaje.enviar') && (await tieneRelacion(usuario, solicitud));
    return { permitido, solicitudId: solicitud.id, recurso: 'archivo' };
  }

  // Paquete PDF: solo el coordinador.
  const paquete = await PaquetePdf.findOne({ where: { archivoId } });
  if (paquete) {
    const permitido = usuario.rol === ROLES.COORDINADOR && tiene(usuario, 'paquete.generar');
    return { permitido, solicitudId: paquete.solicitudId, recurso: 'paquete' };
  }

  // PDF de una plantilla oficial (sin datos de pacientes): personal y administrador.
  const plantilla = await PlantillaFormulario.findOne({ where: { archivoPdfId: archivoId } });
  if (plantilla) {
    const permitido = tiene(usuario, 'admin.plantillas', 'paquete.generar', 'ocr.revisar');
    return { permitido, solicitudId: null, recurso: 'archivo' };
  }

  return { permitido: false };
}

/**
 * URL firmada de 5 minutos del archivo, si el usuario puede abrirlo.
 * @param {{ id: string, rol: string, permisos: Set<string> }} usuario
 * @param {string} archivoId
 * @returns {Promise<{ url: string, expiraEn: string }>}
 */
async function urlDeArchivo(usuario, archivoId) {
  if (!esUuid(archivoId)) throw noEncontrado();
  const { Archivo } = modelos();
  const archivo = await Archivo.findByPk(archivoId);
  if (!archivo) throw noEncontrado();
  const { permitido, solicitudId, recurso } = await resolverDueno(usuario, archivo.id);
  if (!permitido) throw noEncontrado();
  return urlFirmada({ archivo, solicitudId, recurso });
}

module.exports = { urlDeArchivo };
