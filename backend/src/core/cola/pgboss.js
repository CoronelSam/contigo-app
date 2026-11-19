'use strict';

// Cola sobre PostgreSQL con pg-boss (esquema "pgboss" en la misma base).
// La API inicia en modo "productor" (solo encola); src/worker.js en modo "trabajador".

const { NOMBRES, validarNombre } = require('./trabajos');

/** Reintentos: 3, con espera exponencial desde 30 s. Un trabajo vence a los 15 min. */
const OPCIONES_COLA = Object.freeze({
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
});

function crearColaPgBoss({ url, log }) {
  /** @type {import('pg-boss').PgBoss | undefined} */
  let boss;
  let iniciada = false;
  let modo = 'productor';
  let intervaloSegundos = 2;
  /** @type {Map<string, Function>} */
  const handlers = new Map();

  async function asegurarCola(nombre) {
    if (await boss.getQueue(nombre)) return;
    try {
      await boss.createQueue(nombre, OPCIONES_COLA);
    } catch (err) {
      // Otro proceso (API o worker) pudo crearla al mismo tiempo.
      if (!(await boss.getQueue(nombre))) throw err;
    }
  }

  async function trabajar(nombre, handler) {
    await boss.work(
      nombre,
      { batchSize: 1, localConcurrency: 2, pollingIntervalSeconds: intervaloSegundos },
      async ([trabajo]) => {
        const logTrabajo = log.child({
          trabajo: nombre,
          trabajoId: trabajo.id,
          intento: trabajo.retryCount,
        });
        logTrabajo.info('Trabajo iniciado');
        await handler(trabajo.data, { trabajo, logger: logTrabajo });
        logTrabajo.info('Trabajo terminado');
      },
    );
  }

  return {
    proveedor: 'pgboss',

    /**
     * @param {{ modo?: 'productor' | 'trabajador', intervaloSegundos?: number }} [opciones]
     */
    async iniciar(opciones = {}) {
      if (iniciada) return;
      modo = opciones.modo ?? 'productor';
      intervaloSegundos = opciones.intervaloSegundos ?? intervaloSegundos;
      const { PgBoss } = require('pg-boss');
      const esTrabajador = modo === 'trabajador';
      boss = new PgBoss({
        connectionString: url,
        schema: 'pgboss',
        application_name: `vanguardia-${modo}`,
        supervise: esTrabajador,
        schedule: esTrabajador,
        max: esTrabajador ? 5 : 3,
      });
      boss.on('error', (err) => log.error({ err }, 'Error de pg-boss'));
      await boss.start();
      for (const nombre of NOMBRES) await asegurarCola(nombre);
      iniciada = true;
      if (esTrabajador) {
        for (const [nombre, handler] of handlers) await trabajar(nombre, handler);
      }
      log.info({ modo }, 'Cola iniciada');
    },

    async detener() {
      if (!iniciada) return;
      iniciada = false;
      await boss.stop({ graceful: true, timeout: 20_000 });
    },

    async registrar(nombre, handler) {
      validarNombre(nombre);
      handlers.set(nombre, handler);
      if (iniciada && modo === 'trabajador') await trabajar(nombre, handler);
    },

    async enviar(nombre, datos = {}, opciones = {}) {
      validarNombre(nombre);
      if (!iniciada) throw new Error('La cola no está iniciada');
      return boss.send(nombre, datos, opciones);
    },

    async verificar() {
      if (!iniciada) throw new Error('La cola no está iniciada');
      if (!(await boss.isInstalled())) throw new Error('El esquema de pg-boss no está instalado');
      return true;
    },
  };
}

module.exports = { crearColaPgBoss, OPCIONES_COLA };
