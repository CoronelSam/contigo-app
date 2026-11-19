'use strict';

const http = require('node:http');
const { crearAdaptadorS3 } = require('../src/core/almacenamiento/s3');

// Cloudflare R2 rechaza el encabezado de cifrado SSE y los checksums CRC32 que el SDK v3
// manda por defecto. Un servidor local hace de R2 y registra lo que llega.

const BUCKET = 'vanguardia-prueba';

const cfgBase = {
  region: 'auto',
  bucket: BUCKET,
  accessKey: 'CLAVE-FICTICIA',
  secretKey: 'secreto-ficticio',
  urlFirmadaSegundos: 300,
};

describe('almacenamiento s3 (Cloudflare R2)', () => {
  let servidor;
  let peticiones;
  let responder;
  let s3;

  beforeAll(async () => {
    servidor = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (c) => (cuerpo += c));
      req.on('end', () => {
        peticiones.push({ metodo: req.method, url: req.url, encabezados: req.headers, cuerpo });
        responder(req, res);
      });
    });
    await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    s3 = crearAdaptadorS3({
      ...cfgBase,
      endpoint: `http://127.0.0.1:${servidor.address().port}`,
      forcePathStyle: true,
    });
  });

  afterAll(() => new Promise((resolve) => servidor.close(resolve)));

  beforeEach(() => {
    peticiones = [];
    responder = (req, res) => res.writeHead(200, { ETag: '"etag-ficticio"' }).end();
  });

  test('sube sin encabezado de cifrado SSE ni checksums que R2 no implementa', async () => {
    await s3.subirObjeto({
      clave: 'pacientes/2026/11/foto.jpg',
      cuerpo: Buffer.from('imagen-falsa'),
      mime: 'image/jpeg',
    });

    expect(peticiones).toHaveLength(1);
    const [p] = peticiones;
    expect(p.metodo).toBe('PUT');
    expect(new URL(p.url, 'http://r2').pathname).toBe(`/${BUCKET}/pacientes/2026/11/foto.jpg`);
    expect(p.cuerpo).toBe('imagen-falsa');
    expect(p.encabezados['content-type']).toBe('image/jpeg');
    expect(p.encabezados.authorization).toContain('/auto/s3/aws4_request');
    const nombres = Object.keys(p.encabezados);
    expect(nombres).not.toContain('x-amz-server-side-encryption');
    expect(nombres.filter((n) => n.startsWith('x-amz-checksum-'))).toEqual([]);
    expect(nombres).not.toContain('x-amz-sdk-checksum-algorithm');
  });

  test('existeObjeto distingue un objeto ausente', async () => {
    responder = (req, res) => res.writeHead(404).end();
    expect(await s3.existeObjeto('no/existe.pdf')).toBe(false);
    expect(peticiones[0].metodo).toBe('HEAD');
  });

  test('verificar lista solo el prefijo de salud y falla si el token no sirve', async () => {
    responder = (req, res) =>
      res
        .writeHead(200, { 'Content-Type': 'application/xml' })
        .end(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${BUCKET}</Name>` +
            '<Prefix>_salud/</Prefix><KeyCount>0</KeyCount><MaxKeys>1</MaxKeys>' +
            '<IsTruncated>false</IsTruncated></ListBucketResult>',
        );
    expect(await s3.verificar()).toBe(true);
    const url = new URL(peticiones[0].url, 'http://r2');
    expect(url.pathname).toBe(`/${BUCKET}/`);
    expect(url.searchParams.get('prefix')).toBe('_salud/');
    expect(url.searchParams.get('max-keys')).toBe('1');

    responder = (req, res) =>
      res
        .writeHead(403, { 'Content-Type': 'application/xml' })
        .end('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>');
    await expect(s3.verificar()).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  test('firma URL de 5 minutos con el endpoint del API S3 de R2 y región auto', async () => {
    const r2 = crearAdaptadorS3({
      ...cfgBase,
      endpoint: 'https://cuenta-ficticia.r2.cloudflarestorage.com',
      forcePathStyle: false,
    });
    const url = new URL(await r2.urlFirmadaGet('pacientes/2026/11/foto.jpg'));

    expect(url.origin).toBe(`https://${BUCKET}.cuenta-ficticia.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe('/pacientes/2026/11/foto.jpg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/\/auto\/s3\/aws4_request$/);
    expect(url.searchParams.has('x-amz-checksum-mode')).toBe(false);
  });
});
