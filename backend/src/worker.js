'use strict';

// Proceso de trabajos en cola: pnpm worker
// Registra los handlers de src/jobs.js. Reintentos: 3 con espera exponencial (core/cola/pgboss.js).

const { config } = require('./config/env');

let cfg;
try {
  cfg = config();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { logger } = require('./core/logger');
const { sequelize } = require('./models');
const cola = require('./core/cola');
const trabajos = require('./jobs');

const ESPERA_CIERRE_MS = 25_000;

async function main() {
  if (cfg.cola.proveedor !== 'pgboss') {
    throw new Error('El worker necesita COLA_PROVEEDOR=pgboss');
  }
  await sequelize.authenticate();

  for (const [nombre, cargar] of Object.entries(trabajos)) {
    const handler = cargar();
    await cola.registrar(nombre, handler);
  }
  await cola.iniciar({ modo: 'trabajador' });
  logger.info({ trabajos: Object.keys(trabajos) }, 'Worker listo');

  let cerrando = false;
  const cerrar = async (senal) => {
    if (cerrando) return;
    cerrando = true;
    logger.info({ senal }, 'Cerrando el worker (esperando los trabajos en curso)');
    setTimeout(() => process.exit(1), ESPERA_CIERRE_MS).unref();
    await cola.detener().catch((err) => logger.error({ err }, 'Error al detener la cola'));
    await sequelize.close().catch((err) => logger.error({ err }, 'Error al cerrar la base'));
    process.exit(0);
  };
  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'El worker no pudo arrancar');
  process.exit(1);
});
