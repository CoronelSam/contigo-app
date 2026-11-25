'use strict';

// Motor de reglas de ruta. Las reglas NO deciden: sugieren una ruta con sus motivos, y una
// persona decide. Se evalúan las reglas de la versión activa por prioridad ascendente: la primera
// que se cumple da la sugerencia; los motivos de todas las que se cumplen se devuelven en orden.

const jsonLogic = require('json-logic-js');
const { HECHOS, HECHOS_DE_EJEMPLO, construirHechos } = require('./hechos');

const POR_EVALUAR = 'POR_EVALUAR';

const modelos = () => require('../../models');

/**
 * Problema de una condición, o null si es válida: solo usa hechos conocidos y JsonLogic
 * reconoce todas sus operaciones.
 * @param {unknown} condicion
 * @returns {null | { codigo: string, variables?: string[] }}
 */
function problemaDeCondicion(condicion) {
  if (!condicion || typeof condicion !== 'object' || Array.isArray(condicion)) {
    return { codigo: 'CONDICION_INVALIDA' };
  }
  const desconocidas = jsonLogic
    .uses_data(condicion)
    .filter((v) => !HECHOS.includes(String(v).split('.')[0]));
  if (desconocidas.length) return { codigo: 'VARIABLE_DESCONOCIDA', variables: desconocidas };
  try {
    jsonLogic.apply(condicion, structuredClone(HECHOS_DE_EJEMPLO));
  } catch {
    return { codigo: 'CONDICION_INVALIDA' };
  }
  return null;
}

/** Versión activa de las reglas (la de alguna regla con `activa = true`), o null. */
async function versionActiva(transaction) {
  const { ReglaRuta } = modelos();
  const regla = await ReglaRuta.findOne({
    where: { activa: true },
    attributes: ['version'],
    transaction,
  });
  return regla?.version ?? null;
}

/**
 * Evalúa las reglas de una versión sobre unos hechos.
 * @param {object[]} reglas Ordenadas por prioridad.
 * @param {object} hechos
 */
function evaluar(reglas, hechos) {
  const cumplidas = reglas.filter((r) => {
    try {
      return jsonLogic.truthy(jsonLogic.apply(r.condicion, structuredClone(hechos)));
    } catch {
      return false; // Una regla que no se puede evaluar no se cumple.
    }
  });
  return {
    rutaSugerida: cumplidas[0]?.rutaSugerida ?? POR_EVALUAR,
    motivos: cumplidas.map((r) => ({
      reglaId: r.id,
      nombre: r.nombre,
      rutaSugerida: r.rutaSugerida,
      motivoEs: r.motivoEs,
      motivoEn: r.motivoEn,
    })),
  };
}

/**
 * Sugerencia de ruta para el expediente, con los hechos usados. No guarda nada.
 * @param {string} solicitudId
 * @param {{ transaction?: import('sequelize').Transaction }} [opciones]
 * @returns {Promise<{ rutaSugerida: string, motivos: object[], versionReglas: number | null,
 *   hechos: object }>}
 */
async function sugerirRuta(solicitudId, { transaction } = {}) {
  const { ReglaRuta } = modelos();
  const hechos = await construirHechos(solicitudId, { transaction });
  const version = await versionActiva(transaction);
  const reglas =
    version === null
      ? []
      : await ReglaRuta.findAll({
          where: { version },
          order: [
            ['prioridad', 'ASC'],
            ['nombre', 'ASC'],
          ],
          transaction,
        });
  return { ...evaluar(reglas, hechos), versionReglas: version, hechos };
}

/** Motivos en el idioma pedido. */
const motivosEn = (motivos, idioma) =>
  motivos.map((m) => ({
    reglaId: m.reglaId,
    nombre: m.nombre,
    rutaSugerida: m.rutaSugerida,
    motivo: idioma === 'en' ? m.motivoEn : m.motivoEs,
  }));

module.exports = {
  POR_EVALUAR,
  problemaDeCondicion,
  versionActiva,
  evaluar,
  sugerirRuta,
  motivosEn,
};
