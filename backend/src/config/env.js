'use strict';

const { z } = require('zod');

const opcional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const booleano = (porDefecto) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? porDefecto : v === 'true' || v === '1'));

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_SQL: booleano(false),

    DATABASE_URL: opcional,
    DATABASE_URL_TEST: opcional,

    JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    REFRESH_TTL_DIAS: z.coerce.number().int().positive().default(30),
    AUTH_LIMITE_LOGIN: z.coerce.number().int().positive().default(20),
    AUTH_LIMITE_RECUPERAR: z.coerce.number().int().positive().default(5),
    AUTH_LIMITE_REENVIO: z.coerce.number().int().positive().default(3),

    ALMACENAMIENTO_PROVEEDOR: z.enum(['disco', 's3', 'memoria']).default('disco'),
    ALMACENAMIENTO_DIRECTORIO: z.string().default('tmp/almacenamiento'),
    S3_ENDPOINT: opcional,
    S3_ENDPOINT_PUBLICO: opcional,
    // Cloudflare R2: la región siempre es "auto".
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: opcional,
    S3_ACCESS_KEY: opcional,
    S3_SECRET_KEY: opcional,
    S3_FORCE_PATH_STYLE: booleano(false),
    URL_FIRMADA_SEGUNDOS: z.coerce.number().int().min(30).max(3600).default(300),
    ARCHIVOS_MAX_MB: z.coerce.number().int().min(1).max(50).default(10),
    PAQUETE_ENLACE_MINUTOS: z.coerce.number().int().min(5).max(1440).default(60),
    PAQUETE_MAX_MB: z.coerce.number().int().min(1).max(500).default(50),

    COLA_PROVEEDOR: z.enum(['pgboss', 'memoria']).optional(),

    CORREO_PROVEEDOR: z.enum(['smtp', 'simulado']).default('simulado'),
    SMTP_HOST: opcional,
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SEGURO: booleano(false),
    SMTP_USER: opcional,
    SMTP_PASS: opcional,
    CORREO_REMITENTE: z.string().default('Vanguardia <no-responder@vanguardia.test>'),

    PUSH_PROVEEDOR: z.enum(['fcm', 'simulado']).default('simulado'),
    FCM_CREDENCIALES_JSON_BASE64: opcional,

    OCR_PROVEEDOR: z.enum(['simulado', 'tesseract', 'nube']).default('simulado'),
    OCR_TESSERACT_IDIOMA: z.string().default('spa'),
    OCR_TESSERACT_DATOS: opcional,
    OCR_TESSERACT_CACHE: z.string().default('tmp/ocr'),

    CORS_ORIGENES: z.string().default(''),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    API_URL_PUBLICA: opcional,
    APP_ENLACE_BASE: z.string().default('vanguardia://'),
    DOCS_HABILITADAS: booleano(false),
  })
  .superRefine((e, ctx) => {
    const falta = (campo, motivo) =>
      ctx.addIssue({ code: 'custom', path: [campo], message: `obligatorio ${motivo}` });

    if (e.NODE_ENV === 'test' && !e.DATABASE_URL_TEST) falta('DATABASE_URL_TEST', 'en pruebas');
    if (e.NODE_ENV !== 'test' && !e.DATABASE_URL) falta('DATABASE_URL', 'fuera de pruebas');

    if (e.ALMACENAMIENTO_PROVEEDOR === 's3') {
      for (const campo of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']) {
        if (!e[campo]) falta(campo, 'con ALMACENAMIENTO_PROVEEDOR=s3');
      }
      for (const campo of ['S3_ENDPOINT', 'S3_ENDPOINT_PUBLICO']) {
        if (e[campo] && !URL.canParse(e[campo])) {
          ctx.addIssue({ code: 'custom', path: [campo], message: 'debe ser una URL completa' });
        } else if (e[campo] && e.NODE_ENV === 'production' && !e[campo].startsWith('https://')) {
          ctx.addIssue({ code: 'custom', path: [campo], message: 'debe usar https en producción' });
        }
      }
    }
    if (e.CORREO_PROVEEDOR === 'smtp' && !e.SMTP_HOST)
      falta('SMTP_HOST', 'con CORREO_PROVEEDOR=smtp');
    if (e.PUSH_PROVEEDOR === 'fcm' && !e.FCM_CREDENCIALES_JSON_BASE64) {
      falta('FCM_CREDENCIALES_JSON_BASE64', 'con PUSH_PROVEEDOR=fcm');
    }
    if (e.NODE_ENV === 'production') {
      if (e.ALMACENAMIENTO_PROVEEDOR !== 's3') {
        ctx.addIssue({
          code: 'custom',
          path: ['ALMACENAMIENTO_PROVEEDOR'],
          message: `${e.ALMACENAMIENTO_PROVEEDOR} no se permite en producción (usa s3)`,
        });
      }
      if (e.COLA_PROVEEDOR === 'memoria') {
        ctx.addIssue({
          code: 'custom',
          path: ['COLA_PROVEEDOR'],
          message: 'memoria no se permite en producción',
        });
      }
    }
  });

/**
 * Valida las variables de entorno y devuelve la configuración de la aplicación.
 * @param {NodeJS.ProcessEnv} [env]
 */
function cargarConfig(env = process.env) {
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración inválida. Revisa tu .env (ver .env.example):\n${detalle}`);
  }
  const e = resultado.data;
  const entorno = e.NODE_ENV;

  return Object.freeze({
    entorno,
    esProduccion: entorno === 'production',
    esPrueba: entorno === 'test',
    puerto: e.PORT,
    nivelLog: e.LOG_LEVEL,
    logSql: e.LOG_SQL && entorno === 'development',
    baseDatosUrl: entorno === 'test' ? e.DATABASE_URL_TEST : e.DATABASE_URL,
    jwt: Object.freeze({
      secreto: e.JWT_SECRET,
      accesoTtl: e.JWT_ACCESS_TTL,
      refreshTtlDias: e.REFRESH_TTL_DIAS,
      limites: Object.freeze({
        loginPor15Min: e.AUTH_LIMITE_LOGIN,
        recuperarPorHora: e.AUTH_LIMITE_RECUPERAR,
        reenvioPorHora: e.AUTH_LIMITE_REENVIO,
      }),
    }),
    almacenamiento: Object.freeze({
      proveedor: e.ALMACENAMIENTO_PROVEEDOR,
      directorio: e.ALMACENAMIENTO_DIRECTORIO,
      endpoint: e.S3_ENDPOINT,
      endpointPublico: e.S3_ENDPOINT_PUBLICO,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET ?? 'vanguardia-memoria',
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      urlFirmadaSegundos: e.URL_FIRMADA_SEGUNDOS,
    }),
    archivos: Object.freeze({ maxBytes: e.ARCHIVOS_MAX_MB * 1024 * 1024 }),
    paquetes: Object.freeze({
      enlaceMinutos: e.PAQUETE_ENLACE_MINUTOS,
      maxBytes: e.PAQUETE_MAX_MB * 1024 * 1024,
    }),
    cola: Object.freeze({
      proveedor: e.COLA_PROVEEDOR ?? (entorno === 'test' ? 'memoria' : 'pgboss'),
    }),
    correo: Object.freeze({
      proveedor: e.CORREO_PROVEEDOR,
      host: e.SMTP_HOST,
      puerto: e.SMTP_PORT,
      seguro: e.SMTP_SEGURO,
      usuario: e.SMTP_USER,
      contrasena: e.SMTP_PASS,
      remitente: e.CORREO_REMITENTE,
    }),
    push: Object.freeze({
      proveedor: e.PUSH_PROVEEDOR,
      credencialesBase64: e.FCM_CREDENCIALES_JSON_BASE64,
    }),
    ocr: Object.freeze({
      proveedor: e.OCR_PROVEEDOR,
      tesseract: Object.freeze({
        idioma: e.OCR_TESSERACT_IDIOMA,
        datos: e.OCR_TESSERACT_DATOS,
        cache: e.OCR_TESSERACT_CACHE,
      }),
    }),
    http: Object.freeze({
      corsOrigenes: e.CORS_ORIGENES.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      trustProxy: e.TRUST_PROXY,
      apiUrlPublica: (e.API_URL_PUBLICA ?? `http://localhost:${e.PORT}`).replace(/\/+$/, ''),
      enlaceBase: e.APP_ENLACE_BASE,
      docsHabilitadas: e.DOCS_HABILITADAS,
    }),
  });
}

let configActual;

/** Configuración validada (se calcula una sola vez por proceso). */
function config() {
  if (!configActual) configActual = cargarConfig();
  return configActual;
}

module.exports = { config, cargarConfig };
