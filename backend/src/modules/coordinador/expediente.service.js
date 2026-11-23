'use strict';

// Expediente del coordinador (44, 45): historia clínica con etiquetas de catálogo, bitácora del
// caso con accesos, validación por bloques y confirmación de la etapa.

const { obtenerSolicitudConAcceso } = require('../../core/acceso');
const { registrarAcceso } = require('../../core/auditoria');
const { cambiarEstado } = require('../../core/estados');
const {
  ESTADOS_SOLICITUD: E,
  ETAPAS,
  ESTADOS_DOCUMENTO: D,
} = require('../../core/estados/constantes');
const { estadoExpediente, SECCIONES, CODIGOS_SECCIONES_JSON } = require('../../core/expediente');
const { esquemaDe } = require('../solicitudes/esquemas');
const errores = require('./coordinador.errores');
const { iso, idiomaDe, nombreCompleto, nombrePersona, edadDe } = require('./coordinador.util');

const modelos = () => require('../../models');

/** Estado al que lleva confirmar, según la etapa. */
const destinoDe = (solicitud) =>
  solicitud.etapa === ETAPAS.PAQUETE ? E.COMPLETA : E.EN_EVALUACION;

const tituloDe = (seccion, idioma) => (idioma === 'en' ? seccion.tituloEn : seccion.tituloEs);

// --- Historia clínica

/** Tipos de catálogo de un esquema (recorrido completo). */
function tiposDeCatalogo(nodo, tipos = new Set()) {
  if (Array.isArray(nodo)) nodo.forEach((n) => tiposDeCatalogo(n, tipos));
  else if (nodo && typeof nodo === 'object') {
    if (typeof nodo.catalogo === 'string') tipos.add(nodo.catalogo);
    Object.values(nodo).forEach((n) => tiposDeCatalogo(n, tipos));
  }
  return tipos;
}

/**
 * Copia de los datos con cada valor de catálogo como `{ codigo, etiqueta }`, según el esquema.
 * @param {object} esquema Nodo del JSON Schema.
 * @param {unknown} valor
 * @param {(tipo: string, codigo: string) => string} etiqueta
 */
function conEtiquetas(esquema, valor, etiqueta) {
  if (!esquema || valor === null || valor === undefined) return valor;
  if (typeof esquema.catalogo === 'string' && typeof valor === 'string') {
    return { codigo: valor, etiqueta: etiqueta(esquema.catalogo, valor) };
  }
  if (Array.isArray(valor)) return valor.map((v) => conEtiquetas(esquema.items, v, etiqueta));
  if (typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [
        k,
        conEtiquetas(esquema.properties?.[k], v, etiqueta),
      ]),
    );
  }
  return valor;
}

/** Etiquetas de los catálogos pedidos (también de ítems ya inactivos, por los datos viejos). */
async function etiquetador(tipos, idioma) {
  const { CatalogoItem } = modelos();
  const items = tipos.length ? await CatalogoItem.findAll({ where: { tipo: tipos } }) : [];
  const mapa = new Map(
    items.map((i) => [`${i.tipo}:${i.codigo}`, idioma === 'en' ? i.etiquetaEn : i.etiquetaEs]),
  );
  return (tipo, codigo) => mapa.get(`${tipo}:${codigo}`) ?? codigo;
}

/**
 * GET /solicitudes/:id/historia-clinica. Registra el acceso `historia_clinica`.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 */
async function historiaClinica(usuario, solicitudId) {
  const { Paciente, SolicitudSeccion, ProfesionalSalud, Consentimiento } = modelos();
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const idioma = idiomaDe(usuario);

  const paciente = await Paciente.findByPk(solicitud.pacienteId);
  const filas = await SolicitudSeccion.findAll({ where: { solicitudId: solicitud.id } });
  const profesional = await ProfesionalSalud.findOne({ where: { solicitudId: solicitud.id } });
  const consentimientos = await Consentimiento.findAll({
    where: { solicitudId: solicitud.id },
    include: [{ association: 'texto', attributes: ['version', 'idioma'] }],
  });
  const expediente = await estadoExpediente(solicitud.id);

  const esquemas = CODIGOS_SECCIONES_JSON.map((c) => esquemaDe(c));
  const tipos = [...tiposDeCatalogo(esquemas), 'especialidad_medica'];
  const etiqueta = await etiquetador([...new Set(tipos)], idioma);

  await registrarAcceso({
    solicitudId: solicitud.id,
    recurso: 'historia_clinica',
    recursoId: solicitud.id,
  });

  const porSeccion = new Map(filas.map((f) => [f.seccion, f]));
  const porTipo = new Map(consentimientos.map((c) => [c.tipo, c]));
  return {
    solicitudId: solicitud.id,
    codigo: solicitud.codigo,
    paciente: {
      nombreCompleto: nombreCompleto(paciente),
      fechaNacimiento: paciente.fechaNacimiento,
      edad: edadDe(paciente.fechaNacimiento),
      sexo: paciente.sexo,
    },
    secciones: SECCIONES.filter((s) => CODIGOS_SECCIONES_JSON.includes(s.codigo)).map((s) => {
      const fila = porSeccion.get(s.codigo);
      return {
        codigo: s.codigo,
        titulo: tituloDe(s, idioma),
        estado: fila?.estado ?? 'vacia',
        version: fila?.version ?? 0,
        idioma: fila?.version ? fila.idioma : null,
        origen: fila?.version ? fila.origen : null,
        datos: conEtiquetas(esquemaDe(s.codigo), fila?.datos ?? {}, etiqueta),
      };
    }),
    profesional: {
      nombre: profesional?.nombre ?? null,
      especialidad: profesional?.especialidad
        ? {
            codigo: profesional.especialidad,
            etiqueta: etiqueta('especialidad_medica', profesional.especialidad),
          }
        : null,
      telefono: profesional?.telefono ?? null,
      correo: profesional?.correo ?? null,
      documentoCertificacionId: profesional?.documentoCertificacionId ?? null,
      estado: expediente.profesional.estado,
    },
    consentimientos: expediente.consentimientos.map((c) => {
      const fila = porTipo.get(c.tipo);
      return {
        tipo: c.tipo,
        decision: c.decision,
        textoVersion: fila?.texto?.version ?? null,
        textoIdioma: fila?.texto?.idioma ?? null,
        decididoEn: iso(fila?.decididoEn),
        estadoFirma: c.decision ? c.estadoFirma : null,
        firmaPendiente: c.firmaPendiente,
      };
    }),
  };
}

// --- Bitácora

const autorDe = (u) =>
  u ? { id: u.id, nombre: nombrePersona(u), rol: u.rol?.codigo ?? '' } : null;
const INCLUIR_AUTOR = {
  attributes: ['id', 'nombres', 'apellidos'],
  include: [{ association: 'rol', attributes: ['codigo'] }],
};

/**
 * GET /solicitudes/:id/bitacora: cambios del caso (con el antes y el después) y, si se pide, los
 * accesos al expediente.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {{ page: number, limit: number, incluirAccesos?: boolean }} filtros
 */
async function bitacora(usuario, solicitudId, { page, limit, incluirAccesos }) {
  const { Bitacora, RegistroAcceso } = modelos();
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const pagina = { limit, offset: (page - 1) * limit };
  const orden = [
    ['createdAt', 'DESC'],
    ['id', 'ASC'],
  ];

  const cambios = await Bitacora.findAndCountAll({
    where: { solicitudId: solicitud.id },
    include: [{ association: 'usuario', ...INCLUIR_AUTOR }],
    order: orden,
    ...pagina,
  });
  const respuesta = {
    datos: cambios.rows.map((b) => ({
      id: b.id,
      accion: b.accion,
      entidad: b.entidad,
      entidadId: b.entidadId ?? null,
      antes: b.antes ?? null,
      despues: b.despues ?? null,
      autor: autorDe(b.usuario),
      fecha: iso(b.createdAt),
    })),
    paginacion: { page, limit, total: cambios.count },
  };

  if (incluirAccesos) {
    const accesos = await RegistroAcceso.findAndCountAll({
      where: { solicitudId: solicitud.id },
      include: [{ association: 'usuario', ...INCLUIR_AUTOR }],
      order: orden,
      ...pagina,
    });
    respuesta.accesos = {
      datos: accesos.rows.map((a) => ({
        id: a.id,
        usuario: autorDe(a.usuario),
        recurso: a.recurso,
        recursoId: a.recursoId ?? null,
        fecha: iso(a.createdAt),
      })),
      paginacion: { page, limit, total: accesos.count },
    };
  }
  return respuesta;
}

// --- Validación (45)

/** Acciones que la app puede ofrecer para un documento (endpoints del agente 06). */
function accionesDeDocumento(documento) {
  if (!documento.documentoId) return [];
  switch (documento.estado) {
    case D.CAPTURADO:
      return ['validar_documento', 'rechazar_documento', 'pedir_nueva_captura'];
    case D.VALIDADO:
      return ['rechazar_documento'];
    default:
      return [];
  }
}

/**
 * Bloques de la etapa actual, en el orden de la lista única de secciones, seguidos de los
 * documentos requeridos.
 */
function armarBloques(expediente, idioma) {
  const motivo = new Map(expediente.faltantes.map((f) => [`${f.tipo}:${f.codigo}`, f.motivo]));
  const bloques = [];
  for (const s of expediente.secciones) {
    if (s.codigo === 'profesional_salud') {
      bloques.push({
        tipo: 'profesional',
        codigo: s.codigo,
        titulo: idioma === 'en' ? s.tituloEn : s.tituloEs,
        obligatorio: s.obligatoria,
        estado: s.estado,
        motivo: motivo.get(`profesional:${s.codigo}`) ?? null,
        documentoId: null,
        acciones: [],
      });
    } else if (s.codigo === 'consentimientos') {
      for (const c of expediente.consentimientos) {
        bloques.push({
          tipo: 'consentimiento',
          codigo: c.tipo,
          titulo: c.tipo,
          obligatorio: s.obligatoria,
          estado: !c.decision ? 'falta' : c.firmaPendiente ? 'firma_pendiente' : c.decision,
          motivo: motivo.get(`consentimiento:${c.tipo}`) ?? null,
          documentoId: null,
          acciones: [],
        });
      }
    } else {
      bloques.push({
        tipo: 'seccion',
        codigo: s.codigo,
        titulo: idioma === 'en' ? s.tituloEn : s.tituloEs,
        obligatorio: s.obligatoria,
        estado: s.estado,
        motivo: motivo.get(`seccion:${s.codigo}`) ?? null,
        documentoId: null,
        acciones: ['solicitar_correccion_seccion'],
      });
    }
  }
  for (const d of expediente.documentos) {
    bloques.push({
      tipo: 'documento',
      codigo: d.codigo,
      titulo: idioma === 'en' ? d.nombreEn : d.nombreEs,
      obligatorio: d.obligatorio,
      estado: d.cubiertoPorFormulario ? 'cubierto_por_formulario' : d.estado,
      motivo: motivo.get(`documento:${d.codigo}`) ?? null,
      documentoId: d.documentoId,
      acciones: d.cubiertoPorFormulario ? [] : accionesDeDocumento(d),
    });
  }
  return bloques;
}

/**
 * GET /solicitudes/:id/validacion (45).
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 */
async function validacion(usuario, solicitudId) {
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const expediente = await estadoExpediente(solicitud.id);
  const enRevision = solicitud.estado === E.EN_REVISION;
  return {
    solicitudId: solicitud.id,
    estado: solicitud.estado,
    etapa: solicitud.etapa,
    bloques: armarBloques(expediente, idiomaDe(usuario)),
    faltantes: expediente.faltantes,
    listoParaConfirmar: expediente.listoParaConfirmar,
    puedeConfirmar: enRevision && expediente.listoParaConfirmar,
    destinoAlConfirmar: enRevision ? destinoDe(solicitud) : null,
  };
}

/**
 * POST /solicitudes/:id/confirmar-completo: confirma la etapa actual. Evaluación → EN_EVALUACION;
 * paquete → COMPLETA. Si el caso no tiene coordinador, queda a cargo de quien confirma.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {{ nota?: string }} cuerpo
 */
async function confirmarCompleto(usuario, solicitudId, { nota }) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (solicitud.estado !== E.EN_REVISION) throw errores.noEnRevision(solicitud.estado);
    const expediente = await estadoExpediente(solicitud.id, { transaction });
    if (!expediente.listoParaConfirmar) throw errores.faltantes(expediente.faltantes);

    await cambiarEstado({
      solicitud,
      a: destinoDe(solicitud),
      usuario,
      nota,
      campos: solicitud.coordinadorId ? {} : { coordinadorId: usuario.id },
      transaction,
    });
    return {
      id: solicitud.id,
      codigo: solicitud.codigo,
      estado: solicitud.estado,
      etapa: solicitud.etapa,
      coordinadorId: solicitud.coordinadorId ?? null,
      ultimoCambioEstado: iso(solicitud.ultimoCambioEstado),
    };
  });
}

module.exports = { historiaClinica, bitacora, validacion, confirmarCompleto, conEtiquetas };
