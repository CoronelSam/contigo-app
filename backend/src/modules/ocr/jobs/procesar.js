'use strict';

// Trabajo "ocr.procesar" { extraccionId } (agente 07).
//
// en_cola → procesando → por_confirmar, o fallida con un código. Página por página: descarga,
// motor de OCR, progreso y revisión de la cancelación. Al final, en una transacción, reemplaza los
// campos `propuesto` (reintento seguro) y deja la extracción lista para la revisión humana.
// Nunca registra en el log valores leídos ni mensajes de error que puedan contener datos.

const { emitirTrasCommit, EVENTOS } = require('../../../core/eventos');
const almacenamiento = require('../../../core/almacenamiento');
const { esquemaZonasOcr } = require('../zonas');
const { obtenerMotor } = require('../motores');

const modelos = () => require('../../../models');

class ErrorOcr extends Error {
  constructor(codigo) {
    super(codigo);
    this.name = 'ErrorOcr';
    this.codigo = codigo;
  }
}

async function leerBuffer(clave) {
  try {
    const flujo = await almacenamiento.leerObjeto(clave);
    const partes = [];
    for await (const parte of flujo) partes.push(Buffer.from(parte));
    return Buffer.concat(partes);
  } catch {
    throw new ErrorOcr('PAGINA_NO_DISPONIBLE');
  }
}

async function estadoActual(extraccionId) {
  const { Extraccion } = modelos();
  return (await Extraccion.findByPk(extraccionId, { attributes: ['estado'] }))?.estado ?? null;
}

const redondear = (n) => Math.round(n * 1000) / 1000;
const acotar = (n) => Math.max(0, Math.min(1, Number(n) || 0));

/**
 * @param {{ extraccionId: string }} datos
 * @param {{ trabajo: object, logger: import('pino').Logger }} contexto
 */
module.exports = async function procesarOcr({ extraccionId }, { logger }) {
  const { sequelize, Extraccion, CampoExtraido, DocumentoPagina } = modelos();

  // Solo desde en_cola (o procesando, si un intento anterior se cortó).
  const [tomada] = await Extraccion.update(
    { estado: 'procesando', error: null },
    { where: { id: extraccionId, estado: ['en_cola', 'procesando'] } },
  );
  if (!tomada) return;

  const motor = obtenerMotor();
  try {
    const extraccion = await Extraccion.findByPk(extraccionId, {
      include: [{ association: 'plantilla' }, { association: 'documento' }],
    });
    const zonasValidas = esquemaZonasOcr.safeParse(extraccion.plantilla?.zonasOcr ?? []);
    if (!zonasValidas.success || !zonasValidas.data.length) throw new ErrorOcr('ZONAS_INVALIDAS');
    const zonas = zonasValidas.data;

    const paginas = await DocumentoPagina.findAll({
      where: { documentoId: extraccion.documentoId },
      include: [{ association: 'archivo', attributes: ['clave', 'mime'] }],
      order: [['orden', 'ASC']],
    });

    const leidos = [];
    const crudo = [];
    for (const [i, pagina] of paginas.entries()) {
      if ((await estadoActual(extraccionId)) !== 'procesando') return; // cancelada
      const numero = pagina.orden;
      const deLaPagina = zonas.filter((z) => z.pagina === numero);
      if (deLaPagina.length) {
        const buffer = await leerBuffer(pagina.archivo.clave);
        const r = await motor.procesar({
          paginas: [{ numero, buffer, mime: pagina.archivo.mime }],
          zonas: deLaPagina,
        });
        leidos.push(...r.campos);
        crudo.push({ pagina: numero, crudo: r.crudo });
      }
      // El último 5 % queda para guardar los campos.
      await Extraccion.update(
        { progreso: Math.round(((i + 1) / paginas.length) * 95) },
        { where: { id: extraccionId, estado: 'procesando' } },
      );
    }

    // Toda zona produce un campo: si su página no se capturó, queda vacío y dudoso.
    const campos = zonas.map((z) => {
      const leido = leidos.find((c) => c.campo === z.campo);
      return {
        extraccionId,
        campo: z.campo,
        seccion: z.seccion,
        rutaDato: z.rutaDato,
        tipo: z.tipo,
        valorLeido: leido?.valor ?? null,
        confianza: redondear(acotar(leido?.confianza)),
        pagina: z.pagina,
        coordenadas: z.caja,
        estado: 'propuesto',
      };
    });
    const promedio = campos.reduce((s, c) => s + c.confianza, 0) / campos.length;

    await sequelize.transaction(async (transaction) => {
      const actual = await Extraccion.findByPk(extraccionId, {
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (actual.estado !== 'procesando') return; // cancelada mientras tanto
      await CampoExtraido.destroy({ where: { extraccionId, estado: 'propuesto' }, transaction });
      await CampoExtraido.bulkCreate(campos, { transaction });
      await actual.update(
        {
          estado: 'por_confirmar',
          progreso: 100,
          motor: motor.nombre,
          confianzaPromedio: redondear(promedio),
          respuestaCruda: { motor: motor.nombre, zonas, paginas: crudo },
        },
        { transaction },
      );
      emitirTrasCommit(transaction, EVENTOS.EXTRACCION_LISTA_PARA_REVISION, {
        extraccionId,
        documentoId: actual.documentoId,
        solicitudId: extraccion.documento.solicitudId,
      });
    });
  } catch (err) {
    const codigo =
      err.codigo ?? (err.name === 'NoImplementado' ? 'MOTOR_NO_DISPONIBLE' : 'ERROR_MOTOR');
    // Sin el mensaje del error: puede traer texto leído.
    logger.error({ extraccionId, codigo, tipoError: err.name }, 'OCR fallido');
    await Extraccion.update(
      { estado: 'fallida', error: codigo },
      { where: { id: extraccionId, estado: 'procesando' } },
    );
  }
};
