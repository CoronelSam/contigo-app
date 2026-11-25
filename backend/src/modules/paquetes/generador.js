'use strict';

// Arma el PDF del paquete: plantillas oficiales activas en orden (internacional por nombre de
// campo, México por coordenadas), aplanadas, y después los anexos (páginas de los documentos
// VALIDADO). Respeta los consentimientos: lo que la familia no aceptó divulgar no entra.
// Nunca rellena firmas.

const almacenamiento = require('../../core/almacenamiento');
const { estadoExpediente } = require('../../core/expediente');
const { ESTADOS_DOCUMENTO: D } = require('../../core/estados/constantes');
const pdf = require('./pdf');
const { interpretarOrigen, resolverElemento } = require('./mapa');

const { ErrorPdf } = pdf;

/** Idioma de los textos de catálogo en cada paquete. */
const IDIOMA_DE_PAQUETE = Object.freeze({ MEXICO: 'es', INTERNACIONAL: 'en' });

const DIVULGACION = 'divulgacion_informacion_medica';

/**
 * Consentimientos que se exigen aunque la plantilla no los marque (la opción más segura).
 * Se cambian en `configuracion` (claves `paquete.consentimiento_secciones` y
 * `paquete.consentimiento_anexos`).
 */
const CONSENTIMIENTO_SECCIONES = Object.freeze({
  informacion_medica: DIVULGACION,
  embarazo_nacimiento: DIVULGACION,
  antecedentes_medicos: DIVULGACION,
  medicamentos_alergias: DIVULGACION,
  crecimiento_movilidad: DIVULGACION,
});
const CONSENTIMIENTO_ANEXOS = Object.freeze({ medico: DIVULGACION });

const modelos = () => require('../../models');

async function leerBytes(clave, codigo) {
  try {
    const flujo = await almacenamiento.leerObjeto(clave);
    const partes = [];
    for await (const parte of flujo) partes.push(Buffer.from(parte));
    return Buffer.concat(partes);
  } catch {
    throw new ErrorPdf(codigo);
  }
}

async function leerConfiguracion(clave, porDefecto) {
  const { Configuracion } = modelos();
  const fila = await Configuracion.findByPk(clave);
  return fila?.valor && typeof fila.valor === 'object' ? fila.valor : porDefecto;
}

const unir = (...partes) => partes.filter(Boolean).join(' ') || null;

/** Datos del caso que pueden usar los mapas de campos (ver mapa.js → CAMPOS). */
async function contextoDelCaso(solicitud) {
  const {
    Paciente,
    Municipio,
    Departamento,
    PacienteTutor,
    ProfesionalSalud,
    SolicitudSeccion,
    Consentimiento,
    CatalogoItem,
  } = modelos();
  const p = await Paciente.findByPk(solicitud.pacienteId);
  const municipio = await Municipio.findByPk(p.municipioCodigo);
  const departamento = municipio ? await Departamento.findByPk(municipio.departamentoCodigo) : null;
  const vinculo = await PacienteTutor.findOne({
    where: { pacienteId: p.id, esResponsableLegal: true },
    include: [{ association: 'tutor' }],
    order: [['createdAt', 'ASC']],
  });
  const t = vinculo?.tutor ?? null;
  const profesional = await ProfesionalSalud.findOne({ where: { solicitudId: solicitud.id } });
  const secciones = await SolicitudSeccion.findAll({ where: { solicitudId: solicitud.id } });
  const consentimientos = await Consentimiento.findAll({ where: { solicitudId: solicitud.id } });
  const items = await CatalogoItem.findAll({
    attributes: ['tipo', 'codigo', 'etiquetaEs', 'etiquetaEn'],
  });
  const etiquetas = new Map(items.map((i) => [`${i.tipo}:${i.codigo}`, i]));

  return {
    solicitud: { codigo: solicitud.codigo },
    paciente: {
      nombres: p.nombres,
      apellidoPaterno: p.apellidoPaterno,
      apellidoMaterno: p.apellidoMaterno,
      apellidos: unir(p.apellidoPaterno, p.apellidoMaterno),
      nombreCompleto: unir(p.nombres, p.apellidoPaterno, p.apellidoMaterno),
      fechaNacimiento: p.fechaNacimiento,
      sexo: p.sexo,
      direccion: p.direccion,
      municipio: municipio?.nombre ?? null,
      departamento: departamento?.nombre ?? null,
    },
    tutorResponsable: t
      ? {
          nombres: t.nombres,
          apellidos: t.apellidos,
          nombreCompleto: unir(t.nombres, t.apellidos),
          parentesco: t.parentesco,
          telefono: t.telefono,
          correo: t.correo,
          direccion: t.direccion,
        }
      : null,
    profesional: profesional
      ? {
          nombre: profesional.nombre,
          especialidad: profesional.especialidad,
          telefono: profesional.telefono,
          correo: profesional.correo,
        }
      : null,
    secciones: new Map(secciones.map((s) => [s.seccion, s.datos ?? {}])),
    consentimientos: new Map(consentimientos.map((c) => [c.tipo, { decision: c.decision }])),
    etiqueta(tipo, codigo, idioma) {
      const item = etiquetas.get(`${tipo}:${codigo}`);
      if (!item) return codigo;
      return idioma === 'en' ? item.etiquetaEn : item.etiquetaEs;
    },
  };
}

const acepta = (ctx, tipo) => ctx.consentimientos.get(tipo)?.decision === 'acepta';

/** Consentimientos que exige un elemento del mapa: el suyo y el implícito de su sección. */
function consentimientosDe(el, origen, implicitos) {
  const lista = new Set();
  if (el.requiereConsentimiento) lista.add(el.requiereConsentimiento);
  if (origen.tipo === 'seccion' && implicitos[origen.seccion]) {
    lista.add(implicitos[origen.seccion]);
  }
  return [...lista];
}

/**
 * Rellena una plantilla y devuelve sus páginas listas para el paquete.
 * @returns {Promise<{ doc: import('pdf-lib').PDFDocument, avisos: object[] }>}
 */
async function aplicarPlantilla(plantilla, ctx, idioma, implicitos) {
  const avisos = [];
  const bytes = await leerBytes(plantilla.archivoPdf.clave, 'PLANTILLA_NO_DISPONIBLE');
  const doc = await pdf.abrir(bytes, 'PLANTILLA_DANADA');
  const valores = [];

  for (const el of plantilla.mapaCampos) {
    const origen = interpretarOrigen(el.origen);
    if (!origen) throw new ErrorPdf('PLANTILLA_ORIGEN_DESCONOCIDO');
    const destino = el.destino ?? el.destinoCoordenadas;
    const campo = el.destino?.campoPdf ?? `p${el.destinoCoordenadas.pagina}:${el.origen}`;
    const sinConsentimiento = consentimientosDe(el, origen, implicitos).find(
      (tipo) => !acepta(ctx, tipo),
    );
    if (sinConsentimiento) {
      // En blanco: el dato no entra al paquete.
      avisos.push({
        tipo: 'campo_omitido_por_consentimiento',
        plantilla: plantilla.codigo,
        campo,
        consentimiento: sinConsentimiento,
      });
      valores.push(el.tipo === 'casilla' ? { ...destino, marcada: false } : { ...destino });
      continue;
    }
    const valor = resolverElemento(el, origen, ctx, idioma);
    valores.push({ ...destino, ...(valor ?? {}), etiqueta: campo });
  }

  const { recortados } =
    plantilla.metodo === 'campo'
      ? await pdf.rellenarPorCampo(doc, valores)
      : await pdf.dibujarPorCoordenadas(doc, valores);
  const { firmas } = pdf.aplanar(doc);
  for (const c of recortados)
    avisos.push({ tipo: 'campo_recortado', plantilla: plantilla.codigo, campo: c });
  for (const c of firmas)
    avisos.push({ tipo: 'firma_pendiente', plantilla: plantilla.codigo, campo: c });
  return { doc, avisos };
}

/**
 * Genera el PDF del paquete.
 * @param {object} paquete Fila de `paquetes_pdf`.
 * @param {{ alAvanzar?: (progreso: number) => Promise<void> }} [opciones]
 * @returns {Promise<{ bytes: Uint8Array, numeroPaginas: number, plantillasUsadas: object[],
 *   avisos: object[] }>}
 */
async function generar(paquete, { alAvanzar = async () => {} } = {}) {
  const { Solicitud, PlantillaFormulario, TipoDocumento, DocumentoPagina } = modelos();
  const solicitud = await Solicitud.findByPk(paquete.solicitudId);
  const idioma = IDIOMA_DE_PAQUETE[paquete.paquete] ?? 'es';
  const plantillas = await PlantillaFormulario.findAll({
    where: { paquete: paquete.paquete, activa: true },
    include: [{ association: 'archivoPdf', attributes: ['clave'] }],
    order: [
      ['orden', 'ASC'],
      ['codigo', 'ASC'],
    ],
  });
  if (!plantillas.length) throw new ErrorPdf('SIN_PLANTILLAS');

  const ctx = await contextoDelCaso(solicitud);
  const implicitos = await leerConfiguracion(
    'paquete.consentimiento_secciones',
    CONSENTIMIENTO_SECCIONES,
  );
  const porCategoria = await leerConfiguracion(
    'paquete.consentimiento_anexos',
    CONSENTIMIENTO_ANEXOS,
  );
  const expediente = await estadoExpediente(solicitud.id);
  const avisos = [];
  const usadas = [];

  for (const c of expediente.consentimientos.filter((x) => x.firmaPendiente)) {
    avisos.push({ tipo: 'firma_pendiente', consentimiento: c.tipo });
  }

  // Anexos: un documento por requisito activo (sin repetir), en el orden de los requisitos.
  const vistos = new Set();
  const anexos = [];
  for (const d of expediente.documentos) {
    if (d.documentoId && vistos.has(d.documentoId)) continue;
    if (d.documentoId) vistos.add(d.documentoId);
    if (!d.documentoId || d.estado !== D.VALIDADO) {
      if (d.obligatorio && !d.cubiertoPorFormulario) {
        avisos.push({ tipo: 'anexo_faltante', documento: d.codigo });
      }
      continue;
    }
    anexos.push(d);
  }
  const categorias = new Map(
    (
      await TipoDocumento.findAll({
        where: { id: anexos.map((a) => a.tipoDocumentoId) },
        attributes: ['id', 'categoria'],
      })
    ).map((t) => [t.id, t.categoria]),
  );

  const total = plantillas.length + anexos.length;
  let hechos = 0;
  const avanzar = async () => {
    hechos += 1;
    await alAvanzar(Math.min(95, Math.round((hechos / total) * 95)));
  };

  const salida = await pdf.crearPaquete({ titulo: `Paquete ${solicitud.codigo}` });
  for (const plantilla of plantillas) {
    const { doc, avisos: propios } = await aplicarPlantilla(plantilla, ctx, idioma, implicitos);
    const paginas = await pdf.agregarDocumento(salida, doc);
    avisos.push(...propios);
    usadas.push({
      tipo: 'plantilla',
      id: plantilla.id,
      codigo: plantilla.codigo,
      nombre: plantilla.nombre,
      version: plantilla.version,
      paginas,
    });
    await avanzar();
  }

  for (const anexo of anexos) {
    const consentimiento = porCategoria[categorias.get(anexo.tipoDocumentoId)];
    if (consentimiento && !acepta(ctx, consentimiento)) {
      avisos.push({
        tipo: 'anexo_omitido_por_consentimiento',
        documento: anexo.codigo,
        consentimiento,
      });
      await avanzar();
      continue;
    }
    const paginasDoc = await DocumentoPagina.findAll({
      where: { documentoId: anexo.documentoId },
      include: [{ association: 'archivo', attributes: ['clave', 'mime'] }],
      order: [['orden', 'ASC']],
    });
    let paginas = 0;
    for (const p of paginasDoc) {
      const bytes = await leerBytes(p.archivo.clave, 'ANEXO_NO_DISPONIBLE');
      paginas += await pdf.agregarAnexo(salida, { mime: p.archivo.mime, bytes });
    }
    usadas.push({
      tipo: 'anexo',
      documentoId: anexo.documentoId,
      codigo: anexo.codigo,
      version: anexo.version,
      paginas,
    });
    await avanzar();
  }

  return {
    bytes: await salida.save(),
    numeroPaginas: salida.getPageCount(),
    plantillasUsadas: usadas,
    avisos,
  };
}

module.exports = {
  generar,
  leerBytes,
  IDIOMA_DE_PAQUETE,
  CONSENTIMIENTO_SECCIONES,
  CONSENTIMIENTO_ANEXOS,
};
