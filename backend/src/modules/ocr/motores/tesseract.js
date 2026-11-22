'use strict';

// Motor Tesseract.js (respaldo, en el propio servidor: las imágenes no salen de él).
// Texto, fechas, números y opciones: OCR de la zona recortada. Casillas: densidad de píxeles
// oscuros (preprocesar.js). Los datos de idioma vienen de OCR_TESSERACT_DATOS o, si no se indica,
// del CDN de Tesseract.js la primera vez, y se guardan en OCR_TESSERACT_CACHE.

const path = require('node:path');
const { config } = require('../../../config/env');
const { preprocesar, recortar, leerCasilla } = require('./preprocesar');

function opciones() {
  const { datos, cache } = config().ocr.tesseract;
  return {
    ...(datos ? { langPath: datos } : {}),
    cachePath: path.resolve(cache),
    logger: () => {},
    errorHandler: () => {},
  };
}

module.exports = {
  nombre: 'tesseract',

  /**
   * @param {{ paginas: Array<{ numero: number, buffer: Buffer, mime: string }>, zonas: object[],
   *   alProgresar?: (numero: number) => Promise<void> | void }} p
   */
  async procesar({ paginas, zonas, alProgresar }) {
    const { createWorker, PSM } = require('tesseract.js');
    let worker;
    const campos = [];
    const crudo = [];
    try {
      for (const pagina of paginas) {
        const deLaPagina = zonas.filter((z) => z.pagina === pagina.numero);
        if (!deLaPagina.length) continue;
        const imagen = await preprocesar(pagina.buffer, pagina.mime);
        for (const zona of deLaPagina) {
          if (zona.tipo === 'casilla') {
            const { marcada, confianza, densidad } = await leerCasilla(imagen, zona.caja);
            campos.push({
              campo: zona.campo,
              valor: String(marcada),
              confianza,
              pagina: zona.pagina,
              coordenadas: zona.caja,
            });
            crudo.push({ campo: zona.campo, densidad });
            continue;
          }
          if (!worker) {
            worker = await createWorker(config().ocr.tesseract.idioma, undefined, opciones());
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
          }
          const { data } = await worker.recognize(await recortar(imagen, zona.caja));
          const texto = (data.text ?? '').replace(/\s+/g, ' ').trim();
          campos.push({
            campo: zona.campo,
            valor: texto,
            confianza: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)),
            pagina: zona.pagina,
            coordenadas: zona.caja,
          });
          crudo.push({ campo: zona.campo, texto });
        }
        await alProgresar?.(pagina.numero);
      }
    } finally {
      await worker?.terminate();
    }
    return { motor: 'tesseract', campos, crudo };
  },

  /** Comprueba que la biblioteca está instalada (sin arrancar un worker). */
  async verificar() {
    require.resolve('tesseract.js');
    return true;
  },
};
