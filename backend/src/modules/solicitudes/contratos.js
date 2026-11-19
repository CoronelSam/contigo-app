'use strict';

// Contratos del módulo solicitudes (dueño: agente 05). Stub creado por el agente 02:
// el agente 05 implementa el cuerpo SIN cambiar la firma. Lo usa el agente 07 (OCR).

const { NoImplementado } = require('../../core/errores');

/**
 * Fusiona en una sección los valores que un humano confirmó en la revisión de OCR.
 *
 * Debe: validar el resultado en nivel borrador con el esquema de la sección, subir la versión,
 * poner `origen = 'ocr'` (o `'mixto'` si ya había datos de la app), recalcular el estado,
 * auditar y emitir `seccion.guardada`. Si un valor no pasa el esquema, lanza 400 VALIDACION con
 * `campos` (por rutaDato) y no guarda nada.
 *
 * @param {object} p
 * @param {string} p.solicitudId
 * @param {string} p.seccion Código de una de las 6 secciones con JSON.
 * @param {Array<{ rutaDato: string, valor: unknown }>} p.valores `rutaDato` es un JSON Pointer
 *   dentro de la sección (por ejemplo `/diagnostico`).
 * @param {string} p.usuarioId Quien confirmó la revisión.
 * @param {import('sequelize').Transaction} p.transaction
 * @returns {Promise<{ seccion: string, version: number, estado: 'vacia' | 'incompleta' | 'completa' }>}
 */
// eslint-disable-next-line no-unused-vars
async function fusionarValoresOcr({ solicitudId, seccion, valores, usuarioId, transaction }) {
  throw new NoImplementado('fusionarValoresOcr (agente 05)');
}

module.exports = { fusionarValoresOcr };
