'use strict';

// Proceso de la API HTTP: pnpm dev / pnpm start

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
const almacenamiento = require('./core/almacenamiento');
const { crearApp } = require('./app');

const ESPERA_CIERRE_MS = 10_000;

async function main() {
  await sequelize.authenticate();

  if (!cfg.esProduccion) {
    await almacenamiento
      .asegurarBucket()
      .catch((err) => logger.warn({ err }, 'No se pudo comprobar el bucket de almacenamiento'));
  }

  await cola.iniciar({ modo: 'productor' });

  const servidor = crearApp().listen(cfg.puerto, () => {
    logger.info({ puerto: cfg.puerto, entorno: cfg.entorno }, 'API escuchando');
  });

  let cerrando = false;
  const cerrar = async (senal) => {
    if (cerrando) return;
    cerrando = true;
    logger.info({ senal }, 'Cerrando la API');
    setTimeout(() => process.exit(1), ESPERA_CIERRE_MS).unref();
    servidor.close();
    await cola.detener().catch((err) => logger.error({ err }, 'Error al detener la cola'));
    await sequelize.close().catch((err) => logger.error({ err }, 'Error al cerrar la base'));
    process.exit(0);
  };
  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'La API no pudo arrancar');
  process.exit(1);
});
