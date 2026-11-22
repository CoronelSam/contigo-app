'use strict';

// Secciones del formulario (13–18): borradores con versión, If-Match y estado calculado por el
// servidor. Las dos modalidades escriben aquí: la app con PUT y el OCR con fusionarValoresOcr.

const { obtenerSolicitudConAcceso, exigirEdicion } = require('../../core/acceso');
const { registrarBitacora, registrarAcceso } = require('../../core/auditoria');
const { emitirTrasCommit, EVENTOS } = require('../../core/eventos');
const { noEncontrado, precondicionRequerida, validacion } = require('../../core/errores');
const {
  VERSION_PLANTILLA,
  tieneEsquema,
  validarSeccion,
  pendientesDeSeccion,
} = require('./esquemas');
const errores = require('./solicitudes.errores');
const { esPersonal, iso, idiomaDe, filaBloqueada } = require('./solicitudes.util');

const modelos = () => require('../../models');

/**
 * Versión que el cliente dice tener (`If-Match: "v3"`), o null si no mandó la cabecera.
 * Acepta también la forma débil `W/"v3"`.
 * @param {string | undefined} cabecera
 */
function versionDeIfMatch(cabecera) {
  if (cabecera === undefined || cabecera === '') return null;
  const m = /^(?:W\/)?"v(\d{1,9})"$/.exec(cabecera.trim());
  if (!m) throw errores.ifMatchInvalido();
  return Number(m[1]);
}

const etag = (version) => `"v${version}"`;

function formatearSeccion(seccion, fila, pendientes, usuario) {
  return {
    seccion,
    datos: fila?.datos ?? {},
    estado: fila?.estado ?? 'vacia',
    version: fila?.version ?? 0,
    idioma: fila?.version ? fila.idioma : idiomaDe(usuario),
    origen: fila?.version ? fila.origen : null,
    versionPlantilla: fila?.versionPlantilla ?? VERSION_PLANTILLA,
    pendientes,
    actualizadaEn: fila?.version ? iso(fila.updatedAt) : null,
  };
}

function exigirSeccionJson(seccion) {
  if (!tieneEsquema(seccion)) throw errores.seccionNoEncontrada(seccion);
}

/** Origen después de un guardado: si se mezclan la app y el OCR, `mixto`. */
function origenNuevo(fila, fuente) {
  const habiaDatos = fila?.version > 0 && Object.keys(fila.datos ?? {}).length > 0;
  if (!habiaDatos || fila.origen === fuente) return fuente;
  return 'mixto';
}

/** Claves de primer nivel que cambiaron (para la bitácora, sin copiar datos médicos). */
function camposCambiados(antes = {}, despues = {}) {
  const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  return [...claves].filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k])).sort();
}

/**
 * Escribe la sección (ya validada) sobre la fila bloqueada, audita y emite `seccion.guardada`.
 * La bitácora guarda versión, estado, origen y qué campos cambiaron, nunca los valores.
 */
async function escribirSeccion({
  fila,
  resultado,
  idioma,
  fuente,
  usuarioId,
  accion,
  transaction,
}) {
  const antes = {
    version: fila.version,
    estado: fila.estado,
    origen: fila.origen,
    idioma: fila.idioma,
  };
  const cambiados = camposCambiados(fila.datos, resultado.datos);
  await fila.update(
    {
      datos: resultado.datos,
      estado: resultado.estado,
      idioma,
      origen: origenNuevo(fila, fuente),
      version: fila.version + 1,
      versionPlantilla: VERSION_PLANTILLA,
      actualizadoPor: usuarioId ?? null,
    },
    { transaction },
  );
  await registrarBitacora({
    accion,
    entidad: 'solicitud_secciones',
    entidadId: fila.id,
    solicitudId: fila.solicitudId,
    antes,
    despues: {
      version: fila.version,
      estado: fila.estado,
      origen: fila.origen,
      idioma: fila.idioma,
      campos: cambiados,
    },
    transaction,
  });
  emitirTrasCommit(transaction, EVENTOS.SECCION_GUARDADA, {
    solicitudId: fila.solicitudId,
    seccion: fila.seccion,
    version: fila.version,
    estado: fila.estado,
    origen: fila.origen,
    usuarioId: usuarioId ?? null,
  });
  return fila;
}

/**
 * GET de una sección. Si nunca se guardó, datos vacíos y versión 0.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 * @param {string} seccion
 */
async function obtenerSeccion(usuario, solicitudId, seccion) {
  exigirSeccionJson(seccion);
  const { SolicitudSeccion } = modelos();
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const fila = await SolicitudSeccion.findOne({ where: { solicitudId: solicitud.id, seccion } });
  if (esPersonal(usuario)) {
    await registrarAcceso({
      solicitudId: solicitud.id,
      recurso: 'expediente',
      recursoId: fila?.id ?? null,
    });
  }
  const pendientes = await pendientesDeSeccion(seccion, fila?.datos ?? {});
  return formatearSeccion(seccion, fila, pendientes, usuario);
}

/**
 * PUT de una sección: guarda un borrador (acepta datos incompletos) y calcula el estado.
 *
 * - Sin `If-Match` cuando la versión es mayor que 0 → 428.
 * - `If-Match` distinto de la versión actual → 412 SECCION_VERSION_CONFLICTO.
 * - Edición según la ventana del rol (core/acceso) → 409 SOLICITUD_EDICION_BLOQUEADA.
 *
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 * @param {string} seccion
 * @param {{ datos: object, idioma?: 'es' | 'en' }} cuerpo
 * @param {string | undefined} ifMatch
 */
async function guardarSeccion(usuario, solicitudId, seccion, { datos, idioma }, ifMatch) {
  exigirSeccionJson(seccion);
  const esperada = versionDeIfMatch(ifMatch);
  const { sequelize, SolicitudSeccion } = modelos();

  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, { transaction });
    await exigirEdicion(usuario, solicitud, { seccion, transaction });

    const fila = await filaBloqueada(
      SolicitudSeccion,
      { solicitudId: solicitud.id, seccion },
      transaction,
    );
    if (esperada === null && fila.version > 0) {
      throw precondicionRequerida('Falta If-Match con la versión de la sección');
    }
    if (esperada !== null && esperada !== fila.version)
      throw errores.versionConflicto(fila.version);

    const resultado = await validarSeccion(seccion, datos, { transaction });
    await escribirSeccion({
      fila,
      resultado,
      // Un idioma por formulario: sin `idioma`, se conserva el de la sección (o el del usuario).
      idioma: idioma ?? (fila.version > 0 ? fila.idioma : idiomaDe(usuario)),
      fuente: 'app',
      usuarioId: usuario.id,
      accion: 'secciones.guardar',
      transaction,
    });
    return formatearSeccion(seccion, fila, resultado.pendientes, usuario);
  });
}

// --- Contrato con el OCR (agente 07)

const PROHIBIDOS = new Set(['__proto__', 'prototype', 'constructor']);

/** `/a/0/b` → ['a', '0', 'b'], o null si no es un JSON Pointer utilizable. */
function tokensDePuntero(puntero) {
  if (typeof puntero !== 'string' || !/^(\/[^/]+)+$/.test(puntero)) return null;
  const tokens = puntero
    .split('/')
    .slice(1)
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
  return tokens.some((t) => PROHIBIDOS.has(t)) ? null : tokens;
}

const esIndice = (t) => /^(0|[1-9]\d{0,3})$/.test(t) || t === '-';

/** Asigna `valor` en la ruta (crea objetos o listas intermedias). null borra el campo. */
function asignar(datos, tokens, valor) {
  let actual = datos;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const t = tokens[i];
    const clave = Array.isArray(actual) && t === '-' ? actual.length : t;
    if (actual[clave] === undefined || actual[clave] === null) {
      actual[clave] = esIndice(tokens[i + 1]) ? [] : {};
    }
    actual = actual[clave];
    if (!actual || typeof actual !== 'object') return false;
    if (Array.isArray(actual) !== esIndice(tokens[i + 1])) return false;
  }
  const ultimo = tokens.at(-1);
  if (Array.isArray(actual)) {
    if (!esIndice(ultimo)) return false;
    const indice = ultimo === '-' ? actual.length : Number(ultimo);
    if (valor === null || valor === undefined) {
      if (indice < actual.length) actual.splice(indice, 1);
    } else actual[indice] = valor;
    return true;
  }
  if (valor === null || valor === undefined) delete actual[ultimo];
  else actual[ultimo] = valor;
  return true;
}

/**
 * Implementación del contrato `fusionarValoresOcr` (ver contratos.js).
 * Un `valor` null borra el campo de esa ruta.
 */
async function fusionarValoresOcr({ solicitudId, seccion, valores, usuarioId, transaction }) {
  if (!transaction) throw new Error('fusionarValoresOcr necesita una transacción');
  exigirSeccionJson(seccion);
  if (!Array.isArray(valores)) throw validacion({ valores: 'TIPO_INVALIDO' });
  const { Solicitud, SolicitudSeccion } = modelos();

  const solicitud = await Solicitud.findByPk(solicitudId, { transaction });
  if (!solicitud) throw noEncontrado();
  const fila = await filaBloqueada(SolicitudSeccion, { solicitudId, seccion }, transaction);

  const datos = structuredClone(fila.datos ?? {});
  const rutasInvalidas = {};
  for (const { rutaDato, valor } of valores) {
    const tokens = tokensDePuntero(rutaDato);
    if (!tokens || !asignar(datos, tokens, valor)) {
      rutasInvalidas[String(rutaDato)] = 'RUTA_INVALIDA';
    }
  }
  if (Object.keys(rutasInvalidas).length) throw validacion(rutasInvalidas);

  const resultado = await validarSeccion(seccion, datos, { transaction, formato: 'puntero' });
  await escribirSeccion({
    fila,
    resultado,
    idioma: fila.version > 0 ? fila.idioma : 'es',
    fuente: 'ocr',
    usuarioId,
    accion: 'secciones.fusionar_ocr',
    transaction,
  });
  return { seccion, version: fila.version, estado: fila.estado };
}

module.exports = {
  obtenerSeccion,
  guardarSeccion,
  fusionarValoresOcr,
  versionDeIfMatch,
  etag,
};
