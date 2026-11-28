'use strict';

// Errores del módulo comunicacion (MENSAJE_…, NOTIFICACION_…).

const { sinPermiso, validacion } = require('../../core/errores');

module.exports = {
  noParticipa: () =>
    sinPermiso('Tu rol no participa en el chat del caso', 'MENSAJE_ROL_NO_PARTICIPA'),
  vacio: () =>
    validacion({ cuerpo: 'REQUERIDO' }, 'El mensaje necesita un texto o un archivo adjunto'),
  mensajeAjeno: (campo) =>
    validacion({ [campo]: 'NO_PERTENECE_AL_CASO' }, 'El mensaje no es de esta solicitud'),
};
