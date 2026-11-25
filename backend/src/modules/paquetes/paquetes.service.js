'use strict';

// Paquete PDF para Shriners (47, 48): solicitar la generación en cola, consultar el estado, ver
// una página y compartir el paquete final con un enlace firmado tras confirmar la revisión.

const { obtenerSolicitudConAcceso } = require('../../core/acceso');
const { estadoExpediente } = require('../../core/expediente');
const { ESTADOS_SOLICITUD: E, ETAPAS, RUTAS } = require('../../core/estados/constantes');
const cola = require('../../core/cola');
const T = require('../../core/cola/trabajos');
const almacenamiento = require('../../core/almacenamiento');
const { registrarBitacora, registrarAcceso } = require('../../core/auditoria');
const { urlFirmada } = require('../../core/archivos');
const { noEncontrado } = require('../../core/errores');
const { config } = require('../../config/env');
const errores = require('./paquetes.errores');
const pdf = require('./pdf');
const { leerBytes } = require('./generador');
const { iso, usuariosBreves } = require('./paquetes.util');

const modelos = () => require('../../models');

const RUTAS_EXTERIOR = Object.freeze([RUTAS.MEXICO, RUTAS.INTERNACIONAL]);

/** ¿Se puede generar un borrador con la solicitud en este estado? */
const borradorPermitido = (s) =>
  s.estado === E.PAQUETE_EXTERIOR ||
  s.estado === E.COMPLETA ||
  (s.estado === E.EN_REVISION && s.etapa === ETAPAS.PAQUETE);

/** Clave del PDF de una sola página en el almacenamiento (caché de la vista previa). */
const clavePagina = (paqueteId, n) => `paquetes/paginas/${paqueteId}/${n}.pdf`;

/**
 * Formato de salida de un paquete.
 * @param {object} p Fila de `paquetes_pdf`.
 * @param {Function} usuario Resultado de usuariosBreves.
 */
function formatear(p, usuario) {
  const usadas = Array.isArray(p.plantillasUsadas) ? p.plantillasUsadas : [];
  return {
    id: p.id,
    solicitudId: p.solicitudId,
    paquete: p.paquete,
    tipo: p.tipo,
    estado: p.estado,
    progreso: p.progreso,
    numeroPaginas: p.numeroPaginas ?? null,
    plantillas: usadas
      .filter((u) => u.tipo === 'plantilla')
      .map((u) => ({
        id: u.id,
        codigo: u.codigo,
        nombre: u.nombre ?? null,
        version: u.version,
        paginas: u.paginas,
      })),
    anexos: usadas
      .filter((u) => u.tipo === 'anexo')
      .map((u) => ({
        documentoId: u.documentoId,
        codigo: u.codigo,
        version: u.version ?? null,
        paginas: u.paginas,
      })),
    avisos: Array.isArray(p.avisos) ? p.avisos : [],
    error: p.error ?? null,
    generadoPor: usuario(p.generadoPor),
    revision: p.revisadoEn
      ? { revisadoPor: usuario(p.revisadoPor), revisadoEn: iso(p.revisadoEn) }
      : null,
    creadoEn: iso(p.createdAt),
  };
}

/** Carga el paquete si el usuario tiene relación con su solicitud; si no, 404. */
async function paqueteConAcceso(usuario, paqueteId, { transaction, lock } = {}) {
  const { PaquetePdf } = modelos();
  const paquete = await PaquetePdf.findByPk(paqueteId, { transaction, lock });
  if (!paquete) throw noEncontrado();
  await obtenerSolicitudConAcceso(usuario, paquete.solicitudId, { transaction });
  return paquete;
}

/**
 * Crea el paquete `en_cola` y encola su generación.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {{ tipo: 'borrador' | 'final' }} cuerpo
 */
async function solicitarPaquete(usuario, solicitudId, { tipo }) {
  const { sequelize, PaquetePdf, PlantillaFormulario } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!RUTAS_EXTERIOR.includes(solicitud.rutaDecidida) || !solicitud.paquete) {
      throw errores.noAplica();
    }
    if (tipo === 'borrador') {
      if (!borradorPermitido(solicitud)) throw errores.estadoNoPermitido(tipo, solicitud.estado);
    } else {
      if (solicitud.estado !== E.COMPLETA) throw errores.estadoNoPermitido(tipo, solicitud.estado);
      const expediente = await estadoExpediente(solicitud.id, { transaction });
      if (!expediente.listoParaConfirmar) throw errores.faltantes(expediente.faltantes);
    }
    const activas = await PlantillaFormulario.count({
      where: { paquete: solicitud.paquete, activa: true },
      transaction,
    });
    if (!activas) throw errores.sinPlantillas();

    const paquete = await PaquetePdf.create(
      { solicitudId, paquete: solicitud.paquete, tipo, estado: 'en_cola', generadoPor: usuario.id },
      { transaction },
    );
    await registrarBitacora({
      accion: 'paquete.solicitar',
      entidad: 'paquetes_pdf',
      entidadId: paquete.id,
      solicitudId,
      despues: { tipo, paquete: paquete.paquete },
      transaction,
    });
    await cola.encolarTrasCommit(transaction, T.PAQUETE_GENERAR, { paqueteId: paquete.id });
    return {
      id: paquete.id,
      solicitudId,
      paquete: paquete.paquete,
      tipo,
      estado: 'en_cola',
    };
  });
}

/** Estado, plantillas y anexos incluidos, avisos y revisión del paquete. */
async function obtenerPaquete(usuario, paqueteId) {
  const paquete = await paqueteConAcceso(usuario, paqueteId);
  const usuarioDe = await usuariosBreves([paquete.generadoPor, paquete.revisadoPor]);
  return formatear(paquete, usuarioDe);
}

/**
 * URL firmada de un PDF con la página `n` del paquete. La página se extrae una vez y queda en
 * caché en el almacenamiento.
 */
async function pagina(usuario, paqueteId, n) {
  const { Archivo } = modelos();
  const paquete = await paqueteConAcceso(usuario, paqueteId);
  if (paquete.estado !== 'listo') throw errores.noListo();
  if (n > paquete.numeroPaginas) throw errores.paginaFueraDeRango();

  const clave = clavePagina(paquete.id, n);
  if (!(await almacenamiento.existeObjeto(clave))) {
    const archivo = await Archivo.findByPk(paquete.archivoId);
    const bytes = await leerBytes(archivo.clave, 'PAQUETE_NO_DISPONIBLE');
    const una = await pdf.extraerPagina(bytes, n);
    await almacenamiento.subirObjeto({ clave, cuerpo: Buffer.from(una), mime: 'application/pdf' });
  }
  await registrarAcceso({
    solicitudId: paquete.solicitudId,
    recurso: 'paquete',
    recursoId: paquete.id,
  });
  const segundos = config().almacenamiento.urlFirmadaSegundos;
  const url = await almacenamiento.urlFirmadaGet(clave, segundos);
  return {
    pagina: n,
    numeroPaginas: paquete.numeroPaginas,
    url,
    expiraEn: new Date(Date.now() + segundos * 1000).toISOString(),
  };
}

/**
 * Confirma la revisión del paquete final y devuelve un enlace firmado de PAQUETE_ENLACE_MINUTOS.
 */
async function enlace(usuario, paqueteId) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const paquete = await paqueteConAcceso(usuario, paqueteId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (paquete.tipo !== 'final') throw errores.noFinal();
    if (paquete.estado !== 'listo') throw errores.noListo();

    const antes = { revisadoPor: paquete.revisadoPor, revisadoEn: paquete.revisadoEn };
    await paquete.update({ revisadoPor: usuario.id, revisadoEn: new Date() }, { transaction });
    await registrarBitacora({
      accion: 'paquete.revisar',
      entidad: 'paquetes_pdf',
      entidadId: paquete.id,
      solicitudId: paquete.solicitudId,
      antes,
      despues: { revisadoPor: paquete.revisadoPor, revisadoEn: paquete.revisadoEn },
      transaction,
    });
    const { url, expiraEn } = await urlFirmada({
      archivoId: paquete.archivoId,
      solicitudId: paquete.solicitudId,
      recurso: 'paquete',
      segundos: config().paquetes.enlaceMinutos * 60,
      transaction,
    });
    const usuarioDe = await usuariosBreves([paquete.revisadoPor], transaction);
    return {
      url,
      expiraEn,
      revision: {
        revisadoPor: usuarioDe(paquete.revisadoPor),
        revisadoEn: iso(paquete.revisadoEn),
      },
    };
  });
}

module.exports = { solicitarPaquete, obtenerPaquete, pagina, enlace, clavePagina };
