'use strict';

// Trabajo "paquete.generar" { paqueteId } (agente 11).
//
// en_cola → generando → listo, o fallido con un código. Arma el PDF (generador.js), lo guarda con
// core/archivos y deja número de páginas, plantillas y anexos usados y avisos. Nunca registra en
// el log datos del caso ni mensajes de error que puedan contenerlos.

const { guardarArchivo } = require('../../../core/archivos');
const { config } = require('../../../config/env');
const { generar } = require('../generador');

const modelos = () => require('../../../models');

/**
 * @param {{ paqueteId: string }} datos
 * @param {{ trabajo: object, logger: import('pino').Logger }} contexto
 */
module.exports = async function generarPaquete({ paqueteId }, { logger }) {
  const { sequelize, PaquetePdf } = modelos();

  // Solo desde en_cola (o generando, si un intento anterior se cortó).
  const [tomado] = await PaquetePdf.update(
    { estado: 'generando', progreso: 0, error: null },
    { where: { id: paqueteId, estado: ['en_cola', 'generando'] } },
  );
  if (!tomado) return;

  try {
    const paquete = await PaquetePdf.findByPk(paqueteId);
    const resultado = await generar(paquete, {
      alAvanzar: (progreso) =>
        PaquetePdf.update({ progreso }, { where: { id: paqueteId, estado: 'generando' } }),
    });
    await sequelize.transaction(async (transaction) => {
      const archivo = await guardarArchivo({
        buffer: Buffer.from(resultado.bytes),
        prefijo: 'paquetes',
        tipos: ['application/pdf'],
        maxBytes: config().paquetes.maxBytes,
        transaction,
      });
      await PaquetePdf.update(
        {
          estado: 'listo',
          progreso: 100,
          archivoId: archivo.id,
          numeroPaginas: resultado.numeroPaginas,
          plantillasUsadas: resultado.plantillasUsadas,
          avisos: resultado.avisos,
        },
        { where: { id: paqueteId, estado: 'generando' }, transaction },
      );
    });
  } catch (err) {
    const codigo = err.codigo ?? 'ERROR_GENERACION';
    // Sin el mensaje del error: puede traer datos del caso.
    logger.error({ paqueteId, codigo, tipoError: err.name }, 'Paquete PDF fallido');
    await PaquetePdf.update(
      { estado: 'fallido', error: String(codigo).slice(0, 100) },
      { where: { id: paqueteId, estado: 'generando' } },
    );
  }
};
