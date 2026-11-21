'use strict';

// Contraseñas con argon2id (parámetros mínimos recomendados por OWASP).

const argon2 = require('argon2');
const errores = require('./auth.errores');

const OPCIONES = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

const hashear = (contrasena) => argon2.hash(contrasena, OPCIONES);

async function verificar(hash, contrasena) {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, contrasena);
  } catch {
    return false;
  }
}

let hashFicticio;

/** Verifica contra un hash ficticio para que un correo inexistente tarde lo mismo. */
async function verificarFicticio(contrasena) {
  hashFicticio ??= await hashear('contrasena-ficticia-para-tiempo-constante');
  await verificar(hashFicticio, contrasena);
  return false;
}

/** Reglas que Zod no ve: la contraseña no puede ser el correo. */
function validarPolitica(contrasena, correo, campo = 'contrasena') {
  if (correo && contrasena.trim().toLowerCase() === correo.trim().toLowerCase()) {
    throw errores.contrasenaIgualAlCorreo(campo);
  }
}

module.exports = { hashear, verificar, verificarFicticio, validarPolitica };
