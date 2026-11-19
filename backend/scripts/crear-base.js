'use strict';

// Prepara el PostgreSQL local: crea el rol y las bases de DATABASE_URL y DATABASE_URL_TEST
// si no existen. Es idempotente: pnpm db:crear
//
// Se conecta como administrador con ADMIN_DATABASE_URL o, si no está, a la base "postgres"
// del mismo servidor con el usuario del sistema (el superusuario por defecto de Homebrew).

require('../src/config/database'); // carga .env si existe

const { Client } = require('pg');

const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function datosDe(url, variable) {
  const u = new URL(url);
  const datos = {
    variable,
    host: u.hostname,
    puerto: u.port || '5432',
    usuario: decodeURIComponent(u.username),
    contrasena: u.password ? decodeURIComponent(u.password) : null,
    base: decodeURIComponent(u.pathname.slice(1)),
  };
  if (!datos.usuario || !datos.base) {
    throw new Error(
      `${variable} debe incluir usuario y base: postgres://usuario:clave@host:5432/base`,
    );
  }
  if (!HOSTS_LOCALES.has(datos.host)) {
    throw new Error(
      `${variable} no apunta a un servidor local (${datos.host}); este script es solo para desarrollo`,
    );
  }
  return datos;
}

async function main() {
  const destinos = ['DATABASE_URL', 'DATABASE_URL_TEST']
    .filter((v) => process.env[v])
    .map((v) => datosDe(process.env[v], v));
  if (!destinos.length)
    throw new Error('Define DATABASE_URL y DATABASE_URL_TEST en .env (ver .env.example)');

  const { host, puerto } = destinos[0];
  const admin = new Client({
    connectionString: process.env.ADMIN_DATABASE_URL ?? `postgres://${host}:${puerto}/postgres`,
  });
  await admin.connect();
  try {
    for (const d of destinos) {
      const rol = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [d.usuario]);
      if (!rol.rowCount) {
        const clave = d.contrasena ? ` PASSWORD ${admin.escapeLiteral(d.contrasena)}` : '';
        await admin.query(`CREATE ROLE ${admin.escapeIdentifier(d.usuario)} LOGIN${clave}`);
        console.log(`Rol ${d.usuario} creado`);
      }

      const base = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [d.base]);
      if (base.rowCount) {
        console.log(`Base ${d.base} ya existe (${d.variable})`);
      } else {
        await admin.query(
          `CREATE DATABASE ${admin.escapeIdentifier(d.base)} OWNER ${admin.escapeIdentifier(d.usuario)}`,
        );
        console.log(`Base ${d.base} creada (${d.variable})`);
      }
    }
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('PostgreSQL no está corriendo. Con Homebrew: brew services start postgresql@18');
  }
  process.exit(1);
});
