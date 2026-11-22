'use strict';

// Código de caso. El formato final (con o sin año) es una decisión pendiente de la organización:
// se cambia solo aquí. El número sale de la secuencia `solicitud_codigo_seq` (nunca de contar
// filas), así 2 solicitudes creadas a la vez nunca chocan.

const PREFIJO = 'HN-';
const DIGITOS_MINIMOS = 4;

/** `HN-` + el número con al menos 4 dígitos: 258 → `HN-0258`, 12345 → `HN-12345`. */
const formatearCodigo = (numero) => `${PREFIJO}${String(numero).padStart(DIGITOS_MINIMOS, '0')}`;

/**
 * Toma el siguiente número de la secuencia y devuelve el código.
 * @param {{ transaction?: import('sequelize').Transaction }} [opciones]
 * @returns {Promise<string>}
 */
async function generarCodigo({ transaction } = {}) {
  const { sequelize } = require('../../models');
  const [fila] = await sequelize.query("SELECT nextval('solicitud_codigo_seq') AS n", {
    type: sequelize.QueryTypes.SELECT,
    transaction,
  });
  return formatearCodigo(fila.n);
}

module.exports = { generarCodigo, formatearCodigo };
