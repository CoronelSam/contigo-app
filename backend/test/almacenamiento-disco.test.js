'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { crearAdaptadorDisco, RUTA_DESCARGA } = require('../src/core/almacenamiento/disco');
const { manejadorErrores } = require('../src/core/errores/manejador');

describe('almacenamiento en disco (desarrollo)', () => {
  let directorio;
  let disco;
  let app;

  beforeAll(() => {
    directorio = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguardia-disco-'));
    disco = crearAdaptadorDisco({
      directorio,
      secreto: 'secreto-de-prueba-'.repeat(3),
      urlBase: 'http://api.prueba',
      urlFirmadaSegundos: 300,
    });
    const servidor = express();
    servidor.get(`${RUTA_DESCARGA}/*clave`, disco.manejarDescarga);
    servidor.use(manejadorErrores);
    app = request(servidor);
  });

  afterAll(() => fs.rmSync(directorio, { recursive: true, force: true }));

  const sinOrigen = (url) => url.replace('http://api.prueba', '');

  test('sube, firma y descarga con el tipo correcto y sin caché', async () => {
    const clave = 'pacientes/2026/11/foto prueba.jpg';
    await disco.subirObjeto({ clave, cuerpo: Buffer.from('imagen-falsa'), mime: 'image/jpeg' });
    expect(await disco.existeObjeto(clave)).toBe(true);

    const url = await disco.urlFirmadaGet(clave);
    expect(url).toMatch(
      /^http:\/\/api\.prueba\/archivos-locales\/pacientes\/2026\/11\/foto%20prueba\.jpg\?expira=\d+&firma=[0-9a-f]{64}$/,
    );

    const res = await app.get(sinOrigen(url)).buffer(true).expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.toString()).toBe('imagen-falsa');
  });

  test('una firma alterada responde 403 FIRMA_INVALIDA', async () => {
    await disco.subirObjeto({ clave: 'a/b.txt', cuerpo: 'x', mime: 'text/plain' });
    const url = await disco.urlFirmadaGet('a/b.txt');
    const alterada = url.replace(/firma=(.)/, (_, c) => `firma=${c === '0' ? '1' : '0'}`);
    const res = await app.get(sinOrigen(alterada)).expect(403);
    expect(res.body.codigo).toBe('FIRMA_INVALIDA');
  });

  test('la firma de un archivo no sirve para otro', async () => {
    await disco.subirObjeto({ clave: 'a/otro.txt', cuerpo: 'y', mime: 'text/plain' });
    const url = await disco.urlFirmadaGet('a/b.txt');
    const res = await app.get(sinOrigen(url).replace('a/b.txt', 'a/otro.txt')).expect(403);
    expect(res.body.codigo).toBe('FIRMA_INVALIDA');
  });

  test('un enlace vencido responde 403 URL_VENCIDA', async () => {
    const url = await disco.urlFirmadaGet('a/b.txt', -10);
    const res = await app.get(sinOrigen(url)).expect(403);
    expect(res.body.codigo).toBe('URL_VENCIDA');
  });

  test('un archivo inexistente con firma válida responde 404', async () => {
    const url = await disco.urlFirmadaGet('a/no-existe.txt');
    await app.get(sinOrigen(url)).expect(404);
  });

  test('rechaza claves que intentan salir de la carpeta', async () => {
    await expect(
      disco.subirObjeto({ clave: '../fuera.txt', cuerpo: 'x', mime: 'text/plain' }),
    ).rejects.toMatchObject({ codigo: 'CLAVE_INVALIDA' });
    await expect(disco.urlFirmadaGet('a/../../etc/passwd')).rejects.toMatchObject({
      codigo: 'CLAVE_INVALIDA',
    });
    const res = await app.get(
      `${RUTA_DESCARGA}/a/%2E%2E/%2E%2E/secreto?expira=9999999999&firma=00`,
    );
    expect([400, 403]).toContain(res.status);
    expect(fs.existsSync(path.join(directorio, '..', 'fuera.txt'))).toBe(false);
  });

  test('lee el objeto como stream y verifica la carpeta', async () => {
    let texto = '';
    for await (const parte of await disco.leerObjeto('a/b.txt')) texto += parte;
    expect(texto).toBe('x');
    await expect(disco.leerObjeto('a/nada.txt')).rejects.toMatchObject({ name: 'NoSuchKey' });
    expect(await disco.verificar()).toBe(true);
  });
});
