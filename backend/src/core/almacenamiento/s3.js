'use strict';

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const CIFRADO = 'AES256';

function crearCliente(cfg, endpoint) {
  return new S3Client({
    region: cfg.region,
    endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
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
  const cliente = crearCliente(cfg, cfg.endpoint);
  // Las URL firmadas se generan con el host que alcanza el teléfono, si es distinto.
  const clienteFirmas = cfg.endpointPublico ? crearCliente(cfg, cfg.endpointPublico) : cliente;
  const Bucket = cfg.bucket;

  return {
    async subirObjeto({ clave, cuerpo, mime }) {
      await cliente.send(
        new PutObjectCommand({
          Bucket,
          Key: clave,
          Body: cuerpo,
          ContentType: mime,
          ServerSideEncryption: CIFRADO,
        }),
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

    async asegurarBucket() {
      try {
        await cliente.send(new HeadBucketCommand({ Bucket }));
      } catch (err) {
        if (!esNoEncontrado(err)) throw err;
        await cliente.send(new CreateBucketCommand({ Bucket }));
      }
    },

    async verificar() {
      await cliente.send(new HeadBucketCommand({ Bucket }));
      return true;
    },
  };
}

module.exports = { crearAdaptadorS3 };
