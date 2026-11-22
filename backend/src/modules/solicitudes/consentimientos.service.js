'use strict';

// Consentimientos (20). La familia abre el texto completo antes de decidir y el backend lo
// registra. Se guardan la decisión, el texto (versión e idioma), quién, cuándo, IP y dispositivo.
// La app nunca firma: si el tipo requiere firma, queda pendiente hasta que la hoja firmada se
// valida como documento.

const { Op } = require('sequelize');
const { obtenerSolicitudConAcceso, exigirEdicion } = require('../../core/acceso');
const { registrarBitacora, auditarCambio } = require('../../core/auditoria');
const { TIPOS_CONSENTIMIENTO } = require('../../core/expediente');
const { ESTADOS_DOCUMENTO: D } = require('../../core/estados/constantes');
const contexto = require('../../core/contexto');
const { validacion } = require('../../core/errores');
const { logger } = require('../../core/logger');
const errores = require('./solicitudes.errores');
const { documentoDeLaSolicitud } = require('./profesional.service');
const { iso, leerConfiguracion, filaBloqueada } = require('./solicitudes.util');

/** Tipo de documento de la hoja firmada de cada consentimiento. */
const TIPO_DOCUMENTO_FIRMADO = Object.freeze({
  divulgacion_informacion_medica: 'consentimiento_divulgacion_firmado',
  marketing: 'consentimiento_marketing_firmado',
  telesalud: 'consentimiento_telesalud_firmado',
  condiciones_atencion: 'consentimiento_condiciones_firmado',
});

const modelos = () => require('../../models');

async function tiposConFirma(transaction) {
  const valor = await leerConfiguracion(
    'consentimientos.requieren_firma',
    TIPOS_CONSENTIMIENTO,
    transaction,
  );
  return new Set(Array.isArray(valor) ? valor : TIPOS_CONSENTIMIENTO);
}

/**
 * Estado de la firma tras una decisión. Solo se firma lo que se acepta y está en
 * `consentimientos.requieren_firma`; queda `firmado` cuando la hoja firmada está VALIDADO.
 */
function estadoFirmaDe({ tipo, decision, documento }, conFirma) {
  if (decision !== 'acepta' || !conFirma.has(tipo)) return 'no_aplica';
  return documento?.estado === D.VALIDADO ? 'firmado' : 'pendiente';
}

/** Última versión de cada tipo en ese idioma, ya vigente. */
async function ultimasVersiones({ idioma, tipo, transaction } = {}) {
  const { TextoConsentimiento } = modelos();
  const textos = await TextoConsentimiento.findAll({
    where: {
      ...(idioma ? { idioma } : {}),
      ...(tipo ? { tipo } : {}),
      vigenteDesde: { [Op.lte]: new Date() },
    },
    order: [['version', 'DESC']],
    transaction,
  });
  const porClave = new Map();
  for (const t of textos) {
    const clave = `${t.tipo}:${t.idioma}`;
    if (!porClave.has(clave)) porClave.set(clave, t);
  }
  return [...porClave.values()];
}

/** El texto es la última versión vigente de su tipo en su idioma. */
async function exigirVigente(texto, transaction) {
  const [ultima] = await ultimasVersiones({ idioma: texto.idioma, tipo: texto.tipo, transaction });
  if (!ultima || ultima.id !== texto.id) throw errores.textoNoVigente();
}

/**
 * GET /consentimientos/textos: el texto vigente de cada tipo en el idioma pedido.
 * @param {'es' | 'en'} idioma
 */
async function textosVigentes(idioma) {
  const [textos, conFirma] = await Promise.all([ultimasVersiones({ idioma }), tiposConFirma()]);
  const orden = (t) => TIPOS_CONSENTIMIENTO.indexOf(t.tipo);
  return textos
    .sort((a, b) => orden(a) - orden(b))
    .map((t) => ({
      id: t.id,
      tipo: t.tipo,
      version: t.version,
      idioma: t.idioma,
      titulo: t.titulo,
      cuerpo: t.cuerpo,
      vigenteDesde: iso(t.vigenteDesde),
      obligatorio: true,
      requiereFirma: conFirma.has(t.tipo),
    }));
}

/**
 * POST /consentimientos/textos/:id/abierto: la familia abrió el texto completo.
 *
 * Si ya había una decisión sobre OTRO texto (otra versión u otro idioma), se anula: una decisión
 * siempre corresponde al texto guardado en la misma fila, y el nuevo texto exige decidir de nuevo.
 *
 * @param {{ id: string, rol: string }} usuario
 * @param {string} textoId
 * @param {{ solicitudId: string }} cuerpo
 */
async function registrarApertura(usuario, textoId, { solicitudId }) {
  const { sequelize, TextoConsentimiento, Consentimiento } = modelos();
  return sequelize.transaction(async (transaction) => {
    const texto = await TextoConsentimiento.findByPk(textoId, { transaction });
    if (!texto) throw errores.textoNoEncontrado();
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, { transaction });
    await exigirEdicion(usuario, solicitud, { seccion: 'consentimientos', transaction });
    await exigirVigente(texto, transaction);

    const fila = await filaBloqueada(
      Consentimiento,
      { solicitudId: solicitud.id, tipo: texto.tipo },
      transaction,
    );
    const anulaDecision = Boolean(fila.decision) && fila.textoId !== texto.id;
    const antes = { textoId: fila.textoId, decision: fila.decision };
    await fila.update(
      {
        textoId: texto.id,
        textoAbiertoEn: new Date(),
        ...(anulaDecision
          ? {
              decision: null,
              decididoPor: null,
              decididoEn: null,
              estadoFirma: 'pendiente',
              documentoFirmadoId: null,
            }
          : {}),
      },
      { transaction },
    );
    await registrarBitacora({
      accion: 'consentimientos.abrir_texto',
      entidad: 'consentimientos',
      entidadId: fila.id,
      solicitudId: solicitud.id,
      antes,
      despues: {
        textoId: fila.textoId,
        decision: fila.decision,
        textoVersion: texto.version,
        textoIdioma: texto.idioma,
      },
      transaction,
    });
    return {
      tipo: fila.tipo,
      textoId: fila.textoId,
      textoAbiertoEn: iso(fila.textoAbiertoEn),
      decision: fila.decision ?? null,
    };
  });
}

/**
 * PUT /solicitudes/:id/consentimientos/:tipo: decisión de la familia.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {string} tipo
 * @param {{ decision: 'acepta' | 'no_acepta', textoId: string, documentoFirmadoId?: string | null }} cuerpo
 */
async function decidir(usuario, solicitudId, tipo, { decision, textoId, documentoFirmadoId }) {
  const { sequelize, TextoConsentimiento, Consentimiento, Documento } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, { transaction });
    await exigirEdicion(usuario, solicitud, { seccion: 'consentimientos', transaction });

    const texto = await TextoConsentimiento.findByPk(textoId, { transaction });
    if (!texto || texto.tipo !== tipo) throw validacion({ textoId: 'NO_CORRESPONDE' });
    await exigirVigente(texto, transaction);

    const fila = await Consentimiento.findOne({
      where: { solicitudId: solicitud.id, tipo },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!fila || fila.textoId !== texto.id || !fila.textoAbiertoEn) throw errores.textoNoAbierto();

    let documento = null;
    if (documentoFirmadoId) {
      documento = await documentoDeLaSolicitud(
        documentoFirmadoId,
        solicitud.id,
        TIPO_DOCUMENTO_FIRMADO[tipo],
        'documentoFirmadoId',
        transaction,
      );
    } else if (documentoFirmadoId === undefined && fila.documentoFirmadoId) {
      documento = await Documento.findByPk(fila.documentoFirmadoId, { transaction });
    }

    const conFirma = await tiposConFirma(transaction);
    const ctx = contexto.actual();
    await auditarCambio(
      fila,
      {
        decision,
        decididoPor: usuario.id,
        decididoEn: new Date(),
        ip: ctx.ip,
        dispositivo: ctx.dispositivo,
        documentoFirmadoId: documento?.id ?? null,
        estadoFirma: estadoFirmaDe({ tipo, decision, documento }, conFirma),
      },
      { transaction, accion: 'consentimientos.decidir', solicitudId: solicitud.id },
    );
    return formatearConsentimiento(fila, texto, conFirma);
  });
}

function formatearConsentimiento(fila, texto, conFirma) {
  return {
    tipo: fila.tipo,
    decision: fila.decision ?? null,
    textoId: fila.textoId ?? null,
    textoVersion: texto?.version ?? null,
    textoIdioma: texto?.idioma ?? null,
    textoAbiertoEn: iso(fila.textoAbiertoEn),
    decididoEn: iso(fila.decididoEn),
    estadoFirma: fila.decision ? fila.estadoFirma : null,
    firmaPendiente:
      Boolean(fila.decision) && conFirma.has(fila.tipo) && fila.estadoFirma === 'pendiente',
    documentoFirmadoId: fila.documentoFirmadoId ?? null,
  };
}

/**
 * Recalcula las firmas y los vínculos cuando un documento cambia (`documento.capturado` o
 * `documento.estado_cambiado`, emitidos por el agente 06 con `{ documentoId }`):
 *
 * - Si el documento es una versión nueva (`reemplaza_a`), las hojas firmadas y la certificación
 *   que apuntaban a la versión anterior pasan a apuntar a la nueva.
 * - La firma de cada consentimiento que apunta al documento queda `firmado` si el documento está
 *   VALIDADO y `pendiente` si no.
 *
 * Es recalculable: correrlo 2 veces deja lo mismo.
 * @param {{ documentoId?: string }} datos
 */
async function recalcularPorDocumento(datos) {
  const documentoId = datos?.documentoId;
  if (!documentoId) return;
  const { sequelize, Documento, Consentimiento, ProfesionalSalud } = modelos();
  await sequelize.transaction(async (transaction) => {
    const documento = await Documento.findByPk(documentoId, { transaction });
    if (!documento) return;

    if (documento.reemplazaA && documento.vigente) {
      const anteriores = await Consentimiento.findAll({
        where: { documentoFirmadoId: documento.reemplazaA },
        transaction,
      });
      for (const c of anteriores) {
        await auditarCambio(
          c,
          { documentoFirmadoId: documento.id },
          { transaction, accion: 'consentimientos.nueva_version_firmada' },
        );
      }
      const profesionales = await ProfesionalSalud.findAll({
        where: { documentoCertificacionId: documento.reemplazaA },
        transaction,
      });
      for (const p of profesionales) {
        await auditarCambio(
          p,
          { documentoCertificacionId: documento.id },
          { transaction, accion: 'profesionales_salud.nueva_version_certificacion' },
        );
      }
    }

    const conFirma = await tiposConFirma(transaction);
    const consentimientos = await Consentimiento.findAll({
      where: { documentoFirmadoId: documento.id },
      transaction,
    });
    for (const c of consentimientos) {
      const estadoFirma = estadoFirmaDe(
        { tipo: c.tipo, decision: c.decision, documento },
        conFirma,
      );
      if (c.decision && c.estadoFirma !== estadoFirma) {
        await auditarCambio(c, { estadoFirma }, { transaction, accion: 'consentimientos.firma' });
      }
    }
  });
}

/** Igual que recalcularPorDocumento, pero nunca lanza (handler de eventos). */
async function alCambiarDocumento(datos) {
  try {
    await recalcularPorDocumento(datos);
  } catch (err) {
    logger.error({ err, documentoId: datos?.documentoId }, 'No se pudo recalcular la firma');
  }
}

module.exports = {
  TIPO_DOCUMENTO_FIRMADO,
  textosVigentes,
  registrarApertura,
  decidir,
  recalcularPorDocumento,
  alCambiarDocumento,
  tiposConFirma,
  formatearConsentimiento,
};
