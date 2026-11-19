'use strict';

// Eventos de dominio en proceso, emitidos después del commit.
// Solo para efectos secundarios que se pueden recalcular (por ejemplo, el estado de la
// asignación del voluntario). Un handler que falla no afecta a quien emite: el error va al log.

const { logger } = require('../logger');

/** Lista cerrada de eventos. */
const EVENTOS = Object.freeze({
  SOLICITUD_ESTADO_CAMBIADO: 'solicitud.estado_cambiado',
  SECCION_GUARDADA: 'seccion.guardada',
  DOCUMENTO_CAPTURADO: 'documento.capturado',
  DOCUMENTO_ESTADO_CAMBIADO: 'documento.estado_cambiado',
  EXTRACCION_CREADA: 'extraccion.creada',
  EXTRACCION_LISTA_PARA_REVISION: 'extraccion.lista_para_revision',
  EXTRACCION_CONFIRMADA: 'extraccion.confirmada',
  ASIGNACION_CREADA: 'asignacion.creada',
});

const NOMBRES = new Set(Object.values(EVENTOS));

/** @type {Map<string, Set<Function>>} */
const suscriptores = new Map();
/** Emisiones en curso (para esperarEventos en pruebas). */
const enCurso = new Set();

function validar(nombre) {
  if (!NOMBRES.has(nombre)) {
    throw new Error(`Evento desconocido: "${nombre}". Usa las constantes de core/eventos`);
  }
}

/**
 * Suscribe un handler. Devuelve una función para cancelar la suscripción.
 * @param {string} nombre
 * @param {(datos: object) => unknown} handler
 */
function suscribir(nombre, handler) {
  validar(nombre);
  if (!suscriptores.has(nombre)) suscriptores.set(nombre, new Set());
  suscriptores.get(nombre).add(handler);
  return () => suscriptores.get(nombre)?.delete(handler);
}

async function emitir(nombre, datos) {
  const handlers = [...(suscriptores.get(nombre) ?? [])];
  await Promise.all(
    handlers.map(async (handler) => {
      try {
        await handler(datos);
      } catch (err) {
        logger.error({ err, evento: nombre }, 'Error en un suscriptor de evento');
      }
    }),
  );
}

function lanzar(nombre, datos) {
  const promesa = emitir(nombre, datos).finally(() => enCurso.delete(promesa));
  enCurso.add(promesa);
}

/**
 * Emite el evento cuando la transacción hace commit (si se revierte, no se emite).
 * Sin transacción, se emite en el siguiente ciclo.
 * @param {import('sequelize').Transaction | null | undefined} transaction
 * @param {string} nombre
 * @param {object} datos Solo ids y códigos, nunca datos médicos.
 */
function emitirTrasCommit(transaction, nombre, datos) {
  validar(nombre);
  if (transaction) transaction.afterCommit(() => lanzar(nombre, datos));
  else setImmediate(() => lanzar(nombre, datos));
}

/** Solo pruebas: espera a que terminen los handlers en curso. */
async function esperarEventos() {
  await new Promise((r) => setImmediate(r));
  while (enCurso.size) await Promise.all([...enCurso]);
}

/** Solo pruebas: quita todas las suscripciones. */
function limpiarSuscripciones() {
  suscriptores.clear();
}

module.exports = { EVENTOS, suscribir, emitirTrasCommit, esperarEventos, limpiarSuscripciones };
