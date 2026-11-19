'use strict';

// Contexto de la petición (usuario, IP, dispositivo, id de petición) con AsyncLocalStorage.
// Los servicios lo leen con contexto.actual() para auditar sin recibir `req`.
// Los trabajos del worker y los scripts corren con el contexto de sistema.

const { AsyncLocalStorage } = require('node:async_hooks');

const almacen = new AsyncLocalStorage();

/** Contexto cuando no hay petición (worker, scripts, pruebas sin app). */
const CONTEXTO_SISTEMA = Object.freeze({
  usuario: null,
  ip: null,
  dispositivo: 'sistema',
  requestId: null,
  sistema: true,
});

/**
 * @typedef {{ id: string, rol: string, permisos: Set<string>, idioma: string }} UsuarioAutenticado
 * @typedef {{ usuario: UsuarioAutenticado | null, ip: string | null, dispositivo: string | null,
 *   requestId: string | null, sistema?: boolean }} Contexto
 */

/** Middleware que abre el contexto de cada petición. Va después de express.json(). */
function middlewareContexto(req, res, next) {
  const dispositivo = req.get('x-dispositivo') ?? req.get('user-agent') ?? null;
  const ctx = {
    usuario: null,
    ip: req.ip ?? null,
    dispositivo: dispositivo ? dispositivo.slice(0, 255) : null,
    requestId: req.id ?? null,
  };
  req.contexto = ctx;
  almacen.run(ctx, next);
}

/**
 * Vuelve a entrar al contexto de la petición. Úsalo después de middlewares que leen streams
 * (por ejemplo multer), porque los eventos del stream pierden el contexto asíncrono.
 */
function reanudar(req, res, next) {
  if (req.contexto) almacen.run(req.contexto, next);
  else next();
}

/** @returns {Contexto} */
function actual() {
  return almacen.getStore() ?? CONTEXTO_SISTEMA;
}

/** Guarda el usuario autenticado en el contexto actual (lo hace requiereAuth). */
function asignarUsuario(usuario) {
  const ctx = almacen.getStore();
  if (ctx) ctx.usuario = usuario;
}

/**
 * Ejecuta `fn` con un contexto propio (worker, pruebas).
 * @template T
 * @param {Partial<Contexto>} ctx
 * @param {() => T} fn
 * @returns {T}
 */
function ejecutarCon(ctx, fn) {
  return almacen.run({ ...CONTEXTO_SISTEMA, ...ctx }, fn);
}

module.exports = {
  middlewareContexto,
  reanudar,
  actual,
  asignarUsuario,
  ejecutarCon,
  CONTEXTO_SISTEMA,
};
