'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const cola = require('../../../core/cola');
const eventos = require('../../../core/eventos');
const solicitudes = require('../../solicitudes/contratos');
const { extraccionProcesada } = require('./ayudantes');

let ctx;
let tv;
let coordinador;

beforeEach(async () => {
  await limpiarBase();
  cola.vaciar();
  ctx = await extraccionProcesada();
  tv = await tokenPara(ctx.voluntario);
  coordinador = await f.crearUsuario({ rol: 'coordinador' });
});

afterEach(async () => {
  await eventos.esperarEventos();
  jest.restoreAllMocks();
});

const ruta = (sufijo = '') => `/api/v1/extracciones/${ctx.extraccion.id}${sufijo}`;
const con = (req, t = tv) => req.set('Authorization', `Bearer ${t}`);
const revisar = (campo, cuerpo, t = tv) =>
  con(api().patch(ruta(`/campos/${ctx.campo(campo).id}`)), t).send(cuerpo);
const confirmarTodo = async () => {
  for (const c of ctx.campos) await revisar(c.campo, { confirmar: true }).expect(200);
};

describe('GET /extracciones/:id', () => {
  test('campos con su confianza, dudosos según el umbral, páginas y acceso registrado', async () => {
    const res = await con(api().get(ruta())).expect(200);
    expect(res.body).toMatchObject({
      estado: 'por_confirmar',
      progreso: 100,
      umbralConfianza: 0.8,
      paginas: [{ numero: 1 }, { numero: 2 }],
    });
    expect(res.body.campos.map((c) => [c.campo, c.dudoso])).toEqual([
      ['diagnostico', false],
      ['fecha_inicio', true],
      ['peso_nacer', true],
      ['tipo_parto_vaginal', false],
      ['tipo_parto_cesarea', false],
      ['tipo_parto_no_se', false],
    ]);
    expect(res.body.campos[1]).toMatchObject({ tipo: 'fecha', formato: 'DD/MM/AAAA' });
    expect(res.body.campos[4]).toMatchObject({ grupo: 'tipo_parto', valorCasilla: 'cesarea' });
    expect(await db.RegistroAcceso.findOne()).toMatchObject({
      usuarioId: ctx.voluntario.id,
      recurso: 'documento',
      recursoId: ctx.documento.id,
    });

    // Con otro umbral cambia qué es dudoso.
    await db.Configuracion.update({ valor: 0.6 }, { where: { clave: 'ocr.umbral_confianza' } });
    const otro = await con(api().get(ruta())).expect(200);
    expect(otro.body.campos.filter((c) => c.dudoso)).toEqual([]);
  });

  test('voluntario sin asignación 404, familia 403, coordinador sí', async () => {
    await con(
      api().get(ruta()),
      await tokenPara(await f.crearUsuario({ rol: 'voluntario' })),
    ).expect(404);
    await con(api().get(ruta()), await tokenPara(ctx.familia.usuario)).expect(403);
    await con(api().get(ruta()), await tokenPara(coordinador)).expect(200);
    await api().get(ruta()).expect(401);
  });
});

describe('revisar campos', () => {
  test('corregir valida la fecha y guarda el revisor; confirmar normaliza el valor leído', async () => {
    const mala = await revisar('fecha_inicio', { valor: '31/02/2020' }).expect(400);
    expect(mala.body.campos).toEqual({ valor: 'FECHA_INVALIDA' });

    const corregida = await revisar('fecha_inicio', { valor: '15-03-2019' }).expect(200);
    expect(corregida.body).toMatchObject({ estado: 'corregido', valorFinal: '2019-03-15' });
    const fila = await db.CampoExtraido.findByPk(ctx.campo('fecha_inicio').id);
    expect(fila).toMatchObject({ revisadoPor: ctx.voluntario.id });
    expect(fila.revisadoEn).toBeInstanceOf(Date);

    const igual = await revisar('diagnostico', { valor: ' Diagnóstico ficticio ' }).expect(200);
    expect(igual.body.estado).toBe('confirmado');
    const peso = await revisar('peso_nacer', { confirmar: true }).expect(200);
    expect(peso.body).toMatchObject({ estado: 'confirmado', valorFinal: '3.2' });
    expect((await revisar('peso_nacer', { valor: 'tres' }).expect(400)).body.campos).toEqual({
      valor: 'NUMERO_INVALIDO',
    });
    const ambos = await revisar('peso_nacer', { valor: '3', confirmar: true }).expect(400);
    expect(ambos.body.campos).toEqual({ cuerpo: 'VALOR_O_CONFIRMAR' });
  });

  test('casillas excluyentes: no se marca una segunda en el mismo grupo', async () => {
    const segunda = await revisar('tipo_parto_vaginal', { valor: true }).expect(400);
    expect(segunda.body.campos).toEqual({
      [ctx.campo('tipo_parto_vaginal').id]: 'CASILLAS_EXCLUYENTES',
      [ctx.campo('tipo_parto_cesarea').id]: 'CASILLAS_EXCLUYENTES',
    });
    await revisar('tipo_parto_cesarea', { valor: false }).expect(200);
    const res = await revisar('tipo_parto_vaginal', { valor: true }).expect(200);
    expect(res.body).toMatchObject({ estado: 'corregido', valorFinal: 'true' });
    await revisar('tipo_parto_no_se', { valor: 'tal vez' }).expect(400);
  });

  test('en bloque solo los no dudosos; con un dudoso no confirma ninguno', async () => {
    const confiables = ['diagnostico', 'tipo_parto_vaginal', 'tipo_parto_cesarea'].map(
      (n) => ctx.campo(n).id,
    );
    const conDudoso = await con(api().post(ruta('/campos/confirmar')))
      .send({ campoIds: [...confiables, ctx.campo('fecha_inicio').id] })
      .expect(409);
    expect(conDudoso.body).toMatchObject({
      codigo: 'OCR_CAMPO_DUDOSO_EN_BLOQUE',
      campos: { [ctx.campo('fecha_inicio').id]: 'DUDOSO' },
    });
    expect(await db.CampoExtraido.count({ where: { estado: 'propuesto' } })).toBe(6);

    const ok = await con(api().post(ruta('/campos/confirmar')))
      .send({ campoIds: confiables })
      .expect(200);
    const estados = Object.fromEntries(ok.body.campos.map((c) => [c.campo, c.estado]));
    expect(estados).toEqual({
      diagnostico: 'confirmado',
      fecha_inicio: 'propuesto',
      peso_nacer: 'propuesto',
      tipo_parto_vaginal: 'confirmado',
      tipo_parto_cesarea: 'confirmado',
      tipo_parto_no_se: 'propuesto',
    });
  });

  test('solo se revisan extracciones por confirmar', async () => {
    await ctx.extraccion.update({ estado: 'confirmada' });
    const res = await revisar('diagnostico', { confirmar: true }).expect(409);
    expect(res.body.codigo).toBe('OCR_EXTRACCION_NO_EDITABLE');
  });
});

describe('POST /extracciones/:id/confirmar', () => {
  test('con campos sin verificar → 409 con la lista', async () => {
    await revisar('diagnostico', { confirmar: true }).expect(200);
    const res = await con(api().post(ruta('/confirmar'))).expect(409);
    expect(res.body.codigo).toBe('OCR_CAMPOS_SIN_VERIFICAR');
    expect(Object.keys(res.body.campos)).toHaveLength(5);
  });

  test('pasa los valores a las secciones, avisa al coordinador y el documento sigue capturado', async () => {
    const fusion = jest.spyOn(solicitudes, 'fusionarValoresOcr');
    const confirmadas = [];
    const quitar = eventos.suscribir(eventos.EVENTOS.EXTRACCION_CONFIRMADA, (d) =>
      confirmadas.push(d),
    );
    await confirmarTodo();
    await revisar('fecha_inicio', { valor: '15/03/2019' }).expect(200);
    try {
      const res = await con(api().post(ruta('/confirmar'))).expect(200);
      expect(res.body).toMatchObject({ estado: 'confirmada', revisadoEn: expect.any(String) });
      await eventos.esperarEventos();
    } finally {
      quitar();
    }

    expect(fusion.mock.calls.map(([p]) => [p.seccion, p.valores])).toEqual([
      [
        'informacion_medica',
        [
          { rutaDato: '/diagnostico', valor: 'Diagnóstico ficticio' },
          { rutaDato: '/fechaInicio', valor: '2019-03-15' },
        ],
      ],
      [
        'embarazo_nacimiento',
        [
          { rutaDato: '/pesoNacerKg', valor: 3.2 },
          { rutaDato: '/tipoParto', valor: 'cesarea' },
        ],
      ],
    ]);
    const secciones = await db.SolicitudSeccion.findAll({ order: [['seccion', 'ASC']] });
    expect(secciones.map((s) => [s.seccion, s.origen, s.datos])).toEqual([
      ['embarazo_nacimiento', 'ocr', { pesoNacerKg: 3.2, tipoParto: 'cesarea' }],
      [
        'informacion_medica',
        'ocr',
        { diagnostico: 'Diagnóstico ficticio', fechaInicio: '2019-03-15' },
      ],
    ]);

    expect(await ctx.extraccion.reload()).toMatchObject({ revisadoPor: ctx.voluntario.id });
    expect((await ctx.documento.reload()).estado).toBe('CAPTURADO');
    const aviso = await db.Notificacion.findOne({ where: { usuarioId: coordinador.id } });
    expect(aviso.tipo).toBe('REVISION_OCR_LISTA');
    expect(confirmadas).toEqual([expect.objectContaining({ documentoId: ctx.documento.id })]);
    expect(
      await db.Bitacora.findOne({ where: { accion: 'ocr.confirmar_revision' } }),
    ).toMatchObject({
      despues: expect.objectContaining({ campos: 6, corregidos: 1 }),
    });
  });

  test('si el formulario rechaza un valor, nada queda confirmado', async () => {
    await confirmarTodo();
    await revisar('fecha_inicio', { valor: '01/01/2999' }).expect(200);
    const res = await con(api().post(ruta('/confirmar'))).expect(400);
    expect(res.body.campos).toEqual({ [ctx.campo('fecha_inicio').id]: 'FECHA_FUTURA' });
    expect((await ctx.extraccion.reload()).estado).toBe('por_confirmar');
    expect(await db.SolicitudSeccion.count()).toBe(0);
    expect(await db.Notificacion.count()).toBe(0);
  });

  test('2 casillas marcadas en un grupo → 409 al confirmar', async () => {
    await confirmarTodo();
    // Estado inconsistente que no se puede lograr por la API (por ejemplo, datos viejos).
    await db.CampoExtraido.update(
      { valorFinal: 'true' },
      { where: { id: ctx.campo('tipo_parto_no_se').id } },
    );
    const res = await con(api().post(ruta('/confirmar'))).expect(409);
    expect(res.body.codigo).toBe('OCR_CASILLAS_EXCLUYENTES');
  });

  test('el coordinador también confirma; la familia no', async () => {
    await confirmarTodo();
    await con(api().post(ruta('/confirmar')), await tokenPara(ctx.familia.usuario)).expect(403);
    await con(api().post(ruta('/confirmar')), await tokenPara(coordinador)).expect(200);
  });
});
