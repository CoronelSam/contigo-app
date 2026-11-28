'use strict';

const { Router } = require('express');
const db = require('../../src/models');
const f = require('../factories');
const { limpiarBase } = require('../helpers/db');
const { tokenPara } = require('../helpers/auth');
const { appDePrueba } = require('../helpers/app');
const { requiereAuth } = require('../../src/core/auth');
const { idempotente } = require('../../src/core/http/idempotencia');
const { subidaEnMemoria } = require('../../src/core/archivos');
const { conflicto } = require('../../src/core/errores');

let ejecuciones = 0;
let liberar;
let avisarEntrada;

const router = Router();
const manejador = async (req, res) => {
  ejecuciones += 1;
  if (req.body.esperar) {
    avisarEntrada();
    await new Promise((r) => {
      liberar = r;
    });
  }
  if (req.body.fallar) throw conflicto('PRUEBA_FALLA', 'Falla de prueba');
  res.status(201).json({ n: ejecuciones, eco: req.body });
};
router.post('/idem', requiereAuth, idempotente(), manejador);
router.post('/idem-opcional', requiereAuth, idempotente({ obligatorio: false }), manejador);
router.post('/idem-otra', requiereAuth, idempotente(), manejador);
router.post(
  '/idem-archivo',
  requiereAuth,
  ...subidaEnMemoria({ campo: 'archivo' }),
  idempotente(),
  manejador,
);
// Mal ordenado a propósito: el multipart todavía no se leyó cuando llega a idempotente().
router.post(
  '/idem-antes-de-multer',
  requiereAuth,
  idempotente(),
  ...subidaEnMemoria({ campo: 'archivo' }),
  manejador,
);
const cliente = appDePrueba(router);

const CLAVE = '2f1d8c6e-4a7b-4c5d-9e8f-0a1b2c3d4e5f';

describe('Idempotency-Key', () => {
  let usuario;
  let token;

  beforeEach(async () => {
    await limpiarBase();
    ejecuciones = 0;
    usuario = await f.crearUsuario();
    token = await tokenPara(usuario);
  });

  const enviar = (cuerpo, { ruta = '/idem', clave = CLAVE, tk = token } = {}) => {
    const r = cliente.post(ruta).set('Authorization', `Bearer ${tk}`);
    if (clave) r.set('Idempotency-Key', clave);
    return r.send(cuerpo);
  };

  test('la misma clave y el mismo cuerpo devuelven la misma respuesta sin ejecutar de nuevo', async () => {
    const primera = await enviar({ a: 1, b: { c: 2 } }).expect(201);
    const segunda = await enviar({ b: { c: 2 }, a: 1 }).expect(201);
    expect(segunda.body).toEqual(primera.body);
    expect(segunda.headers['idempotency-replayed']).toBe('true');
    expect(ejecuciones).toBe(1);
  });

  test('la misma clave con otro cuerpo u otra ruta responde 422', async () => {
    await enviar({ a: 1 }).expect(201);
    const otroCuerpo = await enviar({ a: 2 }).expect(422);
    expect(otroCuerpo.body.codigo).toBe('IDEMPOTENCIA_CUERPO_DISTINTO');
    await enviar({ a: 1 }, { ruta: '/idem-otra' }).expect(422);
    expect(ejecuciones).toBe(1);
  });

  test('la clave es por usuario', async () => {
    await enviar({ a: 1 }).expect(201);
    const otro = await f.crearUsuario();
    await enviar({ a: 1 }, { tk: await tokenPara(otro) }).expect(201);
    expect(ejecuciones).toBe(2);
  });

  test('sin cabecera: 428 si es obligatoria; se ejecuta si es opcional. Clave inválida: 400', async () => {
    const sin = await enviar({ a: 1 }, { clave: null }).expect(428);
    expect(sin.body.codigo).toBe('PRECONDICION_REQUERIDA');
    await enviar({ a: 1 }, { ruta: '/idem-opcional', clave: null }).expect(201);
    const invalida = await enviar({ a: 1 }, { clave: 'no-es-uuid' }).expect(400);
    expect(invalida.body.campos).toEqual({ 'Idempotency-Key': 'FORMATO_INVALIDO' });
  });

  test('una respuesta de error no se guarda: el reintento se ejecuta otra vez', async () => {
    await enviar({ fallar: true }).expect(409);
    await enviar({ fallar: true }).expect(409);
    expect(ejecuciones).toBe(2);
    expect(await db.ClaveIdempotencia.count()).toBe(0);
  });

  test('mientras la primera sigue en curso, la segunda responde 409', async () => {
    const entro = new Promise((r) => {
      avisarEntrada = r;
    });
    const primera = enviar({ esperar: true });
    const respuestaPrimera = primera.then((r) => r);
    await entro;
    const segunda = await enviar({ esperar: true }).expect(409);
    expect(segunda.body.codigo).toBe('IDEMPOTENCIA_EN_PROCESO');
    liberar();
    expect((await respuestaPrimera).status).toBe(201);
    expect(ejecuciones).toBe(1);
  });

  describe('con adjuntos (multipart)', () => {
    const subir = (archivo, { ruta = '/idem-archivo', nota = 'ficticia' } = {}) => {
      const r = cliente
        .post(ruta)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', CLAVE)
        .field('nota', nota);
      return archivo ? r.attach('archivo', Buffer.from(archivo), 'adjunto.bin') : r;
    };

    test('mismo formulario y mismo archivo: devuelve la respuesta guardada', async () => {
      const primera = await subir('contenido ficticio A').expect(201);
      const segunda = await subir('contenido ficticio A').expect(201);
      expect(segunda.headers['idempotency-replayed']).toBe('true');
      expect(segunda.body).toEqual(primera.body);
      expect(ejecuciones).toBe(1);
    });

    test('otro archivo, sin archivo u otro campo con la misma clave → 422', async () => {
      await subir('contenido ficticio A').expect(201);
      for (const intento of [
        subir('contenido ficticio B'),
        subir(null),
        subir('contenido ficticio A', { nota: 'otra' }),
      ]) {
        expect((await intento.expect(422)).body.codigo).toBe('IDEMPOTENCIA_CUERPO_DISTINTO');
      }
      expect(ejecuciones).toBe(1);
    });

    test('antes de leer el multipart no compara un cuerpo vacío: responde 400', async () => {
      const res = await subir('contenido ficticio A', { ruta: '/idem-antes-de-multer' }).expect(
        400,
      );
      expect(res.body.campos).toEqual({ 'Content-Type': 'NO_SOPORTADO' });
      expect(ejecuciones).toBe(0);
      expect(await db.ClaveIdempotencia.count()).toBe(0);
    });
  });

  test('una clave vencida se puede reutilizar', async () => {
    await enviar({ a: 1 }).expect(201);
    await db.ClaveIdempotencia.update(
      { expiraEn: new Date(Date.now() - 1000) },
      { where: { clave: CLAVE } },
    );
    await enviar({ a: 9 }).expect(201);
    expect(ejecuciones).toBe(2);
  });
});
