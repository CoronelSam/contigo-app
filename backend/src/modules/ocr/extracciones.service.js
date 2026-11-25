'use strict';

// Extracciones de OCR y su revisión humana (26, 38–40). Nada de lo extraído queda como definitivo
// de forma automática: cada campo se confirma o se corrige, y solo al "Marcar como revisado"
// los valores pasan a las secciones del formulario (fusionarValoresOcr del agente 05).

const {
  obtenerSolicitudConAcceso,
  exigirEdicion,
  coordinadoresDe,
  esUuid,
} = require('../../core/acceso');
const { registrarBitacora, registrarAcceso } = require('../../core/auditoria');
const { emitirTrasCommit, EVENTOS } = require('../../core/eventos');
const cola = require('../../core/cola');
const trabajos = require('../../core/cola/trabajos');
const { notificar } = require('../../core/notificaciones');
const { noEncontrado } = require('../../core/errores');
const { config } = require('../../config/env');
const solicitudes = require('../solicitudes/contratos');
const errores = require('./ocr.errores');
const { zonaDe } = require('./zonas');
const { normalizarValor, valorEfectivo, valorParaSeccion } = require('./valores');

const EN_CURSO = Object.freeze(['en_cola', 'procesando']);
const UMBRAL_POR_DEFECTO = 0.8;

const modelos = () => require('../../models');

// --- Contratos (agente 06)

/**
 * Plantilla vigente para el OCR: la vinculada al tipo de documento si sigue activa; si no, la
 * versión activa del mismo código. Registrar una versión nueva desactiva la anterior (agente 11)
 * y el tipo de documento puede seguir apuntando a ella. Sin versión activa, null.
 * @param {object | null | undefined} vinculada
 * @param {import('sequelize').Transaction} [transaction]
 */
async function plantillaVigente(vinculada, transaction) {
  if (!vinculada) return null;
  if (vinculada.activa) return vinculada;
  const { PlantillaFormulario } = modelos();
  return PlantillaFormulario.findOne({
    where: { codigo: vinculada.codigo, activa: true },
    order: [['version', 'DESC']],
    transaction,
  });
}

/**
 * Ver contratos.js. Cancela antes cualquier extracción en curso del mismo documento.
 * @param {{ documentoId: string, transaction: import('sequelize').Transaction }} p
 */
async function encolarExtraccion({ documentoId, transaction }) {
  const { Documento, Extraccion } = modelos();
  const documento = await Documento.findByPk(documentoId, {
    include: [{ association: 'tipoDocumento', include: [{ association: 'plantilla' }] }],
    transaction,
  });
  if (!documento) throw noEncontrado();
  const plantilla = await plantillaVigente(documento.tipoDocumento?.plantilla, transaction);
  if (!plantilla?.zonasOcr?.length) return null;

  await cancelarExtraccion({ documentoId, transaction });
  const extraccion = await Extraccion.create(
    {
      documentoId,
      plantillaId: plantilla.id,
      motor: config().ocr.proveedor,
      estado: 'en_cola',
      progreso: 0,
    },
    { transaction },
  );
  await cola.encolarTrasCommit(transaction, trabajos.OCR_PROCESAR, { extraccionId: extraccion.id });
  emitirTrasCommit(transaction, EVENTOS.EXTRACCION_CREADA, {
    extraccionId: extraccion.id,
    documentoId,
    solicitudId: documento.solicitudId,
  });
  return extraccion;
}

/**
 * Ver contratos.js.
 * @param {{ documentoId: string, transaction: import('sequelize').Transaction }} p
 */
async function cancelarExtraccion({ documentoId, transaction }) {
  const { Extraccion } = modelos();
  const [n] = await Extraccion.update(
    { estado: 'cancelada' },
    { where: { documentoId, estado: EN_CURSO }, transaction },
  );
  return n > 0;
}

// --- Revisión

async function umbralConfianza(transaction) {
  const { Configuracion } = modelos();
  const fila = await Configuracion.findByPk('ocr.umbral_confianza', { transaction });
  const valor = Number(fila?.valor);
  return Number.isFinite(valor) && valor >= 0 && valor <= 1 ? valor : UMBRAL_POR_DEFECTO;
}

const esDudoso = (campo, umbral) => campo.confianza === null || Number(campo.confianza) < umbral;

/**
 * Extracción con su documento y su solicitud, si el usuario tiene relación con el caso.
 * @param {{ transaction?: import('sequelize').Transaction, bloquear?: boolean }} [opciones]
 */
async function extraccionConAcceso(usuario, extraccionId, { transaction, bloquear = false } = {}) {
  if (!esUuid(extraccionId)) throw noEncontrado();
  const { Extraccion, Documento } = modelos();
  const extraccion = await Extraccion.findByPk(extraccionId, {
    transaction,
    ...(bloquear ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!extraccion) throw noEncontrado();
  const documento = await Documento.findByPk(extraccion.documentoId, { transaction });
  const solicitud = await obtenerSolicitudConAcceso(usuario, documento.solicitudId, {
    transaction,
  });
  return { extraccion, documento, solicitud };
}

/** Para revisar: extracción por confirmar y edición permitida para el rol. */
async function extraccionEditable(usuario, extraccionId, transaction) {
  const r = await extraccionConAcceso(usuario, extraccionId, { transaction, bloquear: true });
  await exigirEdicion(usuario, r.solicitud, {
    tipoDocumentoId: r.documento.tipoDocumentoId,
    transaction,
  });
  if (r.extraccion.estado !== 'por_confirmar') throw errores.noEditable(r.extraccion.estado);
  return r;
}

async function camposDe(extraccion, transaction) {
  const { CampoExtraido } = modelos();
  const campos = await CampoExtraido.findAll({
    where: { extraccionId: extraccion.id },
    order: [
      ['pagina', 'ASC'],
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
    transaction,
  });
  // En el orden de las zonas de la plantilla, cuando están guardadas.
  const orden = new Map((extraccion.respuestaCruda?.zonas ?? []).map((z, i) => [z.campo, i]));
  if (orden.size) campos.sort((a, b) => (orden.get(a.campo) ?? 0) - (orden.get(b.campo) ?? 0));
  return campos;
}

function formatearCampo(extraccion, campo, umbral) {
  const zona = zonaDe(extraccion, campo);
  return {
    id: campo.id,
    campo: campo.campo,
    seccion: campo.seccion ?? null,
    rutaDato: campo.rutaDato ?? null,
    tipo: campo.tipo,
    valorLeido: campo.valorLeido ?? null,
    confianza: campo.confianza === null ? null : Number(campo.confianza),
    dudoso: esDudoso(campo, umbral),
    pagina: campo.pagina ?? null,
    coordenadas: campo.coordenadas ?? null,
    grupo: zona.grupo ?? null,
    valorCasilla: zona.valor ?? null,
    opciones: zona.opciones ?? null,
    formato: zona.tipo === 'fecha' ? (zona.formato ?? 'DD/MM/AAAA') : null,
    valorFinal: campo.valorFinal ?? null,
    estado: campo.estado,
    revisadoEn: campo.revisadoEn ? campo.revisadoEn.toISOString() : null,
  };
}

async function formatearExtraccion(extraccion, transaction) {
  const { DocumentoPagina } = modelos();
  const [campos, paginas, umbral] = [
    await camposDe(extraccion, transaction),
    await DocumentoPagina.findAll({
      where: { documentoId: extraccion.documentoId },
      order: [['orden', 'ASC']],
      transaction,
    }),
    await umbralConfianza(transaction),
  ];
  return {
    id: extraccion.id,
    documentoId: extraccion.documentoId,
    estado: extraccion.estado,
    progreso: extraccion.progreso,
    confianzaPromedio:
      extraccion.confianzaPromedio === null ? null : Number(extraccion.confianzaPromedio),
    umbralConfianza: umbral,
    error: extraccion.error ?? null,
    revisadoEn: extraccion.revisadoEn ? extraccion.revisadoEn.toISOString() : null,
    paginas: paginas.map((p) => ({ numero: p.orden, archivoId: p.archivoId })),
    campos: campos.map((c) => formatearCampo(extraccion, c, umbral)),
  };
}

/**
 * GET /extracciones/:id (38). El acceso del personal queda registrado.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} extraccionId
 */
async function obtenerExtraccion(usuario, extraccionId) {
  const { extraccion, documento, solicitud } = await extraccionConAcceso(usuario, extraccionId);
  await registrarAcceso({
    solicitudId: solicitud.id,
    recurso: 'documento',
    recursoId: documento.id,
  });
  return formatearExtraccion(extraccion);
}

/**
 * Casillas de un grupo que quedarían marcadas si los campos tuvieran estos valores.
 * @param {object} extraccion
 * @param {object[]} campos
 * @param {Map<string, string | null>} [cambios] campoId → valor final propuesto
 * @returns {string[]} Ids de las casillas en conflicto (vacío si no hay).
 */
function conflictoDeCasillas(extraccion, campos, cambios = new Map()) {
  const marcadas = new Map();
  for (const c of campos) {
    const zona = zonaDe(extraccion, c);
    if (zona.tipo !== 'casilla' || !zona.grupo) continue;
    const valor = cambios.has(c.id) ? cambios.get(c.id) : valorEfectivo(zona, c);
    if (valor !== 'true') continue;
    if (!marcadas.has(zona.grupo)) marcadas.set(zona.grupo, []);
    marcadas.get(zona.grupo).push(c.id);
  }
  return [...marcadas.values()].filter((ids) => ids.length > 1).flat();
}

/** Valor final y estado al revisar un campo. */
function revision(zona, campo, { valor, confirmar }) {
  const r = normalizarValor(zona, confirmar ? campo.valorLeido : valor);
  if (!r.ok) throw errores.valorInvalido(r.codigo);
  const leido = normalizarValor(zona, campo.valorLeido);
  const igual = leido.ok && leido.valor === r.valor;
  return { valorFinal: r.valor, estado: confirmar || igual ? 'confirmado' : 'corregido' };
}

/**
 * PATCH /extracciones/:id/campos/:campoId (39): `{ valor }` corrige (o confirma si es igual al
 * leído); `{ confirmar: true }` confirma el valor leído. Guarda revisor y fecha.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} extraccionId
 * @param {string} campoId
 * @param {{ valor?: unknown, confirmar?: boolean }} cuerpo
 */
async function revisarCampo(usuario, extraccionId, campoId, cuerpo) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const { extraccion } = await extraccionEditable(usuario, extraccionId, transaction);
    const campos = await camposDe(extraccion, transaction);
    const campo = campos.find((c) => c.id === campoId);
    if (!campo) throw errores.campoNoEncontrado();

    const zona = zonaDe(extraccion, campo);
    const { valorFinal, estado } = revision(zona, campo, cuerpo);
    const conflicto = conflictoDeCasillas(extraccion, campos, new Map([[campo.id, valorFinal]]));
    if (conflicto.length) throw errores.casillasExcluyentes(conflicto, 400);

    await campo.update(
      { valorFinal, estado, revisadoPor: usuario.id, revisadoEn: new Date() },
      { transaction },
    );
    return formatearCampo(extraccion, campo, await umbralConfianza(transaction));
  });
}

/**
 * POST /extracciones/:id/campos/confirmar: confirma en bloque campos NO dudosos con su valor
 * leído. Si la lista tiene uno dudoso, no confirma ninguno.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} extraccionId
 * @param {{ campoIds: string[] }} cuerpo
 */
async function confirmarEnBloque(usuario, extraccionId, { campoIds }) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const { extraccion } = await extraccionEditable(usuario, extraccionId, transaction);
    const campos = await camposDe(extraccion, transaction);
    const porId = new Map(campos.map((c) => [c.id, c]));
    const ids = [...new Set(campoIds)];
    if (ids.some((id) => !porId.has(id))) throw errores.campoNoEncontrado();

    const umbral = await umbralConfianza(transaction);
    const dudosos = ids.filter((id) => esDudoso(porId.get(id), umbral));
    if (dudosos.length) throw errores.dudosoEnBloque(dudosos);

    const pendientes = ids.map((id) => porId.get(id)).filter((c) => c.estado === 'propuesto');
    const cambios = new Map();
    const invalidos = {};
    for (const c of pendientes) {
      const r = normalizarValor(zonaDe(extraccion, c), c.valorLeido);
      if (r.ok) cambios.set(c.id, r.valor);
      else invalidos[c.id] = r.codigo;
    }
    if (Object.keys(invalidos).length) throw errores.valoresInvalidos(invalidos);
    const conflicto = conflictoDeCasillas(extraccion, campos, cambios);
    if (conflicto.length) throw errores.casillasExcluyentes(conflicto);

    const ahora = new Date();
    for (const c of pendientes) {
      await c.update(
        {
          valorFinal: cambios.get(c.id),
          estado: 'confirmado',
          revisadoPor: usuario.id,
          revisadoEn: ahora,
        },
        { transaction },
      );
    }
    return formatearExtraccion(extraccion, transaction);
  });
}

/**
 * Valores por sección para fusionarValoresOcr. Las casillas de un grupo aportan un solo valor:
 * el de la casilla marcada. Los campos vacíos no se envían (no borran lo que ya hay).
 */
function valoresPorSeccion(extraccion, campos) {
  const porSeccion = new Map();
  const agregar = (seccion, rutaDato, valor, ids) => {
    if (!porSeccion.has(seccion)) porSeccion.set(seccion, []);
    porSeccion.get(seccion).push({ rutaDato, valor, ids });
  };
  const grupos = new Map();
  for (const c of campos) {
    const zona = zonaDe(extraccion, c);
    if (!zona.seccion || !zona.rutaDato) continue;
    if (zona.tipo === 'casilla' && zona.grupo) {
      if (!grupos.has(zona.grupo)) grupos.set(zona.grupo, { zona, ids: [], marcada: null });
      const g = grupos.get(zona.grupo);
      g.ids.push(c.id);
      if (c.valorFinal === 'true') g.marcada = zona;
      continue;
    }
    if (zona.tipo === 'casilla') {
      if (zona.valor !== undefined) {
        if (c.valorFinal === 'true') agregar(zona.seccion, zona.rutaDato, zona.valor, [c.id]);
      } else agregar(zona.seccion, zona.rutaDato, c.valorFinal === 'true', [c.id]);
      continue;
    }
    const valor = valorParaSeccion(zona, c.valorFinal);
    if (valor !== null) agregar(zona.seccion, zona.rutaDato, valor, [c.id]);
  }
  for (const g of grupos.values()) {
    if (g.marcada) agregar(g.zona.seccion, g.zona.rutaDato, g.marcada.valor, g.ids);
  }
  return porSeccion;
}

/**
 * POST /extracciones/:id/confirmar (40): "Marcar como revisado". Todo en una transacción: si el
 * formulario rechaza un valor, nada queda confirmado.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} extraccionId
 */
async function confirmarRevision(usuario, extraccionId) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const { extraccion, solicitud, documento } = await extraccionEditable(
      usuario,
      extraccionId,
      transaction,
    );
    const campos = await camposDe(extraccion, transaction);
    const sinVerificar = campos.filter((c) => c.estado === 'propuesto').map((c) => c.id);
    if (sinVerificar.length) throw errores.camposSinVerificar(sinVerificar);
    const conflicto = conflictoDeCasillas(extraccion, campos);
    if (conflicto.length) throw errores.casillasExcluyentes(conflicto);

    for (const [seccion, valores] of valoresPorSeccion(extraccion, campos)) {
      try {
        await solicitudes.fusionarValoresOcr({
          solicitudId: solicitud.id,
          seccion,
          valores: valores.map(({ rutaDato, valor }) => ({ rutaDato, valor })),
          usuarioId: usuario.id,
          transaction,
        });
      } catch (err) {
        if (err.status !== 400 || !err.campos) throw err;
        // Errores por rutaDato → por campo, para que la app marque cuáles corregir.
        const rechazados = {};
        for (const [ruta, codigo] of Object.entries(err.campos)) {
          const v = valores.find((x) => x.rutaDato === ruta);
          if (v) v.ids.forEach((id) => (rechazados[id] = codigo));
          else rechazados[`${seccion}${ruta}`] = codigo;
        }
        throw errores.rechazadosPorFormulario(rechazados);
      }
    }

    await extraccion.update(
      { estado: 'confirmada', revisadoPor: usuario.id, revisadoEn: new Date() },
      { transaction },
    );
    const corregidos = campos.filter((c) => c.estado === 'corregido').length;
    await registrarBitacora({
      accion: 'ocr.confirmar_revision',
      entidad: 'extracciones',
      entidadId: extraccion.id,
      solicitudId: solicitud.id,
      antes: { estado: 'por_confirmar' },
      despues: {
        estado: 'confirmada',
        documentoId: documento.id,
        campos: campos.length,
        confirmados: campos.length - corregidos,
        corregidos,
      },
      transaction,
    });
    await notificar({
      usuarioIds: await coordinadoresDe(solicitud, { transaction }),
      tipo: 'REVISION_OCR_LISTA',
      variables: { codigo: solicitud.codigo, solicitudId: solicitud.id },
      solicitudId: solicitud.id,
      transaction,
    });
    emitirTrasCommit(transaction, EVENTOS.EXTRACCION_CONFIRMADA, {
      extraccionId: extraccion.id,
      documentoId: documento.id,
      solicitudId: solicitud.id,
      revisadoPor: usuario.id,
    });
    return formatearExtraccion(extraccion, transaction);
  });
}

module.exports = {
  encolarExtraccion,
  cancelarExtraccion,
  obtenerExtraccion,
  revisarCampo,
  confirmarEnBloque,
  confirmarRevision,
  umbralConfianza,
  valoresPorSeccion,
};
