'use strict';

const crypto = require('node:crypto');
const { Router } = require('express');
const sharp = require('sharp');
const db = require('../../src/models');
const f = require('../factories');
const { limpiarBase } = require('../helpers/db');
const { tokenPara } = require('../helpers/auth');
const { appDePrueba } = require('../helpers/app');
const { requiereAuth } = require('../../src/core/auth');
const contexto = require('../../src/core/contexto');
const almacenamiento = require('../../src/core/almacenamiento');
const archivos = require('../../src/core/archivos');

const imagen = (formato = 'jpeg') =>
  sharp({ create: { width: 10, height: 8, channels: 3, background: '#4a7' } })
    [formato]()
    .toBuffer();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');

describe('core/archivos', () => {
  beforeEach(() => limpiarBase());

  test('guarda un JPEG real con su tipo, tamaño, hash y dimensiones', async () => {
    const usuario = await f.crearUsuario();
    const buffer = await imagen();
    const archivo = await contexto.ejecutarCon(
      { usuario: { id: usuario.id, rol: 'familia' } },
      () => archivos.guardarArchivo({ buffer, prefijo: 'pruebas' }),
    );
    expect(archivo).toMatchObject({
      mime: 'image/jpeg',
      bytes: buffer.length,
      ancho: 10,
      alto: 8,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      subidoPor: usuario.id,
    });
    expect(archivo.clave).toMatch(/^pruebas\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(await almacenamiento.existeObjeto(archivo.clave)).toBe(true);
  });

  test('acepta PNG, WebP y PDF; el tipo sale del contenido, no del nombre', async () => {
    expect(
      (await archivos.guardarArchivo({ buffer: await imagen('png'), prefijo: 'pruebas' })).mime,
    ).toBe('image/png');
    expect(
      (await archivos.guardarArchivo({ buffer: await imagen('webp'), prefijo: 'pruebas' })).mime,
    ).toBe('image/webp');
    const pdf = await archivos.guardarArchivo({ buffer: PDF, prefijo: 'pruebas' });
    expect([pdf.mime, pdf.ancho]).toEqual(['application/pdf', null]);
  });

  test('rechaza un ejecutable renombrado, una imagen dañada, un archivo vacío o de tipo no pedido', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(200)]);
    await expect(
      archivos.guardarArchivo({ buffer: exe, prefijo: 'pruebas' }),
    ).rejects.toMatchObject({
      status: 400,
      codigo: 'ARCHIVO_TIPO_NO_PERMITIDO',
    });
    const danado = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(50)]);
    await expect(
      archivos.guardarArchivo({ buffer: danado, prefijo: 'pruebas' }),
    ).rejects.toMatchObject({
      codigo: 'ARCHIVO_DANADO',
    });
    await expect(
      archivos.guardarArchivo({ buffer: Buffer.alloc(0), prefijo: 'pruebas' }),
    ).rejects.toMatchObject({
      codigo: 'VALIDACION',
    });
    await expect(
      archivos.guardarArchivo({ buffer: PDF, prefijo: 'pruebas', tipos: archivos.MIMES_IMAGEN }),
    ).rejects.toMatchObject({ codigo: 'ARCHIVO_TIPO_NO_PERMITIDO' });
    expect(await db.Archivo.count()).toBe(0);
  });

  test('rechaza archivos más grandes que el máximo (413)', async () => {
    const grande = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    await expect(
      archivos.guardarArchivo({ buffer: grande, prefijo: 'pruebas' }),
    ).rejects.toMatchObject({
      status: 413,
      codigo: 'ARCHIVO_DEMASIADO_GRANDE',
    });
  });

  test('urlFirmada registra el acceso y exige un usuario en el contexto', async () => {
    const usuario = await f.crearUsuario({ rol: 'coordinador' });
    const solicitud = await f.crearSolicitud();
    const archivo = await archivos.guardarArchivo({ buffer: await imagen(), prefijo: 'pruebas' });

    await expect(archivos.urlFirmada({ archivo, solicitudId: solicitud.id })).rejects.toThrow(
      /usuario autenticado/,
    );

    const firmada = await contexto.ejecutarCon(
      { usuario: { id: usuario.id, rol: 'coordinador' }, ip: '10.0.0.1' },
      () =>
        archivos.urlFirmada({
          archivoId: archivo.id,
          solicitudId: solicitud.id,
          recurso: 'documento',
        }),
    );
    expect(firmada.url).toContain(encodeURIComponent(archivo.clave));
    const segundos = (new Date(firmada.expiraEn) - Date.now()) / 1000;
    expect(segundos).toBeGreaterThan(290);
    expect(segundos).toBeLessThanOrEqual(300);
    const [registro] = await db.RegistroAcceso.findAll();
    expect(registro).toMatchObject({
      usuarioId: usuario.id,
      solicitudId: solicitud.id,
      recurso: 'documento',
      recursoId: archivo.id,
      ip: '10.0.0.1',
    });
  });

  test('subidaEnMemoria: multipart con los límites de la API y el contexto intacto', async () => {
    const router = Router();
    router.post('/subir', requiereAuth, ...archivos.subidaEnMemoria(), async (req, res) => {
      const archivo = await archivos.guardarArchivo({
        buffer: req.file.buffer,
        prefijo: 'pruebas',
      });
      res.status(201).json({ subidoPor: archivo.subidoPor, mime: archivo.mime });
    });
    const usuario = await f.crearUsuario();
    const token = await tokenPara(usuario);
    const cliente = appDePrueba(router);

    const ok = await cliente
      .post('/subir')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', await imagen(), 'foto.png')
      .expect(201);
    expect(ok.body).toEqual({ subidoPor: usuario.id, mime: 'image/jpeg' });

    const dos = await cliente
      .post('/subir')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', await imagen(), 'a.jpg')
      .attach('archivo', await imagen(), 'b.jpg')
      .expect(400);
    expect(dos.body.codigo).toBe('SUBIDA_INVALIDA');
  });
});
