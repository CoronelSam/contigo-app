'use strict';

// Una vez por corrida de Jest: deja la base de pruebas limpia, migrada y con los seeders base.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

require('./setup-env');

const raiz = path.resolve(__dirname, '..');
const sequelizeCli = path.join(raiz, 'node_modules', '.bin', 'sequelize-cli');

function correr(comando, args) {
  try {
    execFileSync(comando, args, { cwd: raiz, env: process.env, stdio: 'pipe' });
  } catch (err) {
    const salida = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    throw new Error(
      `Falló "${path.basename(comando)} ${args.join(' ')}" al preparar la base de pruebas:\n${salida}`,
      { cause: err },
    );
  }
}

module.exports = async () => {
  if (!process.env.DATABASE_URL_TEST) {
    throw new Error('Falta DATABASE_URL_TEST. Copia .env.example a .env y corre pnpm db:crear');
  }
  correr(process.execPath, [path.join(raiz, 'scripts', 'reiniciar-base.js')]);
  correr(sequelizeCli, ['db:migrate']);
  correr(sequelizeCli, ['db:seed:all']);
};
