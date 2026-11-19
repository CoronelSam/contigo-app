'use strict';

// Registro de chequeos de salud para GET /health y el panel del administrador (51).
// Cada módulo puede registrar el suyo: registrarChequeo('ocr', async () => { ... }).

const LIMITE_MS = 2000;

/** @type {Map<string, () => Promise<unknown>>} */
const chequeos = new Map();

/**
 * Registra (o reemplaza) un chequeo. La función debe lanzar si el componente no responde.
 * @param {string} nombre
 * @param {() => Promise<unknown>} fn
 */
function registrarChequeo(nombre, fn) {
  chequeos.set(nombre, fn);
}

/** Solo pruebas. */
function quitarChequeo(nombre) {
  chequeos.delete(nombre);
}

function conLimite(promesa, ms) {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error('Tiempo de espera agotado')), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

/**
 * Ejecuta todos los chequeos en paralelo, cada uno con un límite de 2 s.
 * No devuelve mensajes de error: solo si respondió y cuánto tardó.
 * @param {{ limiteMs?: number, logger?: import('pino').Logger }} [opciones]
 * @returns {Promise<{ estado: 'operativo' | 'degradado', chequeos: Record<string, { ok: boolean, ms: number }> }>}
 */
async function ejecutarChequeos({ limiteMs = LIMITE_MS, logger } = {}) {
  const resultados = {};
  await Promise.all(
    [...chequeos].map(async ([nombre, fn]) => {
      const inicio = performance.now();
      try {
        await conLimite(Promise.resolve().then(fn), limiteMs);
        resultados[nombre] = { ok: true, ms: Math.round(performance.now() - inicio) };
      } catch (err) {
        logger?.warn({ err, chequeo: nombre }, 'Chequeo de salud fallido');
        resultados[nombre] = { ok: false, ms: Math.round(performance.now() - inicio) };
      }
    }),
  );
  const ok = Object.values(resultados).every((r) => r.ok);
  return { estado: ok ? 'operativo' : 'degradado', chequeos: resultados };
}

/** Registra los chequeos base: base de datos, cola y almacenamiento. */
function registrarChequeosBase() {
  registrarChequeo('db', async () => {
    const { sequelize } = require('../../models');
    await sequelize.query('SELECT 1');
  });
  registrarChequeo('cola', () => require('../cola').verificar());
  registrarChequeo('almacenamiento', () => require('../almacenamiento').verificar());
}

module.exports = {
  registrarChequeo,
  quitarChequeo,
  ejecutarChequeos,
  registrarChequeosBase,
  LIMITE_MS,
};
