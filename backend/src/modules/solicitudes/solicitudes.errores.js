'use strict';

// Códigos de error del módulo solicitudes. La app traduce por `codigo`.

const { AppError, conflicto, noEncontrado, validacion } = require('../../core/errores');

module.exports = {
  abiertaExistente: () =>
    conflicto(
      'SOLICITUD_ABIERTA_EXISTENTE',
      'El niño ya tiene una solicitud abierta (solicitudes.permitir_multiples_abiertas = false)',
    ),
  modalidadBloqueada: (estado) =>
    conflicto(
      'SOLICITUD_MODALIDAD_BLOQUEADA',
      `La modalidad solo se elige en BORRADOR o se cambia en CAPTURA (estado: ${estado})`,
    ),
  seccionNoEncontrada: (seccion) =>
    noEncontrado(
      `La sección ${seccion} no existe o no se guarda como formulario`,
      'SECCION_NO_ENCONTRADA',
    ),
  /** 412 con la versión actual: el controlador la devuelve en el cuerpo y en `ETag`. */
  versionConflicto: (versionActual) => {
    const err = new AppError(
      412,
      'SECCION_VERSION_CONFLICTO',
      `La sección cambió: la versión actual es v${versionActual}`,
    );
    err.versionActual = versionActual;
    return err;
  },
  ifMatchInvalido: () => validacion({ 'If-Match': 'FORMATO_INVALIDO' }),
  textoNoEncontrado: () =>
    noEncontrado('Texto de consentimiento no encontrado', 'CONSENTIMIENTO_TEXTO_NO_ENCONTRADO'),
  textoNoVigente: () =>
    conflicto(
      'CONSENTIMIENTO_TEXTO_NO_VIGENTE',
      'Ese texto ya no es la versión vigente del consentimiento',
    ),
  textoNoAbierto: () =>
    conflicto(
      'CONSENTIMIENTO_TEXTO_NO_ABIERTO',
      'La familia debe abrir el texto completo de este consentimiento antes de decidir',
    ),
  documentoNoCorresponde: (campo) => validacion({ [campo]: 'NO_CORRESPONDE' }),
  catalogoInvalido: (campo) => validacion({ [campo]: 'VALOR_NO_PERMITIDO' }),
};
