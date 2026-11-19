'use strict';

// Adaptador para el API S3 de Cloudflare R2 (bucket privado).
//
// Diferencias con AWS S3 que este adaptador respeta:
//   - La región es "auto".
//   - R2 no implementa el encabezado x-amz-server-side-encryption: cifra siempre todos los
//     objetos en reposo con AES-256, así que no se pide cifrado en cada subida.
//   - R2 no acepta los checksums CRC32 que el SDK v3 agrega por defecto; solo se calculan
//     cuando la operación los exige.
//   - Las URL firmadas solo funcionan con el endpoint del API S3
//     (https://<ACCOUNT_ID>.r2.cloudflarestorage.com), no con dominios propios del bucket.

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Prefijo vacío que lista el chequeo de salud, para no listar archivos reales.
const PREFIJO_SALUD = '_salud/';

/**
 * Opciones del cliente S3 para R2.
 * @param {ReturnType<import('../../config/env').config>['almacenamiento']} cfg
 * @param {string | undefined} endpoint
 */
function opcionesCliente(cfg, endpoint) {
  return {
    region: cfg.region,
    endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
}

function esNoEncontrado(err) {
  const status = err?.$metadata?.httpStatusCode;
  return (
    status === 404 ||
    err?.name === 'NotFound' ||
    err?.name === 'NoSuchKey' ||
    err?.name === 'NoSuchBucket'
  );
}

/** @param {ReturnType<import('../../config/env').config>['almacenamiento']} cfg */
function crearAdaptadorS3(cfg) {
  const cliente = new S3Client(opcionesCliente(cfg, cfg.endpoint));
  // Las URL firmadas se generan con otro host solo si se configuró uno (con R2, déjalo vacío).
  const clienteFirmas = cfg.endpointPublico
    ? new S3Client(opcionesCliente(cfg, cfg.endpointPublico))
    : cliente;
  const Bucket = cfg.bucket;

  return {
    async subirObjeto({ clave, cuerpo, mime }) {
      await cliente.send(
        new PutObjectCommand({ Bucket, Key: clave, Body: cuerpo, ContentType: mime }),
      );
      return { clave };
    },

    async urlFirmadaGet(clave, segundos = cfg.urlFirmadaSegundos) {
      return getSignedUrl(clienteFirmas, new GetObjectCommand({ Bucket, Key: clave }), {
        expiresIn: segundos,
      });
    },

    async existeObjeto(clave) {
      try {
        await cliente.send(new HeadObjectCommand({ Bucket, Key: clave }));
        return true;
      } catch (err) {
        if (esNoEncontrado(err)) return false;
        throw err;
      }
    },

    async leerObjeto(clave) {
      const r = await cliente.send(new GetObjectCommand({ Bucket, Key: clave }));
      return r.Body;
    },

    // Crear buckets en R2 requiere un token "Admin Read & Write". En servidores el bucket se
    // crea desde el panel de Cloudflare y la API no llama a esta función en producción.
    async asegurarBucket() {
      try {
        await cliente.send(new HeadBucketCommand({ Bucket }));
      } catch (err) {
        if (!esNoEncontrado(err)) throw err;
        await cliente.send(new CreateBucketCommand({ Bucket }));
      }
    },

    // Listar objetos funciona con un token "Object Read" limitado al bucket (HeadBucket no
    // está garantizado con ese permiso) y falla si el bucket no existe o el token no sirve.
    async verificar() {
      await cliente.send(new ListObjectsV2Command({ Bucket, Prefix: PREFIJO_SALUD, MaxKeys: 1 }));
      return true;
    },
  };
}

module.exports = { crearAdaptadorS3, opcionesCliente };
