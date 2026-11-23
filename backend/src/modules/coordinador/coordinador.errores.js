'use strict';

// Códigos de error del módulo coordinador. La app traduce por `codigo`.

const { conflicto } = require('../../core/errores');

module.exports = {
  /** 409 con los faltantes: `campos` = { "<tipo>.<codigo>": "<MOTIVO>" }. */
  faltantes: (faltantes) =>
    conflicto(
      'SOLICITUD_FALTANTES',
      'Hay obligatorios pendientes en esta etapa: el expediente no se puede confirmar',
      Object.fromEntries(faltantes.map((f) => [`${f.tipo}.${f.codigo}`, f.motivo.toUpperCase()])),
    ),
  noEnRevision: (estado) =>
    conflicto(
      'SOLICITUD_TRANSICION_INVALIDA',
      `Solo se confirma un expediente en EN_REVISION (estado: ${estado})`,
    ),
};
