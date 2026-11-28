'use strict';

// Trabajo "notificacion.push" { notificacionId } (agente 12).
//
// Envía la notificación a los dispositivos del usuario si la preferencia de push de su categoría
// está encendida. El push lleva solo título, cuerpo (textos de core/notificaciones, sin datos
// médicos) y `data: { tipo, enlace, notificacionId }`; el detalle se ve dentro de la app.
// Borra los dispositivos con token inválido, marca `enviada_push_en` al llegar a al menos uno y no
// reenvía en un reintento. El log no lleva textos de la notificación.

const { PLANTILLAS, CATEGORIAS } = require('../../../core/notificaciones');
const { obtenerProveedor, TOKEN_INVALIDO } = require('../push');

const modelos = () => require('../../../models');

class ErrorPush extends Error {
  constructor(codigo) {
    super(codigo);
    this.name = 'ErrorPush';
    this.codigo = codigo;
  }
}

/** Categoría de la notificación para las preferencias (pantalla 06). */
const categoriaDe = (n) =>
  n.datos?.categoria ?? PLANTILLAS[n.tipo]?.categoria ?? CATEGORIAS.ESTADOS;

/**
 * @param {{ notificacionId: string }} datos
 * @param {{ trabajo: object, logger: import('pino').Logger }} contexto
 */
module.exports = async function enviarPush({ notificacionId }, { logger }) {
  const { Notificacion, Usuario, Preferencia, Dispositivo } = modelos();
  const notificacion = await Notificacion.findByPk(notificacionId);
  if (!notificacion || notificacion.enviadaPushEn) return; // no existe o ya salió (reintento)

  const usuario = await Usuario.findByPk(notificacion.usuarioId, { attributes: ['id', 'estado'] });
  if (usuario?.estado !== 'activo') return;

  const categoria = categoriaDe(notificacion);
  const preferencia = await Preferencia.findOne({ where: { usuarioId: usuario.id } });
  if (preferencia?.notificaciones?.push?.[categoria] === false) return;

  const dispositivos = await Dispositivo.findAll({ where: { usuarioId: usuario.id } });
  if (!dispositivos.length) return;

  const resultados = await obtenerProveedor().enviar({
    tokens: dispositivos.map((d) => d.tokenFcm),
    titulo: notificacion.titulo,
    cuerpo: notificacion.cuerpo,
    datos: {
      tipo: notificacion.tipo,
      enlace: String(notificacion.datos?.enlace ?? 'notificaciones'),
      notificacionId: notificacion.id,
    },
  });

  const invalidos = resultados.filter((r) => !r.ok && TOKEN_INVALIDO.has(r.error));
  if (invalidos.length) {
    await Dispositivo.destroy({
      where: { usuarioId: usuario.id, tokenFcm: invalidos.map((r) => r.token) },
    });
  }
  const enviados = resultados.filter((r) => r.ok).length;
  const temporales = resultados.length - enviados - invalidos.length;
  if (enviados) {
    await Notificacion.update(
      { enviadaPushEn: new Date() },
      { where: { id: notificacion.id, enviadaPushEn: null } },
    );
  }
  logger.info(
    { notificacionId, categoria, enviados, invalidos: invalidos.length, temporales },
    'Push de notificación',
  );
  // Sin ningún envío y con errores temporales: el trabajo falla para que la cola lo reintente.
  if (!enviados && temporales) throw new ErrorPush('PUSH_NO_ENVIADO');
};
