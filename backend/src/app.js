'use strict';

require('./openapi/zod'); // extiende Zod con .openapi() antes de cargar cualquier esquema

const { randomUUID } = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const { config } = require('./config/env');
const { logger: loggerCompartido } = require('./core/logger');
const { manejadorErrores, rutaNoEncontrada } = require('./core/errores/manejador');
const { registrarChequeosBase } = require('./core/salud');
const almacenamiento = require('./core/almacenamiento');
const { crearRutasApi } = require('./routes');
const { PREFIJO_API } = require('./openapi/registro');

const ID_PETICION_VALIDO = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Crea la app de Express sin escuchar en un puerto.
 * @param {{ logger?: import('pino').Logger }} [opciones]
 */
function crearApp({ logger = loggerCompartido } = {}) {
  const cfg = config();
  const app = express();

  app.disable('x-powered-by');
  if (cfg.http.trustProxy) app.set('trust proxy', cfg.http.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const entrante = req.headers['x-request-id'];
        const id =
          typeof entrante === 'string' && ID_PETICION_VALIDO.test(entrante)
            ? entrante
            : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Sin query string ni cabeceras: la búsqueda (?q=) puede llevar nombres de niños.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(helmet());
  app.use(cors({ origin: cfg.http.corsOrigenes.length ? cfg.http.corsOrigenes : false }));
  app.use(express.json({ limit: '1mb' }));

  registrarChequeosBase();
  app.use(require('./modules/salud'));
  if (almacenamiento.proveedor() === 'disco') {
    // Descargas firmadas del almacenamiento local de desarrollo (equivalen a URL prefirmadas de S3).
    app.get(`${almacenamiento.RUTA_DESCARGA}/*clave`, almacenamiento.manejarDescarga);
  }
  app.use(PREFIJO_API, crearRutasApi());

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);

  return app;
}

module.exports = { crearApp };
