'use strict';

// Bitácora de cambios y registro de accesos. Usuario e IP salen del contexto de la petición.
// Nunca guarda contraseñas, hashes ni tokens: esas claves se reemplazan por "[REDACTADO]".

const contexto = require('../contexto');

const CLAVE_SENSIBLE = /(hash|contrasena|password|token|secreto|refresh)/i;

/** Copia serializable sin campos sensibles (fechas como ISO 8601). */
function sanear(valor) {
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) return valor.map(sanear);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [
        k,
        CLAVE_SENSIBLE.test(k) ? '[REDACTADO]' : sanear(v),
      ]),
    );
  }
  return valor;
}

/** Solo las claves cuyo valor cambió. */
function diferencia(antes = {}, despues = {}) {
  const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  const a = {};
  const d = {};
  for (const k of claves) {
    if (JSON.stringify(antes[k] ?? null) !== JSON.stringify(despues[k] ?? null)) {
      a[k] = antes[k] ?? null;
      d[k] = despues[k] ?? null;
    }
  }
  return { antes: a, despues: d };
}

/**
 * Escribe una entrada en la bitácora. Si hay `antes` y `despues`, guarda solo lo que cambió.
 * @param {{ accion: string, entidad: string, entidadId?: string | number | null,
 *   solicitudId?: string | null, antes?: object | null, despues?: object | null,
 *   transaction?: import('sequelize').Transaction }} p
 */
async function registrarBitacora({
  accion,
  entidad,
  entidadId,
  solicitudId,
  antes,
  despues,
  transaction,
}) {
  const { Bitacora } = require('../../models');
  const ctx = contexto.actual();
  let a = antes ? sanear(antes) : null;
  let d = despues ? sanear(despues) : null;
  if (a && d) ({ antes: a, despues: d } = diferencia(a, d));
  return Bitacora.create(
    {
      usuarioId: ctx.usuario?.id ?? null,
      accion,
      entidad,
      entidadId: entidadId === null || entidadId === undefined ? null : String(entidadId),
      solicitudId: solicitudId ?? null,
      antes: a,
      despues: d,
      ip: ctx.ip,
    },
    { transaction },
  );
}

/**
 * Aplica `cambios` a una instancia de Sequelize y deja en la bitácora el antes y el después.
 * No escribe en la bitácora si nada cambió.
 * @param {import('sequelize').Model} instancia
 * @param {Record<string, unknown>} cambios
 * @param {{ transaction?: import('sequelize').Transaction, accion?: string, solicitudId?: string | null }} [opciones]
 */
async function auditarCambio(instancia, cambios, { transaction, accion, solicitudId } = {}) {
  const claves = Object.keys(cambios);
  const leer = () => Object.fromEntries(claves.map((k) => [k, instancia.get(k)]));
  const antes = sanear(leer());
  await instancia.update(cambios, { transaction });
  const { antes: a, despues: d } = diferencia(antes, sanear(leer()));
  if (!Object.keys(d).length) return instancia;
  const tabla = instancia.constructor.getTableName();
  await registrarBitacora({
    accion: accion ?? `${tabla}.actualizar`,
    entidad: tabla,
    entidadId: instancia.get('id') ?? null,
    solicitudId: solicitudId ?? instancia.get('solicitudId') ?? null,
    antes: a,
    despues: d,
    transaction,
  });
  return instancia;
}

/**
 * Registra que el usuario del contexto abrió un expediente, documento, archivo o paquete.
 * @param {{ solicitudId?: string | null, recurso: 'expediente' | 'historia_clinica' | 'documento' | 'archivo' | 'paquete',
 *   recursoId?: string | null, transaction?: import('sequelize').Transaction }} p
 */
async function registrarAcceso({ solicitudId, recurso, recursoId, transaction }) {
  const { RegistroAcceso } = require('../../models');
  const ctx = contexto.actual();
  if (!ctx.usuario)
    throw new Error('registrarAcceso necesita un usuario autenticado en el contexto');
  return RegistroAcceso.create(
    {
      usuarioId: ctx.usuario.id,
      solicitudId: solicitudId ?? null,
      recurso,
      recursoId: recursoId ?? null,
      ip: ctx.ip,
    },
    { transaction },
  );
}

module.exports = { registrarBitacora, auditarCambio, registrarAcceso, sanear, diferencia };
