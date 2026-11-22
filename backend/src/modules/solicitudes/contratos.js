'use strict';

// Contratos del módulo solicitudes (dueño: agente 05). Lo usa el agente 07 (OCR).

/**
 * Fusiona en una sección los valores que un humano confirmó en la revisión de OCR.
 *
 * Debe: validar el resultado en nivel borrador con el esquema de la sección, subir la versión,
 * poner `origen = 'ocr'` (o `'mixto'` si ya había datos de la app), recalcular el estado,
 * auditar y emitir `seccion.guardada`. Si un valor no pasa el esquema, lanza 400 VALIDACION con
 * `campos` (por rutaDato) y no guarda nada.
 *
 * Detalles de la implementación:
 * - Un `valor` null borra el campo de esa ruta.
 * - Una `rutaDato` que no es un JSON Pointer válido responde 400 con `RUTA_INVALIDA`.
 * - No revisa la ventana de edición: eso lo hace quien llama, con el usuario de la petición.
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
async function fusionarValoresOcr({ solicitudId, seccion, valores, usuarioId, transaction }) {
  const { fusionarValoresOcr: fusionar } = require('./secciones.service');
  return fusionar({ solicitudId, seccion, valores, usuarioId, transaction });
}

module.exports = { fusionarValoresOcr };
