'use strict';

// Utilidades del módulo paquetes.

const ZONA_HORARIA = 'America/Tegucigalpa';

/** Hoy en Honduras, AAAA-MM-DD. */
const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA });
const iso = (f) => (f ? new Date(f).toISOString() : null);

/**
 * Nombre y id de varios usuarios del personal, para mostrar quién generó, revisó o registró.
 * @param {(string | null | undefined)[]} ids
 * @param {import('sequelize').Transaction} [transaction]
 * @returns {Promise<(id: string | null) => { id: string, nombre: string | null } | null>}
 */
async function usuariosBreves(ids, transaction) {
  const { Usuario } = require('../../models');
  const unicos = [...new Set(ids.filter(Boolean))];
  const filas = unicos.length
    ? await Usuario.findAll({
        where: { id: unicos },
        attributes: ['id', 'nombres', 'apellidos'],
        transaction,
      })
    : [];
  const porId = new Map(
    filas.map((u) => [
      u.id,
      { id: u.id, nombre: [u.nombres, u.apellidos].filter(Boolean).join(' ') || null },
    ]),
  );
  return (id) => (id ? (porId.get(id) ?? { id, nombre: null }) : null);
}

/** Datos breves de la solicitud para las respuestas. */
const solicitudBreve = (s) => ({ id: s.id, codigo: s.codigo, estado: s.estado, etapa: s.etapa });

module.exports = { hoyIso, iso, usuariosBreves, solicitudBreve };
