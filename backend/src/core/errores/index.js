'use strict';

/**
 * Error de la aplicación. Se responde como `{ codigo, mensaje, campos }`.
 * `codigo` es estable (UPPER_SNAKE) y la app lo traduce; `mensaje` es para desarrolladores.
 */
class AppError extends Error {
  /**
   * @param {number} status Código HTTP.
   * @param {string} codigo Código estable en UPPER_SNAKE.
   * @param {string} [mensaje] Texto para desarrolladores.
   * @param {Record<string, string>} [campos] Campo → código del problema.
   */
  constructor(status, codigo, mensaje, campos) {
    super(mensaje ?? codigo);
    this.name = 'AppError';
    this.status = status;
    this.codigo = codigo;
    this.campos = campos;
  }
}

/** Para stubs de contratos y trabajos que otro agente debe implementar. */
class NoImplementado extends AppError {
  /** @param {string} [que] */
  constructor(que = 'Esta funcionalidad') {
    super(501, 'NO_IMPLEMENTADO', `${que} todavía no está implementada`);
    this.name = 'NoImplementado';
  }
}

const validacion = (campos, mensaje = 'Los datos enviados no son válidos') =>
  new AppError(400, 'VALIDACION', mensaje, campos);

const noAutenticado = (mensaje = 'Se requiere iniciar sesión', codigo = 'NO_AUTENTICADO') =>
  new AppError(401, codigo, mensaje);

const sinPermiso = (mensaje = 'No tienes permiso para esta acción', codigo = 'SIN_PERMISO') =>
  new AppError(403, codigo, mensaje);

/** Úsalo también cuando el recurso existe pero el usuario no tiene relación con él. */
const noEncontrado = (mensaje = 'Recurso no encontrado', codigo = 'NO_ENCONTRADO') =>
  new AppError(404, codigo, mensaje);

const conflicto = (codigo, mensaje, campos) => new AppError(409, codigo, mensaje, campos);

const precondicionFallida = (codigo, mensaje, campos) => new AppError(412, codigo, mensaje, campos);

const precondicionRequerida = (mensaje = 'Falta la cabecera de precondición requerida') =>
  new AppError(428, 'PRECONDICION_REQUERIDA', mensaje);

const demasiadosIntentos = (
  mensaje = 'Demasiados intentos. Intenta más tarde',
  codigo = 'DEMASIADOS_INTENTOS',
) => new AppError(429, codigo, mensaje);

module.exports = {
  AppError,
  NoImplementado,
  validacion,
  noAutenticado,
  sinPermiso,
  noEncontrado,
  conflicto,
  precondicionFallida,
  precondicionRequerida,
  demasiadosIntentos,
};
