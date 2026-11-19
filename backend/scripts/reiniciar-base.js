'use strict';

// Borra TODO el contenido de la base (esquemas public y pgboss) para empezar de cero.
// Lo usan `pnpm db:reset` y el setup global de las pruebas. Nunca corre en producción
// ni contra un servidor que no sea local.

require('../src/config/database'); // carga .env si existe

const { Client } = require('pg');

const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function main() {
  const entorno = process.env.NODE_ENV ?? 'development';
  if (entorno === 'production') {
    throw new Error('reiniciar-base no se puede usar en producción');
  }
  const url = entorno === 'test' ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (!url) throw new Error(`Falta ${entorno === 'test' ? 'DATABASE_URL_TEST' : 'DATABASE_URL'}`);

  const { hostname, pathname } = new URL(url);
  if (!HOSTS_LOCALES.has(hostname) && process.env.REINICIAR_BASE_REMOTA !== 'true') {
    throw new Error(`Por seguridad solo se reinician bases locales (host: ${hostname})`);
  }

  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
    await cliente.query('DROP SCHEMA IF EXISTS public CASCADE');
    await cliente.query('CREATE SCHEMA public');
  } finally {
    await cliente.end();
  }
  console.log(`Base ${pathname.slice(1)} reiniciada (${entorno})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
