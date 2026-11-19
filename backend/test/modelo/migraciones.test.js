'use strict';

// Ida y vuelta completa de las migraciones sobre la base de pruebas. Al terminar deja la base
// migrada y sembrada, igual que el setup global, para los demás archivos de prueba.

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sequelize } = require('../../src/models');

const raiz = path.resolve(__dirname, '..', '..');
const cli = (...args) =>
  execFileSync(path.join(raiz, 'node_modules', '.bin', 'sequelize-cli'), args, {
    cwd: raiz,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  }).toString();

const contar = async () => {
  const [{ tablas }] = await sequelize.query(
    "SELECT count(*)::int AS tablas FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'Sequelize%'",
    { type: sequelize.QueryTypes.SELECT },
  );
  const [{ extras }] = await sequelize.query(
    `SELECT (SELECT count(*) FROM pg_class WHERE relname = 'solicitud_codigo_seq')
          + (SELECT count(*) FROM pg_proc WHERE proname = 'f_unaccent') AS extras`,
    { type: sequelize.QueryTypes.SELECT },
  );
  return { tablas, extras: Number(extras) };
};

describe('migraciones', () => {
  test('se deshacen todas y se vuelven a aplicar', async () => {
    await sequelize.query('TRUNCATE "SequelizeData"');
    cli('db:migrate:undo:all');
    expect(await contar()).toEqual({ tablas: 0, extras: 0 });

    cli('db:migrate');
    cli('db:seed:all');
    expect(await contar()).toEqual({ tablas: 43, extras: 2 });
    const [{ municipios }] = await sequelize.query(
      'SELECT count(*)::int AS municipios FROM municipios',
      {
        type: sequelize.QueryTypes.SELECT,
      },
    );
    expect(municipios).toBe(298);
  }, 60_000);
});
