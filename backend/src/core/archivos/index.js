'use strict';

// Archivos privados: validación por contenido, subida al almacenamiento, fila en `archivos`
// y URL firmadas con registro de acceso. Ningún archivo se sirve sin firma.

const crypto = require('node:crypto');
const multer = require('multer');
const sharp = require('sharp');
const { config } = require('../../config/env');
const almacenamiento = require('../almacenamiento');
const contexto = require('../contexto');
const { AppError, validacion, noEncontrado } = require('../errores');
const { registrarAcceso } = require('../auditoria');

/** Tipos aceptados, reconocidos por sus primeros bytes (magic bytes), nunca por la extensión. */
const TIPOS = Object.freeze([
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    es: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    es: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    es: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  {
    mime: 'application/pdf',
    ext: 'pdf',
    es: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
]);

const MIMES = Object.freeze(TIPOS.map((t) => t.mime));
const MIMES_IMAGEN = Object.freeze(MIMES.filter((m) => m.startsWith('image/')));
const PREFIJO_VALIDO = /^[a-z0-9_-]+$/;

const maxBytes = () => config().archivos.maxBytes;

/** Tipo real del archivo según su contenido, o null si no es uno aceptado. */
function detectarTipo(buffer) {
  return TIPOS.find((t) => t.es(buffer)) ?? null;
}

const calcularSha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * Valida, sube y registra un archivo. El tipo se detecta por contenido; el `mime` que declare
 * el cliente se ignora.
 *
 * Nota: el objeto se sube antes del commit; si la transacción se revierte queda un objeto
 * huérfano en el almacenamiento (no visible sin su fila).
 *
 * `maxBytes` es un límite propio para los archivos que genera el sistema (por ejemplo, el paquete
 * PDF). Nunca se usa para lo que sube un usuario, que siempre tiene ARCHIVOS_MAX_MB.
 *
 * @param {{ buffer: Buffer, prefijo: string, tipos?: readonly string[], maxBytes?: number,
 *   transaction?: import('sequelize').Transaction }} p
 * @returns {Promise<object>} Fila de `archivos`.
 */
async function guardarArchivo({ buffer, prefijo, tipos = MIMES, maxBytes: limite, transaction }) {
  if (!PREFIJO_VALIDO.test(prefijo ?? ''))
    throw new Error(`Prefijo de archivo inválido: ${prefijo}`);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw validacion({ archivo: 'REQUERIDO' }, 'El archivo está vacío');
  }
  if (buffer.length > (limite ?? maxBytes())) {
    throw new AppError(413, 'ARCHIVO_DEMASIADO_GRANDE', 'El archivo supera el tamaño máximo', {
      archivo: 'MUY_GRANDE',
    });
  }
  const tipo = detectarTipo(buffer);
  if (!tipo || !tipos.includes(tipo.mime)) {
    throw new AppError(400, 'ARCHIVO_TIPO_NO_PERMITIDO', `Tipos aceptados: ${tipos.join(', ')}`, {
      archivo: 'TIPO_NO_PERMITIDO',
    });
  }

  let ancho = null;
  let alto = null;
  if (tipo.mime.startsWith('image/')) {
    try {
      ({ width: ancho = null, height: alto = null } = await sharp(buffer).metadata());
    } catch {
      throw new AppError(400, 'ARCHIVO_DANADO', 'La imagen no se puede leer', {
        archivo: 'DANADO',
      });
    }
  }

  const ahora = new Date();
  const mes = String(ahora.getUTCMonth() + 1).padStart(2, '0');
  const clave = `${prefijo}/${ahora.getUTCFullYear()}/${mes}/${crypto.randomUUID()}.${tipo.ext}`;
  await almacenamiento.subirObjeto({ clave, cuerpo: buffer, mime: tipo.mime });

  const { Archivo } = require('../../models');
  return Archivo.create(
    {
      clave,
      mime: tipo.mime,
      bytes: buffer.length,
      sha256: calcularSha256(buffer),
      ancho,
      alto,
      subidoPor: contexto.actual().usuario?.id ?? null,
    },
    { transaction },
  );
}

/**
 * URL firmada de lectura (5 minutos por defecto). Registra el acceso del usuario del contexto.
 * Quien llama ya comprobó que el usuario tiene relación con el dueño del archivo.
 *
 * @param {{ archivo?: object, archivoId?: string, solicitudId?: string | null,
 *   recurso?: 'archivo' | 'documento' | 'paquete', segundos?: number,
 *   transaction?: import('sequelize').Transaction }} p
 * @returns {Promise<{ url: string, expiraEn: string }>}
 */
async function urlFirmada({
  archivo,
  archivoId,
  solicitudId,
  recurso = 'archivo',
  segundos,
  transaction,
}) {
  const { Archivo } = require('../../models');
  const registro = archivo ?? (await Archivo.findByPk(archivoId, { transaction }));
  if (!registro) throw noEncontrado();
  await registrarAcceso({ solicitudId, recurso, recursoId: registro.id, transaction });
  const duracion = segundos ?? config().almacenamiento.urlFirmadaSegundos;
  const url = await almacenamiento.urlFirmadaGet(registro.clave, duracion);
  return { url, expiraEn: new Date(Date.now() + duracion * 1000).toISOString() };
}

/**
 * Middlewares de subida multipart en memoria con los límites de la API.
 * Uso: router.post('/x', requiereAuth, ...subidaEnMemoria({ campo: 'archivo' }), handler)
 * El archivo queda en `req.file` (o `req.files` si maxArchivos > 1).
 *
 * @param {{ campo?: string, maxArchivos?: number }} [opciones]
 * @returns {import('express').RequestHandler[]}
 */
function subidaEnMemoria({ campo = 'archivo', maxArchivos = 1 } = {}) {
  const subida = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes(), files: maxArchivos, fields: 20 },
  });
  const manejador = maxArchivos === 1 ? subida.single(campo) : subida.array(campo, maxArchivos);
  // multer lee el stream de la petición y pierde el contexto asíncrono: se reanuda después.
  return [manejador, contexto.reanudar];
}

module.exports = {
  MIMES,
  MIMES_IMAGEN,
  detectarTipo,
  calcularSha256,
  guardarArchivo,
  urlFirmada,
  subidaEnMemoria,
};
