'use strict';

// Errores del módulo paquetes (PAQUETE_…, PLANTILLA_…, ENVIO_…, RESPUESTA_…).

const { AppError, conflicto, validacion } = require('../../core/errores');

module.exports = {
  noAplica: () =>
    conflicto('PAQUETE_NO_APLICA', 'La ruta decidida no es al exterior: no hay paquete PDF'),
  estadoNoPermitido: (tipo, estado) =>
    conflicto(
      'PAQUETE_ESTADO_NO_PERMITIDO',
      `El paquete ${tipo} no se puede generar con la solicitud en ${estado}`,
    ),
  /** 409 con los faltantes: `campos` = { "<tipo>.<codigo>": "<MOTIVO>" }. */
  faltantes: (faltantes) =>
    conflicto(
      'PAQUETE_FALTANTES',
      'El expediente tiene obligatorios pendientes: no se puede generar el paquete final',
      Object.fromEntries(faltantes.map((f) => [`${f.tipo}.${f.codigo}`, f.motivo.toUpperCase()])),
    ),
  sinPlantillas: () =>
    conflicto('PAQUETE_SIN_PLANTILLAS', 'No hay plantillas oficiales activas para este paquete'),
  noListo: () => conflicto('PAQUETE_NO_LISTO', 'El paquete todavía no está listo'),
  noFinal: () => conflicto('PAQUETE_NO_FINAL', 'Solo un paquete final se puede compartir o enviar'),
  paginaFueraDeRango: () => new AppError(404, 'NO_ENCONTRADO', 'La página no existe'),

  plantillaVersionExiste: () =>
    conflicto(
      'PLANTILLA_VERSION_EXISTE',
      'Ya existe esa versión de la plantilla. Registra un número de versión nuevo',
    ),
  plantillaPdfInvalido: () =>
    validacion({ archivo: 'PDF_INVALIDO' }, 'El PDF de la plantilla no se puede leer'),
  plantillaMapa: (campos) =>
    validacion(campos, 'El mapa de campos o las zonas de OCR no coinciden con el PDF'),

  envioEstado: (estado) =>
    conflicto(
      'ENVIO_ESTADO_INVALIDO',
      `El envío exige la solicitud en COMPLETA (está en ${estado})`,
    ),
  envioSinPaqueteFinal: () =>
    conflicto(
      'ENVIO_SIN_PAQUETE_FINAL',
      'El envío exige un paquete final listo y revisado de esta solicitud',
    ),
  envioDestinoDistinto: () =>
    conflicto('ENVIO_DESTINO_DISTINTO', 'El destino no coincide con el paquete de la solicitud', {
      destino: 'DISTINTO_DEL_PAQUETE',
    }),

  respuestaEstado: (estado) =>
    conflicto(
      'RESPUESTA_ESTADO_INVALIDO',
      `La respuesta exige la solicitud en ENVIADA (está en ${estado})`,
    ),
};
