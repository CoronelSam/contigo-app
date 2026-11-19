'use strict';

// Levanta o baja la infraestructura local con Docker Compose.
// Usa `docker compose` si el plugin está instalado y, si no, `docker-compose`.

const { spawnSync } = require('node:child_process');

const accion = process.argv[2];
const argumentos = {
  up: ['up', '-d', '--wait'],
  down: ['down'],
}[accion];

if (!argumentos) {
  console.error('Uso: node scripts/infra.js <up|down>');
  process.exit(1);
}

function disponible(comando, args) {
  const r = spawnSync(comando, args, { stdio: 'ignore' });
  return r.status === 0;
}

let comando;
let base;
if (disponible('docker', ['compose', 'version'])) {
  comando = 'docker';
  base = ['compose'];
} else if (disponible('docker-compose', ['version'])) {
  comando = 'docker-compose';
  base = [];
} else {
  console.error('No se encontró Docker Compose. Instala Docker y el plugin "compose".');
  process.exit(1);
}

const r = spawnSync(comando, [...base, ...argumentos], { stdio: 'inherit' });
process.exit(r.status ?? 1);
