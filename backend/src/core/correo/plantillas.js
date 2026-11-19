'use strict';

// Correos transaccionales en español e inglés. Nunca incluyen datos médicos.
// Variables comunes: { nombre, enlace } más las propias de cada plantilla.

const escapar = (texto) =>
  String(texto ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function html(parrafos, enlace, boton) {
  const cuerpo = parrafos.map((p) => `<p>${escapar(p)}</p>`).join('\n');
  const accion = enlace ? `<p><a href="${escapar(enlace)}">${escapar(boton)}</a></p>` : '';
  return `<!doctype html><html><body>${cuerpo}${accion}</body></html>`;
}

function correo({ asunto, parrafos, enlace, boton }) {
  const texto = [...parrafos, ...(enlace ? [`${boton}: ${enlace}`] : [])].join('\n\n');
  return { asunto, texto, html: html(parrafos, enlace, boton) };
}

const PLANTILLAS = Object.freeze({
  recuperar_contrasena: {
    es: (v) =>
      correo({
        asunto: 'Recupera tu contraseña de Vanguardia',
        parrafos: [
          `Hola, ${v.nombre}.`,
          `Recibimos una solicitud para cambiar tu contraseña. El enlace vence en ${v.minutos ?? 45} minutos y solo se puede usar una vez.`,
          'Si no fuiste tú, ignora este correo: tu contraseña no cambiará.',
        ],
        enlace: v.enlace,
        boton: 'Crear una contraseña nueva',
      }),
    en: (v) =>
      correo({
        asunto: 'Reset your Vanguardia password',
        parrafos: [
          `Hello, ${v.nombre}.`,
          `We received a request to change your password. The link expires in ${v.minutos ?? 45} minutes and can only be used once.`,
          'If it was not you, ignore this email: your password will not change.',
        ],
        enlace: v.enlace,
        boton: 'Create a new password',
      }),
  },
  invitacion: {
    es: (v) =>
      correo({
        asunto: 'Te invitaron a Vanguardia',
        parrafos: [
          `Hola, ${v.nombre}.`,
          `El equipo Vanguardia te dio acceso como ${v.rol}. Crea tu contraseña con este enlace; vence en ${v.horas ?? 72} horas.`,
        ],
        enlace: v.enlace,
        boton: 'Crear mi contraseña',
      }),
    en: (v) =>
      correo({
        asunto: 'You were invited to Vanguardia',
        parrafos: [
          `Hello, ${v.nombre}.`,
          `The Vanguardia team gave you access as ${v.rol}. Create your password with this link; it expires in ${v.horas ?? 72} hours.`,
        ],
        enlace: v.enlace,
        boton: 'Create my password',
      }),
  },
  verificar_correo: {
    es: (v) =>
      correo({
        asunto: 'Confirma tu correo en Vanguardia',
        parrafos: [
          `Hola, ${v.nombre}.`,
          'Confirma que este correo es tuyo para proteger tu cuenta.',
        ],
        enlace: v.enlace,
        boton: 'Confirmar mi correo',
      }),
    en: (v) =>
      correo({
        asunto: 'Confirm your email for Vanguardia',
        parrafos: [`Hello, ${v.nombre}.`, 'Confirm this email is yours to protect your account.'],
        enlace: v.enlace,
        boton: 'Confirm my email',
      }),
  },
});

/**
 * @param {string} plantilla
 * @param {'es' | 'en'} idioma
 * @param {Record<string, unknown>} variables
 * @returns {{ asunto: string, texto: string, html: string }}
 */
function renderizarCorreo(plantilla, idioma, variables = {}) {
  const p = PLANTILLAS[plantilla];
  if (!p) throw new Error(`Plantilla de correo desconocida: ${plantilla}`);
  return (p[idioma] ?? p.es)(variables);
}

module.exports = { PLANTILLAS, renderizarCorreo, escapar };
