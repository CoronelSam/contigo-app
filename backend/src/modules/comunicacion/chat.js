'use strict';

// Reglas fijas del chat por caso (31).

const { ROLES } = require('../../core/estados/constantes');

/**
 * Roles que participan en el chat. El voluntario no participa hasta que la organización lo decida
 * (decisión pendiente del DR, pantalla 31). Para sumarlo: agrega ROLES.VOLUNTARIO aquí y dale el
 * permiso `mensaje.enviar` en `src/db/seeders/data/permisos.json`.
 */
const PARTICIPANTES_CHAT = Object.freeze([ROLES.FAMILIA, ROLES.COORDINADOR]);

/** Ante la familia, el personal no tiene nombre. */
const ETIQUETA_EQUIPO = Object.freeze({
  es: 'Coordinador del caso / Equipo Vanguardia',
  en: 'Case coordinator / Vanguardia Team',
});

const MAX_CUERPO = 4000;

/** Lado del chat de un rol: la familia o el equipo (todo el personal). */
const ladoDe = (rol) => (rol === ROLES.FAMILIA ? 'familia' : 'equipo');

module.exports = { PARTICIPANTES_CHAT, ETIQUETA_EQUIPO, MAX_CUERPO, ladoDe };
