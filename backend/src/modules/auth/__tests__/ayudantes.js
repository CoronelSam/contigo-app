'use strict';

// Ayudantes de las pruebas del módulo auth.

const correo = require('../../../core/correo');

/** Espera (hasta ~1 s) a que el proveedor simulado haya "enviado" `n` correos. */
async function esperarCorreos(n = 1) {
  for (let i = 0; i < 100 && correo.enviados.length < n; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return correo.enviados;
}

/** Token del enlace de un correo simulado. */
function tokenDelCorreo(enviado) {
  const [, token] = enviado.texto.match(/token=([^\s&]+)/) ?? [];
  if (!token) throw new Error('El correo no trae un enlace con token');
  return decodeURIComponent(token);
}

const REGISTRO = Object.freeze({
  nombres: 'Familia',
  apellidos: 'Prueba',
  telefono: '9999-0000',
  correo: 'Nueva.Familia@Pruebas.test',
  contrasena: 'una-contrasena-segura',
  idioma: 'es',
  aceptaTerminos: true,
  terminosVersion: '2026-11',
});

module.exports = { esperarCorreos, tokenDelCorreo, REGISTRO, correo };
