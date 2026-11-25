'use strict';

// Utilidades del módulo ruta.

const ZONA_HORARIA = 'America/Tegucigalpa';

/** Hoy en Honduras, AAAA-MM-DD. */
const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA });
const iso = (f) => (f ? new Date(f).toISOString() : null);
const idiomaDe = (usuario) => (usuario?.idioma === 'en' ? 'en' : 'es');
const nombrePersona = (u) => (u ? [u.nombres, u.apellidos].filter(Boolean).join(' ') : null);

/** Hora `HH:MM` (la base la guarda como `HH:MM:SS`). */
const horaCorta = (h) => (h ? String(h).slice(0, 5) : null);

module.exports = { hoyIso, iso, idiomaDe, nombrePersona, horaCorta };
