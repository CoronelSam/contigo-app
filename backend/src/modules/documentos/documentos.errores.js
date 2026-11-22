'use strict';

// Códigos de error del módulo documentos. La app traduce por `codigo`.

const { conflicto, noEncontrado, validacion } = require('../../core/errores');

module.exports = {
  noRequerido: () =>
    conflicto(
      'DOCUMENTO_NO_REQUERIDO',
      'Ese tipo de documento no está entre los requisitos activos del caso',
    ),
  tipoNoExiste: () => validacion({ tipoDocumentoId: 'NO_EXISTE' }),
  tipoNoEncontrado: () => noEncontrado('Tipo de documento no encontrado'),
  idEnUso: () =>
    conflicto('DOCUMENTO_ID_EN_USO', 'Ese id ya pertenece a otro documento de otro usuario o caso'),
  validadoSoloCoordinador: () =>
    conflicto(
      'DOCUMENTO_VALIDADO',
      'El documento ya está validado: solo el coordinador puede reemplazarlo',
    ),
  origenNoPermitido: () => validacion({ origen: 'VALOR_NO_PERMITIDO' }),
  noEditable: (estado) =>
    conflicto(
      'DOCUMENTO_NO_EDITABLE',
      `Las páginas solo cambian con el documento en FALTA (estado: ${estado}). Crea una versión nueva`,
    ),
  noVigente: () =>
    conflicto('DOCUMENTO_NO_VIGENTE', 'Es una versión anterior del documento: no se modifica'),
  unaPagina: () =>
    conflicto('DOCUMENTO_UNA_PAGINA', 'Este tipo de documento admite una sola página'),
  demasiadasPaginas: (max) =>
    conflicto('DOCUMENTO_DEMASIADAS_PAGINAS', `Un documento admite como máximo ${max} páginas`),
  paginaNoEncontrada: () => noEncontrado('Página no encontrada'),
  ordenInvalido: () => validacion({ orden: 'FUERA_DE_RANGO' }),
  noEsPermutacion: () => validacion({ paginas: 'NO_ES_PERMUTACION' }),
  sinPaginas: () =>
    conflicto('DOCUMENTO_SIN_PAGINAS', 'Sube al menos una página antes de finalizar'),
  paginasFaltantes: (declaradas, subidas) =>
    conflicto(
      'DOCUMENTO_PAGINAS_FALTANTES',
      `Se declararon ${declaradas} páginas y hay ${subidas} subidas`,
    ),
  paginasSobrantes: (declaradas, subidas) =>
    conflicto(
      'DOCUMENTO_PAGINAS_SOBRANTES',
      `Se declararon ${declaradas} páginas y hay ${subidas} subidas`,
    ),
  estadoInvalido: (estado, esperado) =>
    conflicto(
      'DOCUMENTO_ESTADO_INVALIDO',
      `La acción exige el documento en ${esperado} (estado: ${estado})`,
    ),
  ocrSinRevisar: () =>
    conflicto(
      'DOCUMENTO_OCR_SIN_REVISAR',
      'El OCR de este documento todavía no fue revisado y confirmado',
    ),
  ocrEnRevision: () =>
    conflicto(
      'DOCUMENTO_OCR_EN_REVISION',
      'El OCR ya terminó: para cambiar las páginas, crea una versión nueva del documento',
    ),
  correccionNoPermitida: (estado) =>
    conflicto('CORRECCION_NO_PERMITIDA', `No se piden correcciones con la solicitud en ${estado}`),
  correccionYaAbierta: () =>
    conflicto('CORRECCION_YA_ABIERTA', 'Ya hay una corrección abierta para esa sección'),
};
