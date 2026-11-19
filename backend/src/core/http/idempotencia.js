'use strict';

// Idempotency-Key (UUID) sobre la tabla `claves_idempotencia`, por usuario, válida 24 h.
//
// - Misma clave, misma ruta y mismo cuerpo → la respuesta guardada (cabecera Idempotency-Replayed).
// - Misma clave con otro cuerpo u otra ruta → 422 IDEMPOTENCIA_CUERPO_DISTINTO.
// - Misma clave mientras la primera petición sigue en curso → 409 IDEMPOTENCIA_EN_PROCESO.
// - Solo se guardan respuestas 2xx: si la primera falla, un reintento con la misma clave se
//   vuelve a ejecutar.
//
// Va después de requiereAuth. En subidas multipart, ponlo ANTES de multer: así un reintento no
// vuelve a subir el archivo (el hash cubre solo los campos JSON ya leídos).

const crypto = require('node:crypto');
const { AppError, precondicionRequerida, validacion, conflicto } = require('../errores');
const { logger } = require('../logger');

const VIGENCIA_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JSON con claves ordenadas, para que el hash no dependa del orden. */
function serializarEstable(valor) {
  if (Array.isArray(valor)) return `[${valor.map(serializarEstable).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${serializarEstable(valor[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor ?? null);
}

const hashCuerpo = (cuerpo) =>
  crypto
    .createHash('sha256')
    .update(serializarEstable(cuerpo ?? {}))
    .digest('hex');

/**
 * @param {{ obligatorio?: boolean }} [opciones]
 * @returns {import('express').RequestHandler}
 */
function idempotente({ obligatorio = true } = {}) {
  return async (req, res, next) => {
    const clave = req.get('idempotency-key');
    if (!clave) {
      if (obligatorio) throw precondicionRequerida('Falta la cabecera Idempotency-Key');
      return next();
    }
    if (!UUID.test(clave)) throw validacion({ 'Idempotency-Key': 'FORMATO_INVALIDO' });
    if (!req.usuario) throw new Error('idempotente() debe ir después de requiereAuth');

    const { ClaveIdempotencia } = require('../../models');
    const llave = { usuarioId: req.usuario.id, clave };
    const ruta = req.originalUrl.split('?')[0];
    const huella = { metodo: req.method, ruta, hashCuerpo: hashCuerpo(req.body) };

    const [registro, creado] = await ClaveIdempotencia.findOrCreate({
      where: llave,
      defaults: { ...huella, estado: 'en_proceso', expiraEn: new Date(Date.now() + VIGENCIA_MS) },
    });

    if (!creado) {
      if (registro.expiraEn < new Date()) {
        await registro.update({
          ...huella,
          estado: 'en_proceso',
          codigoHttp: null,
          respuesta: null,
          expiraEn: new Date(Date.now() + VIGENCIA_MS),
        });
      } else if (
        registro.metodo !== huella.metodo ||
        registro.ruta !== huella.ruta ||
        registro.hashCuerpo !== huella.hashCuerpo
      ) {
        throw new AppError(
          422,
          'IDEMPOTENCIA_CUERPO_DISTINTO',
          'La Idempotency-Key ya se usó con otra petición',
        );
      } else if (registro.estado === 'en_proceso') {
        throw conflicto(
          'IDEMPOTENCIA_EN_PROCESO',
          'La petición original todavía se está procesando',
        );
      } else {
        res.set('Idempotency-Replayed', 'true');
        return res.status(registro.codigoHttp).json(registro.respuesta);
      }
    }

    let resuelto = false;
    const cerrar = async (cuerpo) => {
      if (resuelto) return;
      resuelto = true;
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          await ClaveIdempotencia.update(
            { estado: 'completada', codigoHttp: res.statusCode, respuesta: cuerpo ?? null },
            { where: llave },
          );
        } else {
          await ClaveIdempotencia.destroy({ where: llave });
        }
      } catch (err) {
        logger.error({ err }, 'No se pudo guardar la respuesta idempotente');
      }
    };

    const jsonOriginal = res.json.bind(res);
    res.json = (cuerpo) => {
      cerrar(cuerpo).finally(() => jsonOriginal(cuerpo));
      return res;
    };
    res.on('finish', () => cerrar(undefined));
    return next();
  };
}

module.exports = { idempotente, hashCuerpo, serializarEstable };
