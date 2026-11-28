'use strict';

// Chat por caso entre la familia y el equipo (31). Es el canal autorizado: los mensajes no se
// editan ni se borran y quedan en el historial del expediente. El cuerpo nunca va a logs ni a la
// bitácora (solo que existió un mensaje).

const { Op } = require('sequelize');
const {
  obtenerSolicitudConAcceso,
  usuariosFamiliaDe,
  coordinadoresDe,
} = require('../../core/acceso');
const { guardarArchivo } = require('../../core/archivos');
const { registrarBitacora } = require('../../core/auditoria');
const { notificar } = require('../../core/notificaciones');
const { ROLES } = require('../../core/estados/constantes');
const errores = require('./comunicacion.errores');
const { PARTICIPANTES_CHAT, ETIQUETA_EQUIPO, ladoDe } = require('./chat');

const modelos = () => require('../../models');

const iso = (f) => (f ? new Date(f).toISOString() : null);
const idiomaDe = (usuario) => (usuario?.idioma === 'en' ? 'en' : 'es');

/** Subconsulta fija (sin datos del usuario): ids de las cuentas con rol familia. */
const AUTORES_FAMILIA = `(SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.codigo = '${ROLES.FAMILIA}')`;

/** `where` de los mensajes escritos por el otro lado del chat. */
function delOtroLado(usuario) {
  const { sequelize } = modelos();
  const familia = sequelize.literal(AUTORES_FAMILIA);
  return ladoDe(usuario.rol) === 'familia'
    ? { autorId: { [Op.notIn]: familia } }
    : { autorId: { [Op.in]: familia } };
}

/** Solo los participantes del chat; la relación con el caso la revisa core/acceso (404). */
async function casoDelChat(usuario, solicitudId, opciones = {}) {
  if (!PARTICIPANTES_CHAT.includes(usuario.rol)) throw errores.noParticipa();
  return obtenerSolicitudConAcceso(usuario, solicitudId, opciones);
}

/**
 * Autor tal como lo ve quien lee: ante la familia, el personal es "Coordinador del caso / Equipo
 * Vanguardia", sin nombre; el personal ve el nombre de quien escribió.
 */
function autorPara(lector, autor) {
  const lado = ladoDe(autor?.rol?.codigo);
  if (lado === 'equipo' && ladoDe(lector.rol) === 'familia') {
    return { tipo: 'equipo', etiqueta: ETIQUETA_EQUIPO[idiomaDe(lector)] };
  }
  return {
    tipo: lado,
    id: autor?.id ?? null,
    nombre: autor ? [autor.nombres, autor.apellidos].filter(Boolean).join(' ') : null,
  };
}

function formatear(mensaje, lector) {
  return {
    id: mensaje.id,
    autor: autorPara(lector, mensaje.autor),
    cuerpo: mensaje.cuerpo ?? null,
    archivo: mensaje.archivo ? { id: mensaje.archivo.id, mime: mensaje.archivo.mime } : null,
    creadoEn: iso(mensaje.createdAt),
    leidoEn: iso(mensaje.leidoEn),
    esMio: mensaje.autorId === lector.id,
  };
}

const INCLUIR = [
  {
    association: 'autor',
    attributes: ['id', 'nombres', 'apellidos'],
    include: [{ association: 'rol', attributes: ['codigo'] }],
  },
  { association: 'archivo', attributes: ['id', 'mime'] },
];

/** Mensaje de la solicitud usado como cursor; si no es de este caso → 400. */
async function mensajeDelCaso(solicitudId, mensajeId, campo, transaction) {
  const { Mensaje } = modelos();
  const mensaje = await Mensaje.findOne({ where: { id: mensajeId, solicitudId }, transaction });
  if (!mensaje) throw errores.mensajeAjeno(campo);
  return mensaje;
}

/** Mensajes anteriores (o iguales, con `incluir`) al cursor, por fecha y luego por id. */
const hastaCursor = (cursor, incluir = false) => ({
  [Op.or]: [
    { createdAt: { [Op.lt]: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { [incluir ? Op.lte : Op.lt]: cursor.id } },
  ],
});

/**
 * Mensajes del caso, del más reciente al más antiguo. `antesDe` (id de un mensaje) pide la página
 * siguiente: `siguiente` es el cursor para la próxima, o null si no hay más.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 * @param {{ antesDe?: string, limit: number }} filtros
 */
async function listar(usuario, solicitudId, { antesDe, limit }) {
  const { Mensaje } = modelos();
  const solicitud = await casoDelChat(usuario, solicitudId);
  const where = { solicitudId: solicitud.id };
  if (antesDe)
    Object.assign(where, hastaCursor(await mensajeDelCaso(solicitud.id, antesDe, 'antesDe')));

  const filas = await Mensaje.findAll({
    where,
    include: INCLUIR,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: limit + 1,
  });
  const pagina = filas.slice(0, limit);
  const noLeidos = await Mensaje.count({
    where: { solicitudId: solicitud.id, leidoEn: null, ...delOtroLado(usuario) },
  });
  return {
    datos: pagina.map((m) => formatear(m, usuario)),
    siguiente: filas.length > limit ? pagina.at(-1).id : null,
    noLeidos,
  };
}

/**
 * Envía un mensaje (texto, adjunto o ambos) y avisa `MENSAJE_NUEVO` a la otra parte: si escribe
 * la familia, al coordinador del caso (o a todos si no tiene); si escribe el personal, a la familia.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 * @param {{ cuerpo?: string }} cuerpo
 * @param {Buffer | undefined} adjunto
 */
async function enviar(usuario, solicitudId, { cuerpo }, adjunto) {
  const texto = cuerpo?.trim() ? cuerpo.trim() : null;
  if (!texto && !adjunto?.length) throw errores.vacio();
  const { sequelize, Mensaje } = modelos();

  const id = await sequelize.transaction(async (transaction) => {
    const solicitud = await casoDelChat(usuario, solicitudId, { transaction });
    const archivo = adjunto?.length
      ? await guardarArchivo({ buffer: adjunto, prefijo: 'mensajes', transaction })
      : null;
    const mensaje = await Mensaje.create(
      {
        solicitudId: solicitud.id,
        autorId: usuario.id,
        cuerpo: texto,
        archivoId: archivo?.id ?? null,
      },
      { transaction },
    );
    // Sin el cuerpo: solo que existió un mensaje.
    await registrarBitacora({
      accion: 'mensaje.enviar',
      entidad: 'mensajes',
      entidadId: mensaje.id,
      solicitudId: solicitud.id,
      despues: { conTexto: Boolean(texto), conAdjunto: Boolean(archivo) },
      transaction,
    });
    const destinatarios =
      ladoDe(usuario.rol) === 'familia'
        ? await coordinadoresDe(solicitud, { transaction })
        : await usuariosFamiliaDe(solicitud.id, { transaction });
    await notificar({
      usuarioIds: destinatarios.filter((d) => d !== usuario.id),
      tipo: 'MENSAJE_NUEVO',
      variables: { codigo: solicitud.codigo, solicitudId: solicitud.id },
      solicitudId: solicitud.id,
      transaction,
    });
    return mensaje.id;
  });

  return formatear(await Mensaje.findByPk(id, { include: INCLUIR }), usuario);
}

/**
 * Marca como leídos los mensajes de la otra parte hasta `hastaId` (incluido). Los propios no
 * cambian; los ya leídos conservan su fecha.
 * @returns {Promise<{ marcados: number, noLeidos: number }>}
 */
async function marcarLeidos(usuario, solicitudId, { hastaId }) {
  const { sequelize, Mensaje } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await casoDelChat(usuario, solicitudId, { transaction });
    const cursor = await mensajeDelCaso(solicitud.id, hastaId, 'hastaId', transaction);
    const otroLado = delOtroLado(usuario);
    const [marcados] = await Mensaje.update(
      { leidoEn: new Date() },
      {
        where: {
          solicitudId: solicitud.id,
          leidoEn: null,
          ...otroLado,
          ...hastaCursor(cursor, true),
        },
        transaction,
      },
    );
    const noLeidos = await Mensaje.count({
      where: { solicitudId: solicitud.id, leidoEn: null, ...otroLado },
      transaction,
    });
    return { marcados, noLeidos };
  });
}

module.exports = { listar, enviar, marcarLeidos };
