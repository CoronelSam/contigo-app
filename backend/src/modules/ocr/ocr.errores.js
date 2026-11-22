'use strict';

// Códigos de error del módulo OCR. La app traduce por `codigo`.

const { conflicto, noEncontrado, validacion } = require('../../core/errores');

const porCampo = (ids, codigo) => Object.fromEntries(ids.map((id) => [id, codigo]));

module.exports = {
  campoNoEncontrado: () => noEncontrado('Campo no encontrado en esta extracción'),
  noEditable: (estado) =>
    conflicto(
      'OCR_EXTRACCION_NO_EDITABLE',
      `Solo se revisan extracciones por confirmar (estado: ${estado})`,
    ),
  camposSinVerificar: (ids) =>
    conflicto(
      'OCR_CAMPOS_SIN_VERIFICAR',
      'Todos los campos necesitan confirmación humana antes de marcar la revisión',
      porCampo(ids, 'SIN_VERIFICAR'),
    ),
  dudosoEnBloque: (ids) =>
    conflicto(
      'OCR_CAMPO_DUDOSO_EN_BLOQUE',
      'Los campos dudosos se confirman uno por uno; no se confirmó ninguno',
      porCampo(ids, 'DUDOSO'),
    ),
  casillasExcluyentes: (ids, status = 409) =>
    status === 400
      ? validacion(porCampo(ids, 'CASILLAS_EXCLUYENTES'), 'Solo una casilla marcada por grupo')
      : conflicto(
          'OCR_CASILLAS_EXCLUYENTES',
          'Solo una casilla marcada por grupo',
          porCampo(ids, 'CASILLAS_EXCLUYENTES'),
        ),
  valorInvalido: (codigo) => validacion({ valor: codigo }),
  valoresInvalidos: (campos) => validacion(campos, 'Algunos valores leídos no son válidos'),
  rechazadosPorFormulario: (campos) =>
    validacion(campos, 'El formulario rechazó algunos valores; no se confirmó nada'),
};
