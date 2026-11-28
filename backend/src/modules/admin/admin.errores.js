'use strict';

// Códigos de error del módulo admin. La app traduce por `codigo`.

const { conflicto, noEncontrado, validacion } = require('../../core/errores');

module.exports = {
  // Usuarios
  usuarioNoEncontrado: () => noEncontrado('Usuario no encontrado'),
  correoExiste: () =>
    conflicto('USUARIO_CORREO_EXISTE', 'Ya existe una cuenta con ese correo', {
      correo: 'EN_USO',
    }),
  rolNoPermitido: () =>
    conflicto(
      'USUARIO_ROL_NO_PERMITIDO',
      'En v1 una cuenta de familia no pasa a personal ni el personal a familia',
    ),
  propiaCuenta: () =>
    conflicto(
      'USUARIO_PROPIA_CUENTA',
      'Un administrador no puede desactivarse ni quitarse el rol a sí mismo',
    ),
  ultimoAdministrador: () =>
    conflicto(
      'USUARIO_ULTIMO_ADMINISTRADOR',
      'El sistema no puede quedar sin administradores activos',
    ),
  noInvitado: () =>
    conflicto(
      'USUARIO_NO_INVITADO',
      'Solo se reenvía la invitación a una cuenta que todavía no creó su contraseña',
    ),
  invitacionPendiente: () =>
    conflicto(
      'USUARIO_INVITACION_PENDIENTE',
      'La cuenta nunca creó su contraseña: reenvía la invitación en lugar de activarla',
    ),
  motivoRequerido: () => validacion({ motivo: 'REQUERIDO' }, 'El cambio de rol necesita un motivo'),

  // Tipos de documento y requisitos
  tipoNoEncontrado: () => noEncontrado('Tipo de documento no encontrado'),
  tipoCodigoExiste: () =>
    conflicto('TIPO_DOCUMENTO_CODIGO_EXISTE', 'Ya existe un tipo de documento con ese código', {
      codigo: 'EN_USO',
    }),
  tipoConRequisitos: (rutas) =>
    conflicto(
      'TIPO_DOCUMENTO_CON_REQUISITOS',
      'El tipo tiene requisitos activos: desactívalos antes de desactivar el tipo',
      Object.fromEntries(rutas.map((r) => [`requisito.${r}`, 'ACTIVO'])),
    ),
  plantillaNoExiste: () => validacion({ plantillaId: 'NO_EXISTE' }, 'La plantilla no existe'),
  paginasIncompatibles: () =>
    validacion(
      { paginasEsperadas: 'INCOMPATIBLE' },
      'Un tipo de una sola página no puede esperar más de una',
    ),
  requisitoNoEncontrado: () => noEncontrado('Requisito no encontrado'),
  requisitoExiste: () =>
    conflicto(
      'REQUISITO_EXISTE',
      'Ese tipo de documento ya es requisito de esa ruta: cámbialo o reactívalo',
    ),
  requisitoTipoInactivo: () =>
    conflicto('REQUISITO_TIPO_INACTIVO', 'El tipo de documento del requisito está inactivo'),
  tipoDocumentoNoExiste: () =>
    validacion({ tipoDocumentoId: 'NO_EXISTE' }, 'El tipo de documento no existe'),

  // Catálogos
  catalogoItemNoEncontrado: () => noEncontrado('Ítem de catálogo no encontrado'),
  catalogoTipoNoExiste: () =>
    validacion({ tipo: 'NO_EXISTE' }, 'No existe un catálogo de ese tipo'),
  catalogoCodigoExiste: () =>
    conflicto('CATALOGO_CODIGO_EXISTE', 'Ya existe un ítem con ese código en el catálogo', {
      codigo: 'EN_USO',
    }),

  // Configuración
  claveNoEncontrada: () => noEncontrado('Clave de configuración desconocida'),

  // Reportes
  rangoInvalido: (campo, codigo) => validacion({ [`query.${campo}`]: codigo }),
};
