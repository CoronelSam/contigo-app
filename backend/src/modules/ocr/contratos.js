'use strict';

// Contratos del módulo OCR (dueño: agente 07). Los usan los agentes 06 y 11.

const { esquemaZonasOcr } = require('./zonas');

/**
 * Crea la extracción `en_cola` del documento y encola `ocr.procesar` tras el commit.
 * Si el tipo de documento no tiene plantilla con zonas de OCR, no hace nada y devuelve null.
 *
 * @param {{ documentoId: string, transaction: import('sequelize').Transaction }} p
 * @returns {Promise<object | null>} La extracción creada, o null.
 */
async function encolarExtraccion({ documentoId, transaction }) {
  return require('./extracciones.service').encolarExtraccion({ documentoId, transaction });
}

/**
 * Cancela la extracción en curso del documento (`en_cola` o `procesando` → `cancelada`).
 *
 * @param {{ documentoId: string, transaction: import('sequelize').Transaction }} p
 * @returns {Promise<boolean>} true si había una extracción que cancelar.
 */
async function cancelarExtraccion({ documentoId, transaction }) {
  return require('./extracciones.service').cancelarExtraccion({ documentoId, transaction });
}

/**
 * Esquema de `plantillas_formulario.zonas_ocr` (ver zonas.js). El agente 11 lo usa al registrar
 * plantillas. No admite un tipo `firma`.
 */
module.exports = { encolarExtraccion, cancelarExtraccion, esquemaZonasOcr };
