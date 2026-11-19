'use strict';

// Contratos del módulo OCR (dueño: agente 07). Stub creado por el agente 02:
// el agente 07 implementa el cuerpo SIN cambiar la firma. Los usan los agentes 06 y 11.

const { z } = require('../../openapi/zod');
const { NoImplementado } = require('../../core/errores');

/**
 * Crea la extracción `en_cola` del documento y encola `ocr.procesar` tras el commit.
 * Si el tipo de documento no tiene plantilla con zonas de OCR, no hace nada y devuelve null.
 *
 * @param {{ documentoId: string, transaction: import('sequelize').Transaction }} p
 * @returns {Promise<object | null>} La extracción creada, o null.
 */
// eslint-disable-next-line no-unused-vars
async function encolarExtraccion({ documentoId, transaction }) {
  throw new NoImplementado('encolarExtraccion (agente 07)');
}

/**
 * Cancela la extracción en curso del documento (`en_cola` o `procesando` → `cancelada`).
 *
 * @param {{ documentoId: string, transaction: import('sequelize').Transaction }} p
 * @returns {Promise<boolean>} true si había una extracción que cancelar.
 */
// eslint-disable-next-line no-unused-vars
async function cancelarExtraccion({ documentoId, transaction }) {
  throw new NoImplementado('cancelarExtraccion (agente 07)');
}

/**
 * Esquema de `plantillas_formulario.zonas_ocr` (ver brief 07). El agente 11 lo usa al
 * registrar plantillas. Hasta que el agente 07 lo defina, acepta cualquier valor.
 */
const esquemaZonasOcr = z.any();

module.exports = { encolarExtraccion, cancelarExtraccion, esquemaZonasOcr };
