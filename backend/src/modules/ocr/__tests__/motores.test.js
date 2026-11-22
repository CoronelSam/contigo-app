'use strict';

const sharp = require('sharp');
const { preprocesar, leerCasilla, ImagenNoSoportada } = require('../motores/preprocesar');
const nube = require('../motores/nube');
const simulado = require('../motores/simulado');
const { fechaIso, normalizarValor } = require('../valores');
const { ZONAS } = require('./ayudantes');

/** Página blanca con 2 casillas: una rellena (marcada) y otra solo con borde (vacía). */
async function paginaConCasillas() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
    <rect x="40" y="40" width="60" height="60" fill="none" stroke="black" stroke-width="4"/>
    <rect x="200" y="40" width="60" height="60" fill="none" stroke="black" stroke-width="4"/>
    <path d="M205 45 L255 95 M255 45 L205 95" stroke="black" stroke-width="14"/>
  </svg>`;
  return sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from(svg) }])
    .jpeg()
    .toBuffer();
}

describe('preprocesado y casillas (sin Tesseract)', () => {
  test('detecta la casilla marcada por densidad de píxeles oscuros, sin contar el borde', async () => {
    const imagen = await preprocesar(await paginaConCasillas(), 'image/jpeg');
    expect(imagen.ancho).toBe(2000);
    const vacia = await leerCasilla(imagen, { x: 0.1, y: 0.2, ancho: 0.15, alto: 0.3 });
    const marcada = await leerCasilla(imagen, { x: 0.5, y: 0.2, ancho: 0.15, alto: 0.3 });
    expect(vacia.marcada).toBe(false);
    expect(marcada.marcada).toBe(true);
    expect(vacia.confianza).toBeGreaterThan(0.8);
    expect(marcada.confianza).toBeGreaterThan(0.5);
  });

  test('un PDF no se lee como imagen', async () => {
    await expect(preprocesar(Buffer.from('%PDF-1.4'), 'application/pdf')).rejects.toBeInstanceOf(
      ImagenNoSoportada,
    );
  });
});

describe('valores', () => {
  test.each([
    ['01/02/2020', 'DD/MM/AAAA', '2020-02-01'],
    ['1.2.2020', 'DD/MM/AAAA', '2020-02-01'],
    ['02/01/2020', 'MM/DD/AAAA', '2020-02-01'],
    ['2020-02-01', 'AAAA-MM-DD', '2020-02-01'],
    ['03/2019', 'MM/AAAA', '2019-03'],
    ['2019', 'AAAA', '2019'],
    ['29/02/2021', 'DD/MM/AAAA', null],
    ['13/13/2020', 'DD/MM/AAAA', null],
    ['01/02/1850', 'DD/MM/AAAA', null],
    ['2020/02/01', 'DD/MM/AAAA', null],
  ])('fecha %s con formato %s → %s', (texto, formato, esperado) => {
    expect(fechaIso(texto, formato)).toBe(esperado);
  });

  test('números, casillas y opciones', () => {
    expect(normalizarValor({ tipo: 'numero' }, '3,25')).toEqual({ ok: true, valor: '3.25' });
    expect(normalizarValor({ tipo: 'casilla' }, 'X')).toEqual({ ok: true, valor: 'true' });
    expect(normalizarValor({ tipo: 'casilla' }, null).ok).toBe(false);
    expect(normalizarValor({ tipo: 'opcion', opciones: ['a', 'b'] }, 'c')).toEqual({
      ok: false,
      codigo: 'VALOR_NO_PERMITIDO',
    });
    expect(normalizarValor({ tipo: 'texto' }, '   ')).toEqual({ ok: true, valor: null });
  });
});

describe('motores', () => {
  test('el simulado es determinista y solo lee las zonas de las páginas que recibe', async () => {
    const a = await simulado.procesar({ paginas: [{ numero: 1 }], zonas: ZONAS });
    const b = await simulado.procesar({ paginas: [{ numero: 1 }], zonas: ZONAS });
    expect(a).toEqual(b);
    expect(a.campos.map((c) => c.campo)).toEqual(['diagnostico', 'fecha_inicio']);
  });

  test('el de la nube no está implementado (requiere aprobación de la organización)', async () => {
    await expect(nube.procesar()).rejects.toMatchObject({ codigo: 'NO_IMPLEMENTADO' });
    await expect(nube.verificar()).rejects.toMatchObject({ codigo: 'NO_IMPLEMENTADO' });
  });
});

// Lento y necesita los datos de idioma de Tesseract (OCR_TESSERACT_DATOS o la descarga del CDN
// de Tesseract.js). Se corre a pedido: OCR_PROBAR_TESSERACT=1 pnpm test -- motores
const conTesseract = process.env.OCR_PROBAR_TESSERACT === '1' ? test : test.skip;

conTesseract(
  'Tesseract lee el texto de una zona de una imagen sintética',
  async () => {
    const tesseract = require('../motores/tesseract');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200">
      <text x="40" y="120" font-family="Arial, Helvetica, sans-serif" font-size="72">FICTICIO</text>
    </svg>`;
    const buffer = await sharp({
      create: { width: 800, height: 200, channels: 3, background: '#ffffff' },
    })
      .composite([{ input: Buffer.from(svg) }])
      .png()
      .toBuffer();
    const r = await tesseract.procesar({
      paginas: [{ numero: 1, buffer, mime: 'image/png' }],
      zonas: [{ ...ZONAS[0], caja: { x: 0, y: 0, ancho: 1, alto: 1 } }],
    });
    expect(r.campos[0].valor.toUpperCase()).toContain('FICTICIO');
    expect(r.campos[0].confianza).toBeGreaterThan(0.5);
  },
  120_000,
);
