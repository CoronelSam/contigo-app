'use strict';

// Errores del módulo familias. La app traduce por `codigo`.

const { AppError, conflicto, validacion, sinPermiso } = require('../../core/errores');

module.exports = {
  catalogoNoEncontrado: () => new AppError(404, 'CATALOGO_NO_ENCONTRADO', 'El catálogo no existe'),
  departamentoNoEncontrado: () =>
    new AppError(404, 'DEPARTAMENTO_NO_ENCONTRADO', 'El departamento no existe'),
  municipioInvalido: () =>
    validacion(
      { municipioCodigo: 'NO_PERTENECE_AL_DEPARTAMENTO' },
      'El municipio no es de ese departamento',
    ),
  parentescoInvalido: () =>
    validacion({ parentesco: 'VALOR_NO_PERMITIDO' }, 'Parentesco desconocido'),
  posibleDuplicado: () =>
    conflicto(
      'PACIENTE_POSIBLE_DUPLICADO',
      'Ya registraste un niño con el mismo nombre y fecha de nacimiento. Reenvía con confirmarDuplicado: true si es otro niño',
    ),
  edicionBloqueada: () =>
    conflicto(
      'PACIENTE_EDICION_BLOQUEADA',
      'Los datos del niño ya están en revisión. Pide la corrección al coordinador del caso',
    ),
  soloFamilia: () => sinPermiso('Esta acción es solo para cuentas de familia'),
  campoSoloCoordinador: (campo) =>
    validacion({ [campo]: 'CAMPO_NO_PERMITIDO' }, 'Solo el coordinador puede cambiar este campo'),
  cuentaActualSoloFamilia: () =>
    validacion(
      { esLaCuentaActual: 'CAMPO_NO_PERMITIDO' },
      'Solo una cuenta de familia puede completar su propio perfil de tutor',
    ),
  tutorNoEncontrado: () => new AppError(404, 'NO_ENCONTRADO', 'Recurso no encontrado'),
  tutorDeOtraCuenta: () =>
    conflicto(
      'TUTOR_DE_OTRA_CUENTA',
      'Ese tutor tiene su propia cuenta; solo él o el coordinador pueden cambiarlo',
    ),
  vinculoPropio: () =>
    conflicto(
      'TUTOR_VINCULO_PROPIO',
      'No puedes quitar tu propio vínculo: perderías el acceso al niño',
    ),
  ultimoResponsable: () =>
    conflicto('TUTOR_ULTIMO_RESPONSABLE', 'El niño debe tener al menos un responsable legal'),
};
