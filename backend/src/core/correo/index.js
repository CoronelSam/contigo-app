'use strict';

// Envío de correos con el proveedor de CORREO_PROVEEDOR:
// - smtp: nodemailer (Mailpit de Homebrew en desarrollo, si lo usas).
// - simulado: no envía. Guarda en memoria (pruebas) y, en desarrollo, escribe cada correo en
//   tmp/correos/*.eml para poder abrir los enlaces de recuperación e invitación.
//
// Los logs nunca incluyen el cuerpo del correo ni el destinatario completo.

const fs = require('node:fs/promises');
const path = require('node:path');
const nodemailer = require('nodemailer');
const { config } = require('../../config/env');
const { logger } = require('../logger');
const cola = require('../cola');
const T = require('../cola/trabajos');
const { renderizarCorreo, PLANTILLAS } = require('./plantillas');

/** Correos "enviados" con el proveedor simulado (solo pruebas). */
const enviados = [];

let transporte;

function enmascarar(correo) {
  const [usuario = '', dominio = ''] = String(correo).split('@');
  return `${usuario.slice(0, 2)}***@${dominio}`;
}

function obtenerTransporte() {
  const c = config().correo;
  transporte ??= nodemailer.createTransport({
    host: c.host,
    port: c.puerto,
    secure: c.seguro,
    auth: c.usuario ? { user: c.usuario, pass: c.contrasena } : undefined,
  });
  return transporte;
}

async function guardarEml({ para, plantilla, asunto, texto }) {
  const carpeta = path.resolve('tmp', 'correos');
  await fs.mkdir(carpeta, { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const asuntoCodificado = `=?UTF-8?B?${Buffer.from(asunto).toString('base64')}?=`;
  const contenido = [
    `From: ${config().correo.remitente}`,
    `To: ${para}`,
    `Subject: ${asuntoCodificado}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    texto,
    '',
  ].join('\r\n');
  const archivo = path.join(carpeta, `${marca}-${plantilla}.eml`);
  await fs.writeFile(archivo, contenido);
  return archivo;
}

/**
 * Envía un correo ya (sin cola).
 * @param {{ plantilla: string, para: string, idioma?: 'es' | 'en', variables?: object }} p
 */
async function enviarCorreo({ plantilla, para, idioma = 'es', variables = {} }) {
  const { asunto, texto, html } = renderizarCorreo(plantilla, idioma, variables);
  const cfg = config();
  if (cfg.correo.proveedor === 'simulado') {
    enviados.push({ plantilla, para, idioma, asunto, texto, html });
    if (cfg.entorno === 'development') {
      const archivo = await guardarEml({ para, plantilla, asunto, texto });
      logger.info({ plantilla, destino: enmascarar(para), archivo }, 'Correo simulado guardado');
    }
    return { simulado: true };
  }
  await obtenerTransporte().sendMail({
    from: cfg.correo.remitente,
    to: para,
    subject: asunto,
    text: texto,
    html,
  });
  logger.info({ plantilla, destino: enmascarar(para) }, 'Correo enviado');
  return { simulado: false };
}

/**
 * Encola el correo para el worker (después del commit si hay transacción).
 * Ojo: los datos del trabajo quedan en la base (pg-boss). Para enlaces de un solo uso, prefiere
 * enviarCorreo directo tras el commit o un enlace que no sirva sin el resto del flujo.
 * @param {{ plantilla: string, para: string, idioma?: 'es' | 'en', variables?: object,
 *   transaction?: import('sequelize').Transaction }} p
 */
async function encolarCorreo({ plantilla, para, idioma = 'es', variables = {}, transaction }) {
  if (!PLANTILLAS[plantilla]) throw new Error(`Plantilla de correo desconocida: ${plantilla}`);
  return cola.encolarTrasCommit(transaction, T.CORREO_ENVIAR, {
    plantilla,
    para,
    idioma,
    variables,
  });
}

/** Solo pruebas. */
function limpiarEnviados() {
  enviados.length = 0;
}

module.exports = { enviarCorreo, encolarCorreo, enviados, limpiarEnviados, enmascarar };
