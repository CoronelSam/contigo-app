'use strict';

// Profesional de salud (19). La certificación es un documento (CAPTURADO, pendiente de
// verificación): la familia no la llena, solo la adjunta. Aquí se vincula su documento.

const { obtenerSolicitudConAcceso, exigirEdicion } = require('../../core/acceso');
const { auditarCambio } = require('../../core/auditoria');
const { estadoExpediente } = require('../../core/expediente');
const errores = require('./solicitudes.errores');
const { filaBloqueada } = require('./solicitudes.util');

const TIPO_CERTIFICACION = 'certificacion_medica';
const CAMPOS = ['nombre', 'especialidad', 'telefono', 'correo', 'documentoCertificacionId'];

const modelos = () => require('../../models');

/**
 * Documento vigente de la solicitud con el tipo esperado, o error 400 `NO_CORRESPONDE`.
 * @param {string} documentoId
 * @param {string} solicitudId
 * @param {string} tipoCodigo
 * @param {string} campo Nombre del campo para el error.
 */
async function documentoDeLaSolicitud(documentoId, solicitudId, tipoCodigo, campo, transaction) {
  const { Documento } = modelos();
  const documento = await Documento.findOne({
    where: { id: documentoId, solicitudId, vigente: true },
    include: [{ association: 'tipoDocumento', attributes: ['codigo'] }],
    transaction,
  });
  if (!documento || documento.tipoDocumento?.codigo !== tipoCodigo) {
    throw errores.documentoNoCorresponde(campo);
  }
  return documento;
}

/** ¿El código es un ítem activo del catálogo? */
async function existeEnCatalogo(tipo, codigo, transaction) {
  const { CatalogoItem } = modelos();
  return Boolean(
    await CatalogoItem.findOne({
      where: { tipo, codigo, activo: true },
      attributes: ['id'],
      transaction,
    }),
  );
}

async function formatear(profesional, transaction) {
  const { profesional: estado } = await estadoExpediente(profesional.solicitudId, {
    transaction,
  });
  return {
    nombre: profesional?.nombre ?? null,
    especialidad: profesional?.especialidad ?? null,
    telefono: profesional?.telefono ?? null,
    correo: profesional?.correo ?? null,
    documentoCertificacionId: profesional?.documentoCertificacionId ?? null,
    estado: estado.estado,
    obligatorio: estado.obligatorio,
  };
}

/**
 * Guarda los datos del profesional de salud. Un campo que no se envía no cambia; null lo borra.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {Partial<Record<'nombre' | 'especialidad' | 'telefono' | 'correo' | 'documentoCertificacionId', string | null>>} cambios
 */
async function guardarProfesional(usuario, solicitudId, cambios) {
  const { sequelize, ProfesionalSalud } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, { transaction });
    await exigirEdicion(usuario, solicitud, { seccion: 'profesional_salud', transaction });

    if (cambios.especialidad) {
      if (!(await existeEnCatalogo('especialidad_medica', cambios.especialidad, transaction))) {
        throw errores.catalogoInvalido('especialidad');
      }
    }
    if (cambios.documentoCertificacionId) {
      await documentoDeLaSolicitud(
        cambios.documentoCertificacionId,
        solicitud.id,
        TIPO_CERTIFICACION,
        'documentoCertificacionId',
        transaction,
      );
    }

    const fila = await filaBloqueada(ProfesionalSalud, { solicitudId: solicitud.id }, transaction);
    const aplicar = Object.fromEntries(
      CAMPOS.filter((c) => cambios[c] !== undefined).map((c) => [c, cambios[c]]),
    );
    await auditarCambio(fila, aplicar, {
      transaction,
      accion: 'profesionales_salud.guardar',
      solicitudId: solicitud.id,
    });
    return formatear(fila, transaction);
  });
}

module.exports = { guardarProfesional, documentoDeLaSolicitud, TIPO_CERTIFICACION };
