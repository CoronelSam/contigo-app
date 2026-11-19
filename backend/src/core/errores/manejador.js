'use strict';

const { ZodError } = require('zod');
const { AppError } = require('./index');
const { camposDesdeZod } = require('./zod');

/** Convierte cualquier error en `{ status, cuerpo }` con el formato común de la API. */
function normalizarError(err) {
  if (err instanceof AppError) {
    const cuerpo = { codigo: err.codigo, mensaje: err.message };
    if (err.campos && Object.keys(err.campos).length) cuerpo.campos = err.campos;
    return { status: err.status, cuerpo };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      cuerpo: {
        codigo: 'VALIDACION',
        mensaje: 'Los datos no son válidos',
        campos: camposDesdeZod(err),
      },
    };
  }

  // Errores de Sequelize (sin importar la librería: se reconocen por nombre).
  if (err?.name === 'SequelizeUniqueConstraintError') {
    const campos = {};
    for (const campo of Object.keys(err.fields ?? {})) campos[campo] = 'YA_EXISTE';
    return {
      status: 409,
      cuerpo: {
        codigo: 'CONFLICTO_UNICO',
        mensaje: 'Ya existe un registro con esos datos',
        campos,
      },
    };
  }
  if (err?.name === 'SequelizeForeignKeyConstraintError') {
    return {
      status: 409,
      cuerpo: {
        codigo: 'REFERENCIA_INVALIDA',
        mensaje: 'Referencia a un registro inexistente o en uso',
      },
    };
  }
  if (err?.name === 'SequelizeValidationError') {
    const campos = {};
    for (const e of err.errors ?? []) if (e.path) campos[e.path] = 'INVALIDO';
    return {
      status: 400,
      cuerpo: { codigo: 'VALIDACION', mensaje: 'Los datos no son válidos', campos },
    };
  }

  // Errores de body-parser.
  if (err?.type === 'entity.parse.failed') {
    return {
      status: 400,
      cuerpo: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es JSON válido' },
    };
  }
  if (err?.type === 'entity.too.large') {
    return {
      status: 413,
      cuerpo: {
        codigo: 'CUERPO_DEMASIADO_GRANDE',
        mensaje: 'El cuerpo de la petición es demasiado grande',
      },
    };
  }

  // Errores de multer (subidas).
  if (err?.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const codigo = err.code === 'LIMIT_FILE_SIZE' ? 'ARCHIVO_DEMASIADO_GRANDE' : 'SUBIDA_INVALIDA';
    return { status, cuerpo: { codigo, mensaje: 'El archivo enviado no es válido' } };
  }

  return {
    status: 500,
    cuerpo: { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado' },
  };
}

/** Responde 404 con el formato común para rutas que no existen. */
function rutaNoEncontrada(req, res) {
  res.status(404).json({ codigo: 'RUTA_NO_ENCONTRADA', mensaje: 'La ruta solicitada no existe' });
}

/** Manejador de errores de Express. Nunca envía detalles internos al cliente. */
// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, next) {
  const { status, cuerpo } = normalizarError(err);
  if (status >= 500) {
    req.log?.error({ err }, 'Error no controlado');
  } else {
    req.log?.debug({ codigo: cuerpo.codigo, status }, 'Error de la petición');
  }
  if (res.headersSent) return;
  res.status(status).json(cuerpo);
}

module.exports = { manejadorErrores, rutaNoEncontrada, normalizarError };
