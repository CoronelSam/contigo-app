'use strict';

// Ayudantes de las pruebas del módulo paquetes. Los PDF se generan aquí con pdf-lib (nunca PDF
// oficiales reales) y todos los datos son ficticios.

const zlib = require('node:zlib');
const sharp = require('sharp');
const { PDFDocument, PDFString, PDFName, PDFRawStream } = require('pdf-lib');
const db = require('../../../models');
const f = require('../../../../test/factories');
const almacenamiento = require('../../../core/almacenamiento');
const { guardarArchivo } = require('../../../core/archivos');
const {
  estadoExpediente,
  TIPOS_CONSENTIMIENTO,
  CODIGOS_SECCIONES_JSON,
} = require('../../../core/expediente');
const { api } = require('../../../../test/helpers/app');

const con = (req, token) => req.set('Authorization', `Bearer ${token}`);

/** Agrega a la página un campo de firma sin apariencia, como en los formularios reales. */
function campoDeFirma(doc, pagina, nombre) {
  const firma = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of(nombre),
    Rect: [60, 60, 300, 100],
    F: 4,
    P: pagina.ref,
  });
  const ref = doc.context.register(firma);
  pagina.node.addAnnot(ref);
  doc.getForm().acroForm.addField(ref);
}

/**
 * Formulario rellenable de 2 páginas (estilo internacional) con un campo de firma.
 * @param {{ extra?: string }} [opciones] `extra`: nombre de un campo de texto más (versiones).
 */
async function pdfFormulario({ extra } = {}) {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);
  const form = doc.getForm();
  const texto = (nombre, pagina, y, opciones = {}) => {
    const campo = form.createTextField(nombre);
    if (opciones.multilinea) campo.enableMultiline();
    if (opciones.maximo) campo.setMaxLength(opciones.maximo);
    campo.addToPage(pagina, { x: 60, y, width: 400, height: opciones.alto ?? 20 });
    campo.setFontSize(10);
  };
  texto('PatientLastName', p1, 700);
  texto('PatientFirstName', p1, 660);
  texto('DateOfBirth', p1, 620);
  texto('CaseCode', p1, 580, { maximo: 4 });
  form.createCheckBox('Female').addToPage(p1, { x: 60, y: 540, width: 12, height: 12 });
  form.createCheckBox('Telehealth').addToPage(p1, { x: 60, y: 510, width: 12, height: 12 });
  texto('Diagnosis', p2, 600, { multilinea: true, alto: 80 });
  texto('CareRequested', p2, 500);
  if (extra) texto(extra, p2, 450);
  campoDeFirma(doc, p2, 'ParentSignature');
  return Buffer.from(await doc.save());
}

/** "Escaneado" de 1 página (estilo México): una imagen, sin campos de formulario. */
async function pdfEscaneado() {
  const doc = await PDFDocument.create();
  const png = await sharp({
    create: { width: 300, height: 390, channels: 3, background: { r: 245, g: 245, b: 238 } },
  })
    .png()
    .toBuffer();
  const imagen = await doc.embedPng(png);
  doc.addPage([612, 792]).drawImage(imagen, { x: 0, y: 0, width: 612, height: 792 });
  return Buffer.from(await doc.save());
}

/** Mapa del formulario internacional de prueba (método `campo`). */
const MAPA_INTERNACIONAL = Object.freeze([
  { destino: { campoPdf: 'PatientLastName' }, origen: 'paciente.apellidos', tipo: 'texto' },
  { destino: { campoPdf: 'PatientFirstName' }, origen: 'paciente.nombres', tipo: 'texto' },
  {
    destino: { campoPdf: 'DateOfBirth' },
    origen: 'paciente.fechaNacimiento',
    tipo: 'fecha',
    formato: 'MM/DD/AAAA',
  },
  { destino: { campoPdf: 'CaseCode' }, origen: 'solicitud.codigo', tipo: 'texto' },
  {
    destino: { campoPdf: 'Female' },
    origen: 'paciente.sexo',
    tipo: 'casilla',
    valor: 'femenino',
  },
  {
    destino: { campoPdf: 'Telehealth' },
    origen: 'consentimiento.telesalud.decision',
    tipo: 'casilla',
  },
  {
    destino: { campoPdf: 'Diagnosis' },
    origen: 'seccion.informacion_medica./diagnostico',
    tipo: 'texto',
  },
  {
    destino: { campoPdf: 'CareRequested' },
    origen: 'seccion.informacion_medica./atencionSolicitada',
    tipo: 'texto',
  },
]);

/** Mapa del formulario escaneado de México (método `coordenadas`). */
const MAPA_MEXICO = Object.freeze([
  {
    destinoCoordenadas: { pagina: 1, x: 80, y: 700, tamano: 11 },
    origen: 'paciente.nombreCompleto',
    tipo: 'texto',
  },
  {
    destinoCoordenadas: { pagina: 1, x: 80, y: 660, ancho: 120 },
    origen: 'seccion.informacion_medica./diagnostico',
    tipo: 'texto',
  },
  {
    destinoCoordenadas: { pagina: 1, x: 80, y: 620 },
    origen: 'tutorResponsable.parentesco',
    tipo: 'texto',
  },
  {
    destinoCoordenadas: { pagina: 1, x: 300, y: 620 },
    origen: 'paciente.sexo',
    tipo: 'casilla',
    valor: 'femenino',
  },
]);

/** Plantilla con su PDF guardado de verdad en el almacenamiento (sin pasar por la API). */
async function plantillaReal({ pdf, ...datos }) {
  const archivo = await guardarArchivo({ buffer: pdf, prefijo: 'plantillas' });
  return f.crearPlantilla({ archivoPdfId: archivo.id, ...datos });
}

/** Plantillas activas de los dos paquetes. */
async function plantillasDePrueba() {
  const internacional = await plantillaReal({
    pdf: await pdfFormulario(),
    codigo: 'solicitud_internacional_prueba',
    paquete: 'INTERNACIONAL',
    metodo: 'campo',
    mapaCampos: MAPA_INTERNACIONAL,
  });
  const mexico = await plantillaReal({
    pdf: await pdfEscaneado(),
    codigo: 'formulario_mexico_prueba',
    paquete: 'MEXICO',
    metodo: 'coordenadas',
    mapaCampos: MAPA_MEXICO,
  });
  return { internacional, mexico };
}

/** Imagen JPEG ficticia (una "foto" de documento). */
const imagen = (n = 1) =>
  sharp({
    create: { width: 60, height: 90, channels: 3, background: { r: 200, g: 210 - n, b: 220 } },
  })
    .jpeg()
    .toBuffer();

/** PDF de una página con una imagen de ruido que no se comprime (~5 MB): un escaneo pesado. */
async function pdfPesado() {
  const jpeg = await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 3,
      noise: { type: 'gaussian', mean: 128, sigma: 60 },
    },
  })
    .jpeg({ quality: 100 })
    .toBuffer();
  const doc = await PDFDocument.create();
  const imagenPesada = await doc.embedJpg(jpeg);
  doc.addPage([600, 600]).drawImage(imagenPesada, { x: 0, y: 0, width: 600, height: 600 });
  return Buffer.from(await doc.save());
}

/**
 * Documento con páginas guardadas de verdad en el almacenamiento. Con `contenido`, todas las
 * páginas son ese archivo; si no, una imagen distinta por página.
 */
async function documentoConPaginas({
  solicitud,
  tipo,
  estado = 'VALIDADO',
  paginas = 1,
  contenido,
}) {
  const documento = await f.crearDocumento({
    solicitud,
    tipo,
    estado,
    paginas: 0,
    paginasDeclaradas: paginas,
  });
  for (let orden = 1; orden <= paginas; orden += 1) {
    const buffer = contenido ?? (await imagen(orden));
    const archivo = await guardarArchivo({ buffer, prefijo: 'documentos' });
    await db.DocumentoPagina.create({ documentoId: documento.id, orden, archivoId: archivo.id });
  }
  return documento;
}

const DIAGNOSTICO = 'Diagnóstico ficticio de prueba';

const DATOS_SECCION = Object.freeze({
  informacion_medica: {
    diagnostico: DIAGNOSTICO,
    fechaInicio: '2020-02',
    atencionSolicitada: 'pie_zambo',
  },
});

/**
 * Deja el expediente sin obligatorios pendientes para su etapa: secciones completas,
 * profesional con certificación, consentimientos decididos y firmados, y los documentos de los
 * requisitos activos validados (con páginas reales).
 * @param {object} solicitud
 * @param {{ decision?: (tipo: string) => 'acepta' | 'no_acepta' }} [opciones]
 */
async function completarExpediente(solicitud, { decision = () => 'acepta' } = {}) {
  for (const seccion of CODIGOS_SECCIONES_JSON) {
    await f.crearSeccion({
      solicitud,
      seccion,
      estado: 'completa',
      datos: DATOS_SECCION[seccion] ?? {},
    });
  }
  const requisitos = await db.RequisitoRuta.findAll({
    where: { ruta: ['EVALUACION', solicitud.paquete].filter(Boolean), activo: true },
    include: [{ association: 'tipoDocumento' }],
  });
  // Los formularios cubiertos por las secciones (modalidad app) no se suben.
  const tipos = requisitos
    .filter((r) => r.obligatorio && !r.cubiertoPorSecciones.length)
    .map((r) => r.tipoDocumento.codigo);
  for (const tipo of new Set([...tipos, 'certificacion_medica'])) {
    await documentoConPaginas({ solicitud, tipo });
  }
  await db.ProfesionalSalud.create({
    solicitudId: solicitud.id,
    nombre: 'Dra. Ficticia Prueba',
    especialidad: 'ortopedia_pediatrica',
    telefono: '+50400000000',
  });
  for (const tipo of TIPOS_CONSENTIMIENTO) {
    await db.Consentimiento.create({
      solicitudId: solicitud.id,
      tipo,
      decision: decision(tipo),
      decididoEn: new Date(),
      estadoFirma: 'firmado',
    });
  }
  const expediente = await estadoExpediente(solicitud.id);
  if (!expediente.listoParaConfirmar) {
    throw new Error(`Expediente incompleto: ${JSON.stringify(expediente.faltantes)}`);
  }
  return expediente;
}

/** Lee del almacenamiento el PDF de un archivo. */
async function leerArchivo(archivoId) {
  const archivo = await db.Archivo.findByPk(archivoId);
  const flujo = await almacenamiento.leerObjeto(archivo.clave);
  const partes = [];
  for await (const parte of flujo) partes.push(Buffer.from(parte));
  return Buffer.concat(partes);
}

/**
 * Texto aproximado de un PDF: el contenido de todos sus streams (descomprimidos) con las cadenas
 * hexadecimales decodificadas. Suficiente para saber si un dato entró o no al paquete.
 */
async function textoDelPdf(bytes) {
  const doc = await PDFDocument.load(bytes);
  let todo = '';
  for (const [, objeto] of doc.context.enumerateIndirectObjects()) {
    if (!(objeto instanceof PDFRawStream)) continue;
    let contenido = Buffer.from(objeto.contents);
    if (objeto.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode') {
      try {
        contenido = zlib.inflateSync(contenido);
      } catch {
        continue;
      }
    }
    todo += `${contenido.toString('latin1')}\n`;
  }
  return todo.replace(/<([0-9A-Fa-f\s]+)>/g, (_, hex) =>
    Buffer.from(hex.replace(/\s/g, ''), 'hex').toString('latin1'),
  );
}

/** Solicita un paquete por la API. */
const solicitar = (solicitud, token, tipo, esperado = 202) =>
  con(api().post(`/api/v1/solicitudes/${solicitud.id}/paquetes`), token)
    .send({ tipo })
    .expect(esperado);

module.exports = {
  con,
  pdfFormulario,
  pdfEscaneado,
  MAPA_INTERNACIONAL,
  MAPA_MEXICO,
  DIAGNOSTICO,
  plantillaReal,
  plantillasDePrueba,
  documentoConPaginas,
  pdfPesado,
  completarExpediente,
  leerArchivo,
  textoDelPdf,
  solicitar,
};
