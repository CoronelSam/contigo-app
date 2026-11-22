'use strict';

// Códigos de error del módulo voluntario. La app traduce por `codigo`.

const { conflicto, noEncontrado, validacion } = require('../../core/errores');

module.exports = {
  noEsVoluntario: (codigo) => validacion({ voluntarioId: codigo }),
  duplicada: () =>
    conflicto('ASIGNACION_DUPLICADA', 'Ese voluntario ya tiene una asignación activa en el caso'),
  casoOcupado: () =>
    conflicto(
      'ASIGNACION_CASO_OCUPADO',
      'El caso ya tiene otro voluntario y la configuración no permite varios',
    ),
  casoCerrado: (estado) =>
    conflicto('ASIGNACION_CASO_CERRADO', `No se asignan casos terminados (estado: ${estado})`),
  asignacionNoEncontrada: () => noEncontrado('Asignación no encontrada'),
  cerrada: () => conflicto('ASIGNACION_CERRADA', 'La asignación ya está cerrada: crea una nueva'),
  mismoVoluntario: () => validacion({ voluntarioId: 'ES_EL_MISMO' }),
};
