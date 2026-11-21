'use strict';

// Errores del módulo auth. La app traduce por `codigo`.

const { AppError, validacion } = require('../../core/errores');

module.exports = {
  correoEnUso: () =>
    new AppError(409, 'AUTH_CORREO_EN_USO', 'Ya existe una cuenta con ese correo', {
      correo: 'YA_EXISTE',
    }),
  credencialesInvalidas: () =>
    new AppError(401, 'AUTH_CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos'),
  cuentaBloqueada: () =>
    new AppError(429, 'AUTH_CUENTA_BLOQUEADA', 'Demasiados intentos fallidos. Intenta más tarde'),
  correoNoVerificado: () =>
    new AppError(403, 'AUTH_CORREO_NO_VERIFICADO', 'Confirma tu correo antes de iniciar sesión'),
  refreshInvalido: () => new AppError(401, 'AUTH_REFRESH_INVALIDO', 'La sesión ya no es válida'),
  tokenInvalido: () =>
    new AppError(400, 'AUTH_TOKEN_INVALIDO', 'El enlace no es válido, ya se usó o venció'),
  correoYaVerificado: () =>
    new AppError(409, 'AUTH_CORREO_YA_VERIFICADO', 'El correo ya está verificado'),
  contrasenaActualIncorrecta: () =>
    new AppError(400, 'AUTH_CONTRASENA_ACTUAL_INCORRECTA', 'La contraseña actual no es correcta', {
      actual: 'INCORRECTA',
    }),
  contrasenaIgualAlCorreo: (campo = 'contrasena') =>
    validacion({ [campo]: 'IGUAL_AL_CORREO' }, 'La contraseña no puede ser igual al correo'),
};
