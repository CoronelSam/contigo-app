'use strict';

// Operaciones con PDF (pdf-lib): leer plantillas, rellenar por nombre de campo o por coordenadas,
// aplanar, anexar páginas de documentos y extraer una página. Nunca rellena campos de firma.

const sharp = require('sharp');
const {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFTextField,
  PDFCheckBox,
  PDFSignature,
  PDFButton,
  PDFRef,
} = require('pdf-lib');

/** A4 en puntos, para las páginas de los anexos que son imágenes. */
const A4 = Object.freeze([595.28, 841.89]);
const MARGEN = 18;
/** Lado mayor de una imagen anexada (A4 a unos 200 ppp): mantiene el paquete liviano. */
const LADO_IMAGEN = 2339;
const TAMANO_POR_DEFECTO = 10;
const TAMANO_MINIMO = 6;

class ErrorPdf extends Error {
  constructor(codigo) {
    super(codigo);
    this.name = 'ErrorPdf';
    this.codigo = codigo;
  }
}

/**
 * Abre un PDF. Un PDF cifrado o dañado lanza ErrorPdf con `codigo`.
 * @param {Uint8Array} bytes
 * @param {string} [codigo]
 */
async function abrir(bytes, codigo = 'PDF_INVALIDO') {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new ErrorPdf(codigo);
  }
}

/** Tipo de un campo del formulario: texto, casilla, firma u otro. */
function tipoDeCampo(campo) {
  if (campo instanceof PDFTextField) return 'texto';
  if (campo instanceof PDFCheckBox) return 'casilla';
  if (campo instanceof PDFSignature) return 'firma';
  return 'otro';
}

/**
 * Páginas y campos de formulario de una plantilla.
 * @param {Uint8Array} bytes
 * @returns {Promise<{ paginas: number, campos: Map<string, string> }>}
 */
async function inspeccionar(bytes) {
  const doc = await abrir(bytes);
  const campos = new Map(
    doc
      .getForm()
      .getFields()
      .map((c) => [c.getName(), tipoDeCampo(c)]),
  );
  return { paginas: doc.getPageCount(), campos };
}

const caracteresDe = new WeakMap();

/** Texto que la fuente estándar puede escribir: quita tildes que no existen en WinAnsi. */
function textoEscribible(texto, fuente, { multilinea = false } = {}) {
  if (!caracteresDe.has(fuente)) caracteresDe.set(fuente, new Set(fuente.getCharacterSet()));
  const permitidos = caracteresDe.get(fuente);
  const limpio = String(texto)
    .normalize('NFC')
    .replace(multilinea ? /[^\S\n]+/g : /\s+/g, ' ')
    .trim();
  let salida = '';
  for (const ch of limpio) {
    if (ch === '\n' || permitidos.has(ch.codePointAt(0))) {
      salida += ch;
      continue;
    }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    salida += [...base].every((c) => permitidos.has(c.codePointAt(0))) ? base : '?';
  }
  return salida;
}

/**
 * Rellena los campos del formulario por nombre (método `campo`). Las casillas se marcan o
 * desmarcan; los textos más largos que el máximo del campo se recortan.
 * @param {PDFDocument} doc
 * @param {{ campoPdf: string, texto?: string, marcada?: boolean }[]} valores
 * @returns {Promise<{ recortados: string[] }>}
 */
async function rellenarPorCampo(doc, valores) {
  const form = doc.getForm();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const recortados = [];
  for (const v of valores) {
    const campo = form.getFieldMaybe(v.campoPdf);
    if (!campo) throw new ErrorPdf('PLANTILLA_CAMPO_INEXISTENTE');
    if (campo instanceof PDFCheckBox) {
      if (v.marcada) campo.check();
      else campo.uncheck();
    } else if (campo instanceof PDFTextField) {
      let texto = textoEscribible(v.texto ?? '', fuente, { multilinea: campo.isMultiline() });
      const maximo = campo.getMaxLength();
      if (maximo !== undefined && texto.length > maximo) {
        texto = texto.slice(0, maximo);
        recortados.push(v.campoPdf);
      }
      campo.setText(texto || undefined);
    }
  }
  try {
    form.updateFieldAppearances(fuente);
  } catch {
    throw new ErrorPdf('PLANTILLA_NO_APLANABLE');
  }
  return { recortados };
}

/**
 * Quita un campo y sus widgets de las páginas. `PDFForm.removeField` exige que el widget tenga
 * apariencia, y los campos de firma sin firmar casi nunca la tienen.
 */
function quitarCampo(doc, campo) {
  const refs = [campo.ref];
  const hijos = campo.acroField.normalizedEntries().Kids;
  for (let i = 0; i < (hijos?.size() ?? 0); i += 1) {
    const hijo = hijos.get(i);
    if (hijo instanceof PDFRef) refs.push(hijo);
  }
  for (const pagina of doc.getPages()) {
    for (const ref of refs) pagina.node.removeAnnot(ref);
  }
  doc.getForm().acroForm.removeField(campo.acroField);
  for (const ref of refs) doc.context.delete(ref);
}

/**
 * Aplana el formulario: los valores quedan como parte de la página y nadie los puede cambiar.
 * Los campos de firma y los botones se quitan sin rellenar (las firmas nunca se reproducen).
 * @param {PDFDocument} doc
 * @returns {{ firmas: string[] }} Nombres de los campos de firma que quedaron por firmar.
 */
function aplanar(doc) {
  const form = doc.getForm();
  const firmas = [];
  for (const campo of form.getFields()) {
    if (campo instanceof PDFSignature) firmas.push(campo.getName());
    if (campo instanceof PDFSignature || campo instanceof PDFButton) quitarCampo(doc, campo);
  }
  if (!form.getFields().length) return { firmas };
  try {
    form.flatten();
  } catch {
    throw new ErrorPdf('PLANTILLA_NO_APLANABLE');
  }
  return { firmas };
}

/**
 * Escribe texto en coordenadas sobre las páginas (método `coordenadas`, formularios escaneados).
 * Con `ancho`, reduce la letra hasta 6 pt y, si aun así no cabe, recorta.
 * @param {PDFDocument} doc
 * @param {{ pagina: number, x: number, y: number, tamano?: number, ancho?: number,
 *   texto?: string, marcada?: boolean, etiqueta: string }[]} valores
 * @returns {Promise<{ recortados: string[] }>}
 */
async function dibujarPorCoordenadas(doc, valores) {
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const paginas = doc.getPages();
  const recortados = [];
  for (const v of valores) {
    const pagina = paginas[v.pagina - 1];
    if (!pagina) throw new ErrorPdf('PLANTILLA_PAGINA_INEXISTENTE');
    let texto = v.marcada === undefined ? textoEscribible(v.texto ?? '', fuente) : 'X';
    if (v.marcada === false || !texto) continue;
    let tamano = v.tamano ?? TAMANO_POR_DEFECTO;
    if (v.ancho) {
      while (tamano > TAMANO_MINIMO && fuente.widthOfTextAtSize(texto, tamano) > v.ancho) {
        tamano = Math.max(TAMANO_MINIMO, tamano - 0.5);
      }
      if (fuente.widthOfTextAtSize(texto, tamano) > v.ancho) {
        while (texto.length > 1 && fuente.widthOfTextAtSize(`${texto}…`, tamano) > v.ancho) {
          texto = texto.slice(0, -1);
        }
        texto = `${texto.trimEnd()}…`;
        recortados.push(v.etiqueta);
      }
    }
    pagina.drawText(texto, { x: v.x, y: v.y, size: tamano, font: fuente, color: rgb(0, 0, 0) });
  }
  return { recortados };
}

/**
 * Agrega al paquete todas las páginas de `doc`.
 * @param {PDFDocument} salida
 * @param {PDFDocument} doc
 * @returns {Promise<number>} Páginas agregadas.
 */
async function agregarDocumento(salida, doc) {
  const copias = await salida.copyPages(doc, doc.getPageIndices());
  for (const p of copias) salida.addPage(p);
  return copias.length;
}

/**
 * Agrega una página de documento (imagen o PDF) como anexo. Las imágenes se normalizan
 * (orientación EXIF, tamaño, JPEG) y se centran en una hoja A4.
 * @param {PDFDocument} salida
 * @param {{ mime: string, bytes: Buffer }} archivo
 * @returns {Promise<number>} Páginas agregadas.
 */
async function agregarAnexo(salida, { mime, bytes }) {
  if (mime === 'application/pdf') {
    return agregarDocumento(salida, await abrir(bytes, 'ANEXO_DANADO'));
  }
  let jpeg;
  try {
    jpeg = await sharp(bytes)
      .rotate()
      .resize({ width: LADO_IMAGEN, height: LADO_IMAGEN, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 75 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ErrorPdf('ANEXO_DANADO');
  }
  const imagen = await salida.embedJpg(jpeg.data);
  const horizontal = jpeg.info.width > jpeg.info.height;
  const [ancho, alto] = horizontal ? [A4[1], A4[0]] : A4;
  const escala = Math.min(
    (ancho - 2 * MARGEN) / jpeg.info.width,
    (alto - 2 * MARGEN) / jpeg.info.height,
  );
  const w = jpeg.info.width * escala;
  const h = jpeg.info.height * escala;
  salida
    .addPage([ancho, alto])
    .drawImage(imagen, { x: (ancho - w) / 2, y: (alto - h) / 2, width: w, height: h });
  return 1;
}

/**
 * PDF de una sola página con la página `n` (desde 1).
 * @param {Uint8Array} bytes
 * @param {number} n
 * @returns {Promise<Uint8Array>}
 */
async function extraerPagina(bytes, n) {
  const origen = await abrir(bytes, 'PAQUETE_DANADO');
  if (n < 1 || n > origen.getPageCount()) throw new ErrorPdf('PAGINA_FUERA_DE_RANGO');
  const salida = await PDFDocument.create();
  const [pagina] = await salida.copyPages(origen, [n - 1]);
  salida.addPage(pagina);
  return salida.save();
}

/** Documento nuevo para el paquete. */
async function crearPaquete({ titulo }) {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo);
  doc.setProducer('Vanguardia');
  doc.setCreator('Vanguardia');
  return doc;
}

module.exports = {
  ErrorPdf,
  abrir,
  inspeccionar,
  rellenarPorCampo,
  dibujarPorCoordenadas,
  aplanar,
  agregarDocumento,
  agregarAnexo,
  extraerPagina,
  crearPaquete,
};
