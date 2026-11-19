'use strict';

// Cola de trabajos. Proveedor según COLA_PROVEEDOR: "pgboss" o "memoria" (por defecto en pruebas).
//
// Uso típico dentro de una transacción:
//   await cola.encolarTrasCommit(transaction, trabajos.OCR_PROCESAR, { extraccionId });
//
// Handler de un trabajo: async (datos, { trabajo, logger }) => { ... }

const { config } = require('../../config/env');
const { logger } = require('../logger');
const { crearColaMemoria } = require('./memoria');
const { crearColaPgBoss } = require('./pgboss');

/**
 * Crea una cola independiente (útil en pruebas). La app usa la instancia compartida.
 * @param {{ proveedor: 'pgboss' | 'memoria', url?: string, log?: import('pino').Logger }} opciones
 */
function crearCola({ proveedor, url, log = logger }) {
  return proveedor === 'memoria' ? crearColaMemoria({ log }) : crearColaPgBoss({ url, log });
}

let compartida;

function obtener() {
  if (!compartida) {
    const cfg = config();
    compartida = crearCola({ proveedor: cfg.cola.proveedor, url: cfg.baseDatosUrl });
  }
  return compartida;
}

function soloMemoria(metodo) {
  const cola = obtener();
  if (typeof cola[metodo] !== 'function') {
    throw new Error(`cola.${metodo}() solo existe con COLA_PROVEEDOR=memoria`);
  }
  return cola;
}

module.exports = {
  crearCola,

  /** @param {{ modo?: 'productor' | 'trabajador', intervaloSegundos?: number }} [opciones] */
  iniciar: (opciones) => obtener().iniciar(opciones),
  detener: () => obtener().detener(),

  /** Registra el handler de un trabajo (el worker lo hace con src/jobs.js). */
  registrar: (nombre, handler) => obtener().registrar(nombre, handler),

  /**
   * Encola de inmediato. Dentro de una transacción usa encolarTrasCommit.
   * @param {string} nombre Constante de core/cola/trabajos.js
   * @param {object} [datos] Solo ids y datos mínimos; nunca datos médicos.
   * @param {object} [opciones] Opciones de envío de pg-boss.
   */
  enviar: (nombre, datos, opciones) => obtener().enviar(nombre, datos, opciones),

  /**
   * Encola cuando la transacción hace commit. Si se revierte, no se encola nada.
   * @param {import('sequelize').Transaction | null | undefined} transaction
   * @param {string} nombre
   * @param {object} [datos]
   * @param {object} [opciones]
   */
  async encolarTrasCommit(transaction, nombre, datos, opciones) {
    if (!transaction) return obtener().enviar(nombre, datos, opciones);
    transaction.afterCommit(async () => {
      try {
        await obtener().enviar(nombre, datos, opciones);
      } catch (err) {
        logger.error({ err, trabajo: nombre }, 'No se pudo encolar el trabajo después del commit');
      }
    });
    return undefined;
  },

  /** Para /health. */
  verificar: () => obtener().verificar(),

  /** Solo pruebas (memoria): ejecuta los trabajos pendientes. */
  procesarPendientes: (opciones) => soloMemoria('procesarPendientes').procesarPendientes(opciones),
  /** Solo pruebas (memoria): lista los trabajos pendientes. */
  pendientes: () => soloMemoria('pendientes').pendientes(),
  /** Solo pruebas (memoria): descarta pendientes y handlers registrados. */
  vaciar: () => soloMemoria('vaciar').vaciar(),
};
