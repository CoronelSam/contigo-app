'use strict';

const crypto = require('node:crypto');
const sharp = require('sharp');
const db = require('../../../models');
const f = require('../../../../test/factories');
const cola = require('../../../core/cola');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

let coord;
let tc;
let familia;
let tf;
let solicitud;

beforeEach(async () => {
  await limpiarBase();
  cola.vaciar();
  coord = await f.crearUsuario({
    rol: 'coordinador',
    nombres: 'Coordinadora',
    apellidos: 'Ficticia',
  });
  tc = await tokenPara(coord);
  familia = await f.crearFamilia();
  tf = await tokenPara(familia.usuario);
  solicitud = await f.crearSolicitud({ paciente: familia.paciente, estado: 'EN_REVISION' });
});

const con = (req, token) => req.set('Authorization', `Bearer ${token}`);
const ruta = (s = solicitud, sufijo = '') => `/api/v1/solicitudes/${s.id}/mensajes${sufijo}`;
const escribir = (token, cuerpo, s = solicitud) => con(api().post(ruta(s)), token).send(cuerpo);
const leer = (token, q = '', s = solicitud) => con(api().get(`${ruta(s)}${q}`), token);
const marcar = (token, hastaId, s = solicitud) =>
  con(api().post(ruta(s, '/leidos')), token).send({ hastaId });
const png = () =>
  sharp({ create: { width: 20, height: 20, channels: 3, background: '#cfd8dc' } })
    .png()
    .toBuffer();

/** Avisos MENSAJE_NUEVO por usuario. */
const avisos = async () =>
  (await db.Notificacion.findAll({ where: { tipo: 'MENSAJE_NUEVO' } })).map((n) => n.usuarioId);

describe('POST y GET /solicitudes/:id/mensajes', () => {
  test('la familia ve al personal como "Equipo Vanguardia"; el coordinador ve su nombre', async () => {
    const deFamilia = await escribir(tf, { cuerpo: '  Pregunta ficticia de la familia  ' }).expect(
      201,
    );
    expect(deFamilia.body).toEqual({
      id: expect.any(String),
      autor: { tipo: 'familia', id: familia.usuario.id, nombre: expect.any(String) },
      cuerpo: 'Pregunta ficticia de la familia',
      archivo: null,
      creadoEn: expect.any(String),
      leidoEn: null,
      esMio: true,
    });
    await escribir(tc, { cuerpo: 'Respuesta ficticia del equipo' }).expect(201);

    const vistaFamilia = await leer(tf).expect(200);
    expect(vistaFamilia.headers['cache-control']).toBe('no-store');
    expect(vistaFamilia.body.datos.map((m) => m.cuerpo)).toEqual([
      'Respuesta ficticia del equipo',
      'Pregunta ficticia de la familia',
    ]);
    expect(vistaFamilia.body.datos[0]).toMatchObject({ esMio: false });
    expect(vistaFamilia.body.datos[0].autor).toEqual({
      tipo: 'equipo',
      etiqueta: 'Coordinador del caso / Equipo Vanguardia',
    });
    expect(vistaFamilia.body).toMatchObject({ siguiente: null, noLeidos: 1 });

    const vistaCoordinador = await leer(tc).expect(200);
    expect(vistaCoordinador.body.datos[0].autor).toEqual({
      tipo: 'equipo',
      id: coord.id,
      nombre: 'Coordinadora Ficticia',
    });
    expect(vistaCoordinador.body.datos[1]).toMatchObject({
      autor: { tipo: 'familia' },
      esMio: false,
    });
    expect(vistaCoordinador.body.noLeidos).toBe(1);

    // En inglés para una familia que usa la app en inglés.
    await familia.usuario.update({ idioma: 'en' });
    const enIngles = await leer(await tokenPara(familia.usuario)).expect(200);
    expect(enIngles.body.datos[0].autor).toEqual({
      tipo: 'equipo',
      etiqueta: 'Case coordinator / Vanguardia Team',
    });
  });

  test('MENSAJE_NUEVO: la familia avisa al coordinador del caso (o a todos); el personal, a la familia', async () => {
    const otroCoord = await f.crearUsuario({ rol: 'coordinador' });
    await escribir(tf, { cuerpo: 'Primera pregunta ficticia' }).expect(201);
    expect((await avisos()).sort()).toEqual([coord.id, otroCoord.id].sort());

    await db.Notificacion.destroy({ where: {} });
    await solicitud.update({ coordinadorId: otroCoord.id });
    await escribir(tf, { cuerpo: 'Segunda pregunta ficticia' }).expect(201);
    expect(await avisos()).toEqual([otroCoord.id]);

    await db.Notificacion.destroy({ where: {} });
    await escribir(tc, { cuerpo: 'Respuesta con datos ficticios' }).expect(201);
    expect(await avisos()).toEqual([familia.usuario.id]);
    const [aviso] = await db.Notificacion.findAll({ where: { tipo: 'MENSAJE_NUEVO' } });
    expect(aviso.cuerpo).toContain(solicitud.codigo);
    expect(aviso.cuerpo).not.toContain('datos ficticios'); // nunca el cuerpo del mensaje
    expect(aviso.datos.enlace).toBe(`solicitudes/${solicitud.id}/mensajes`);
    expect(cola.pendientes().map((t) => t.nombre)).toContain('notificacion.push');
  });

  test('la bitácora registra que hubo un mensaje, sin su cuerpo', async () => {
    const res = await escribir(tf, { cuerpo: 'Texto privado ficticio' }).expect(201);
    const [entrada] = await db.Bitacora.findAll({ where: { accion: 'mensaje.enviar' } });
    expect(entrada).toMatchObject({
      entidad: 'mensajes',
      entidadId: res.body.id,
      solicitudId: solicitud.id,
      despues: { conTexto: true, conAdjunto: false },
    });
    expect(JSON.stringify(entrada.toJSON())).not.toContain('Texto privado');
  });

  test('adjuntos: imagen o PDF con o sin texto; tipo no permitido → 400', async () => {
    const conTexto = await con(api().post(ruta()), tf)
      .field('cuerpo', 'Foto ficticia adjunta')
      .attach('archivo', await png(), 'foto.png')
      .expect(201);
    expect(conTexto.body.archivo).toEqual({ id: expect.any(String), mime: 'image/png' });
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n',
    );
    const soloArchivo = await con(api().post(ruta()), tc)
      .attach('archivo', pdf, 'informe.pdf')
      .expect(201);
    expect(soloArchivo.body).toMatchObject({ cuerpo: null, archivo: { mime: 'application/pdf' } });
    expect((await db.Archivo.findByPk(conTexto.body.archivo.id)).clave).toMatch(/^mensajes\//);

    // El adjunto se abre con GET /archivos/:id/url solo si se participa en el caso.
    const url = `/api/v1/archivos/${conTexto.body.archivo.id}/url`;
    await con(api().get(url), tc).expect(200);
    const ajena = await f.crearFamilia();
    await con(api().get(url), await tokenPara(ajena.usuario)).expect(404);

    const exe = Buffer.from('MZ\x90\x00 no es una imagen', 'latin1');
    const invalido = await con(api().post(ruta()), tf).attach('archivo', exe, 'x.png').expect(400);
    expect(invalido.body.codigo).toBe('ARCHIVO_TIPO_NO_PERMITIDO');
    expect(await db.Mensaje.count()).toBe(2);
  });

  test('vacío, demasiado largo o con campos de más → 400', async () => {
    expect((await escribir(tf, {}).expect(400)).body.campos).toEqual({ cuerpo: 'REQUERIDO' });
    expect((await escribir(tf, { cuerpo: '   ' }).expect(400)).body.campos).toEqual({
      cuerpo: 'REQUERIDO',
    });
    expect((await escribir(tf, { cuerpo: 'x'.repeat(4001) }).expect(400)).body.campos).toEqual({
      cuerpo: 'MUY_LARGO',
    });
    await escribir(tf, { cuerpo: 'x'.repeat(4000) }).expect(201);
    expect(
      (await escribir(tf, { cuerpo: 'Hola', autorId: coord.id }).expect(400)).body.campos,
    ).toEqual({ autorId: 'CAMPO_NO_PERMITIDO' });
  });

  test('Idempotency-Key: el reintento no duplica; otro cuerpo con la misma clave → 422', async () => {
    const clave = crypto.randomUUID();
    const enviar = (cuerpo) =>
      con(api().post(ruta()), tf).set('Idempotency-Key', clave).send({ cuerpo });
    const primero = await enviar('Mensaje ficticio único').expect(201);
    const repetido = await enviar('Mensaje ficticio único').expect(201);
    expect(repetido.headers['idempotency-replayed']).toBe('true');
    expect(repetido.body.id).toBe(primero.body.id);
    expect(await db.Mensaje.count()).toBe(1);
    expect((await avisos()).length).toBe(1);
    await enviar('Otro texto ficticio').expect(422);
  });

  test('Idempotency-Key con adjunto: el mismo archivo se repite; otro archivo con la misma clave → 422', async () => {
    const clave = crypto.randomUUID();
    const pdf = Buffer.from('%PDF-1.4\n% ficticio\n');
    const enviar = (archivo, nombre) =>
      con(api().post(ruta()), tf)
        .set('Idempotency-Key', clave)
        .field('cuerpo', 'Adjunto ficticio')
        .attach('archivo', archivo, nombre);
    const primero = await enviar(await png(), 'foto.png').expect(201);
    const repetido = await enviar(await png(), 'foto.png').expect(201);
    expect(repetido.headers['idempotency-replayed']).toBe('true');
    expect(repetido.body.id).toBe(primero.body.id);
    const otro = await enviar(pdf, 'informe.pdf').expect(422);
    expect(otro.body.codigo).toBe('IDEMPOTENCIA_CUERPO_DISTINTO');
    expect(await db.Mensaje.count()).toBe(1);
    expect(await db.Archivo.count()).toBe(1);
  });

  test('paginación con el cursor antesDe, sin repetir ni saltar mensajes', async () => {
    const base = Date.now() - 60_000;
    const creados = [];
    for (const [i, segundos] of [0, 1, 2, 2, 3].entries()) {
      creados.push(
        await f.crearMensaje({
          solicitud,
          autor: coord,
          cuerpo: `Mensaje ficticio ${i}`,
          createdAt: new Date(base + segundos * 1000),
        }),
      );
    }
    const vistos = [];
    let cursor = null;
    let paginas = 0;
    do {
      const q = `?limit=2${cursor ? `&antesDe=${cursor}` : ''}`;
      const { body } = await leer(tf, q).expect(200);
      expect(body.datos.length).toBeLessThanOrEqual(2);
      vistos.push(...body.datos.map((m) => m.id));
      cursor = body.siguiente;
      paginas += 1;
    } while (cursor);
    expect(paginas).toBe(3);
    expect(new Set(vistos).size).toBe(5);
    expect(vistos[0]).toBe(creados[4].id); // el más reciente primero
    expect(vistos.at(-1)).toBe(creados[0].id);

    const otra = await f.crearSolicitud({ estado: 'EN_REVISION' });
    const ajeno = await f.crearMensaje({ solicitud: otra, autor: coord });
    expect((await leer(tf, `?antesDe=${ajeno.id}`).expect(400)).body.campos).toEqual({
      antesDe: 'NO_PERTENECE_AL_CASO',
    });
  });
});

describe('POST /solicitudes/:id/mensajes/leidos', () => {
  test('solo marca los mensajes de la otra parte, hasta el indicado', async () => {
    const base = Date.now() - 60_000;
    const crear = (autor, i) =>
      f.crearMensaje({ solicitud, autor, createdAt: new Date(base + i * 1000) });
    const c1 = await crear(coord, 1);
    const f1 = await crear(familia.usuario, 2);
    const c2 = await crear(coord, 3);
    const c3 = await crear(coord, 4);

    expect((await marcar(tf, c2.id).expect(200)).body).toEqual({ marcados: 2, noLeidos: 1 });
    const leidos = async (m) => (await m.reload()).leidoEn;
    expect(await leidos(c1)).toBeInstanceOf(Date);
    expect(await leidos(c2)).toBeInstanceOf(Date);
    expect(await leidos(f1)).toBeNull(); // propio de la familia: no cambia
    expect(await leidos(c3)).toBeNull(); // posterior al indicado

    // El coordinador marca hasta el último: solo cambia el de la familia.
    expect((await marcar(tc, c3.id).expect(200)).body).toEqual({ marcados: 1, noLeidos: 0 });
    expect(await leidos(f1)).toBeInstanceOf(Date);
    expect(await leidos(c3)).toBeNull();
    expect((await marcar(tc, c3.id).expect(200)).body.marcados).toBe(0);

    const vista = (await leer(tf).expect(200)).body.datos;
    expect(vista.find((m) => m.id === f1.id).leidoEn).toEqual(expect.any(String)); // confirmación de lectura

    const otra = await f.crearSolicitud({ estado: 'EN_REVISION' });
    const ajeno = await f.crearMensaje({ solicitud: otra, autor: coord });
    expect((await marcar(tf, ajeno.id).expect(400)).body.campos).toEqual({
      hastaId: 'NO_PERTENECE_AL_CASO',
    });
    expect(
      (
        await con(api().post(ruta(solicitud, '/leidos')), tf)
          .send({})
          .expect(400)
      ).body.campos,
    ).toEqual({ hastaId: 'REQUERIDO' });
  });
});

describe('acceso al chat', () => {
  test('familia ajena → 404; voluntario y administrador → 403; sin token → 401', async () => {
    const mensaje = await f.crearMensaje({ solicitud, autor: coord });
    const ajena = await f.crearFamilia();
    const ta = await tokenPara(ajena.usuario);
    await leer(ta).expect(404);
    await escribir(ta, { cuerpo: 'Intento ficticio' }).expect(404);
    await marcar(ta, mensaje.id).expect(404);
    await leer(tf, '', { id: crypto.randomUUID() }).expect(404);

    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud, voluntario });
    const admin = await f.crearUsuario({ rol: 'administrador' });
    for (const t of [await tokenPara(voluntario), await tokenPara(admin)]) {
      expect((await leer(t).expect(403)).body.codigo).toBe('SIN_PERMISO');
      await escribir(t, { cuerpo: 'Intento ficticio' }).expect(403);
      await marcar(t, mensaje.id).expect(403);
    }
    await leer('token-invalido').expect(401);
    expect(await db.Mensaje.count()).toBe(1);
  });
});
