'use strict';

// Códigos de error del módulo ruta. La app traduce por `codigo`.

const { conflicto, noEncontrado, validacion } = require('../../core/errores');

module.exports = {
  noEnEvaluacion: (estado) =>
    conflicto(
      'EVALUACION_ESTADO_INVALIDO',
      `La ruta solo se decide con el caso en EN_EVALUACION (estado: ${estado})`,
    ),
  reaperturaNoPermitida: (estado) =>
    conflicto(
      'SOLICITUD_TRANSICION_INVALIDA',
      `Solo se reabre la evaluación desde PAQUETE_EXTERIOR, DERIVADA_HN o DENEGADA (estado: ${estado})`,
    ),
  sinRutaHonduras: () =>
    conflicto(
      'DERIVACION_SIN_RUTA_HONDURAS',
      'Solo se deriva un caso en evaluación con la ruta Honduras decidida',
    ),
  derivacionNoPermitida: (estado) =>
    conflicto('DERIVACION_NO_PERMITIDA', `No se deriva un caso en ${estado}`),
  proveedorInvalido: () =>
    conflicto(
      'DERIVACION_PROVEEDOR_INVALIDO',
      'El proveedor no existe, está inactivo o no atiende esa especialidad',
    ),
  fechaPasada: () =>
    conflicto('DERIVACION_FECHA_PASADA', 'La fecha de la cita no puede ser anterior a hoy'),
  requisitosPendientes: (codigos) =>
    conflicto(
      'DERIVACION_REQUISITOS_PENDIENTES',
      'Faltan requisitos obligatorios de Honduras',
      Object.fromEntries(codigos.map((c) => [`documento.${c}`, 'PENDIENTE'])),
    ),
  derivacionNoEncontrada: () => noEncontrado('Derivación no encontrada'),
  derivacionNoVigente: () =>
    conflicto('DERIVACION_NO_VIGENTE', 'Esa cita fue reemplazada o el caso ya no está derivado'),
  citaNoProgramada: (estado) =>
    conflicto('DERIVACION_ESTADO_INVALIDO', `La cita ya no está programada (estado: ${estado})`),
  proveedorNoEncontrado: () => noEncontrado('Proveedor no encontrado'),
  reglaNoEncontrada: () => noEncontrado('Regla no encontrada'),
  versionUsada: (version) =>
    conflicto(
      'REGLAS_VERSION_USADA',
      `La versión ${version} ya se usó en evaluaciones: crea una versión nueva`,
    ),
  versionVacia: (version) =>
    conflicto('REGLAS_VERSION_VACIA', `La versión ${version} no tiene reglas`),
  nombreRepetido: () =>
    conflicto('REGLAS_NOMBRE_REPETIDO', 'Ya hay una regla con ese nombre en la versión'),
  condicionInvalida: (problema) =>
    validacion(
      { condicion: problema.codigo },
      problema.variables
        ? `Variables desconocidas: ${problema.variables.join(', ')}`
        : 'La condición no es JsonLogic válido',
    ),
  catalogoInvalido: (campo) => validacion({ [campo]: 'VALOR_NO_PERMITIDO' }),
  municipioInvalido: () => validacion({ municipioCodigo: 'NO_PERTENECE_AL_DEPARTAMENTO' }),
  departamentoInvalido: () => validacion({ departamentoCodigo: 'NO_EXISTE' }),
};
