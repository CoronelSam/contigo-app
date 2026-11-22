'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const eventos = require('../../../core/eventos');
const { fusionarValoresOcr } = require('../contratos');
const { validarSeccion } = require('../esquemas');
const { COMPLETAS, conToken, familiaConSolicitud } = require('./ayudantes');

const ruta = (solicitud, seccion = 'informacion_medica') =>
  `/api/v1/solicitudes/${solicitud.id}/secciones/${seccion}`;

describe('secciones del formulario', () => {
  let ctx;

  beforeEach(async () => {
    await limpiarBase();
    ctx = await familiaConSolicitud();
  });

  const leer = (seccion, t = ctx.token) => conToken(api().get(ruta(ctx.solicitud, seccion)), t);
  const guardar = (seccion, datos, { version, t = ctx.token, idioma } = {}) => {
    const req = conToken(api().put(ruta(ctx.solicitud, seccion)), t);
    if (version !== undefined) req.set('If-Match', `"v${version}"`);
    return req.send({ datos, ...(idioma ? { idioma } : {}) });
  };

  test('una sección nunca guardada viene vacía, con versión 0 y ETag "v0"', async () => {
    const res = await leer('embarazo_nacimiento').expect(200);
    expect(res.headers.etag).toBe('"v0"');
    expect(res.body).toMatchObject({
      seccion: 'embarazo_nacimiento',
      datos: {},
      estado: 'vacia',
      version: 0,
      idioma: 'es',
      origen: null,
      versionPlantilla: 'v1',
    });
    expect(res.body.pendientes).toContain('cuidadosPrenatales');
  });

  test('guarda un borrador parcial y solo queda completa con los obligatorios', async () => {
    const parcial = await guardar('informacion_medica', {
      diagnostico: '  Diagnóstico ficticio  ',
      tratamientosPrevios: '',
    }).expect(200);
    expect(parcial.headers.etag).toBe('"v1"');
    expect(parcial.body).toMatchObject({
      datos: { diagnostico: 'Diagnóstico ficticio' },
      estado: 'incompleta',
      version: 1,
      origen: 'app',
      pendientes: ['fechaInicio', 'atencionSolicitada'],
    });

    const completa = await guardar('informacion_medica', COMPLETAS.informacion_medica, {
      version: 1,
      idioma: 'en',
    }).expect(200);
    expect(completa.body).toMatchObject({ estado: 'completa', version: 2, idioma: 'en' });
    expect(completa.body.pendientes).toEqual([]);

    const vacia = await guardar('informacion_medica', {}, { version: 2 }).expect(200);
    expect(vacia.body).toMatchObject({ estado: 'vacia', version: 3 });

    const fila = await db.SolicitudSeccion.findOne({ where: { solicitudId: ctx.solicitud.id } });
    expect(fila.actualizadoPor).toBe(ctx.usuario.id);
  });

  test('el campo condicional se exige solo cuando aplica', async () => {
    const res = await guardar('antecedentes_medicos', {
      ...COMPLETAS.antecedentes_medicos,
      transfusiones: 'si',
    }).expect(200);
    expect(res.body).toMatchObject({ estado: 'incompleta', pendientes: ['transfusionesDetalle'] });
  });

  test.each([
    [
      'antecedentes_medicos',
      { transfusiones: 'no', transfusionesDetalle: 'x' },
      'transfusionesDetalle',
    ],
    ['educacion', { gradoEscolar: 'no_aplica', asisteEscuela: 'si' }, 'asisteEscuela'],
    ['medicamentos_alergias', { alergias: 'no', alergiasReaccion: 'x' }, 'alergiasReaccion'],
    ['embarazo_nacimiento', { ucin: 'no', ucinDetalle: 'x' }, 'ucinDetalle'],
  ])('rechaza una respuesta contradictoria en %s', async (seccion, datos, campo) => {
    const res = await guardar(seccion, datos).expect(400);
    expect(res.body.campos).toEqual({ [`datos.${campo}`]: 'NO_APLICA' });
    expect(await db.SolicitudSeccion.count()).toBe(0);
  });

  test('valida catálogos, tipos, fechas y campos desconocidos', async () => {
    const res = await guardar('informacion_medica', {
      atencionSolicitada: 'tratamiento_inexistente',
      fechaInicio: '2999-01',
      cirugias: [{ procedimiento: 1 }],
      inventado: true,
    }).expect(400);
    expect(res.body.campos).toEqual({
      'datos.atencionSolicitada': 'VALOR_NO_PERMITIDO',
      'datos.fechaInicio': 'FECHA_FUTURA',
      'datos.cirugias.0.procedimiento': 'TIPO_INVALIDO',
      'datos.inventado': 'CAMPO_NO_PERMITIDO',
    });

    // Un ítem desactivado del catálogo ya no se acepta.
    await db.CatalogoItem.update(
      { activo: false },
      { where: { tipo: 'tipo_atencion', codigo: 'pie_zambo' } },
    );
    const inactivo = await guardar('informacion_medica', COMPLETAS.informacion_medica).expect(400);
    expect(inactivo.body.campos).toEqual({ 'datos.atencionSolicitada': 'VALOR_NO_PERMITIDO' });
  });

  test('If-Match: 428 si falta, 412 con la versión actual si no coincide', async () => {
    await guardar('educacion', { gradoEscolar: 'basica_1' }).expect(200);
    const sinIfMatch = await guardar('educacion', { gradoEscolar: 'basica_2' }).expect(428);
    expect(sinIfMatch.body.codigo).toBe('PRECONDICION_REQUERIDA');

    const viejo = await guardar('educacion', { gradoEscolar: 'basica_2' }, { version: 0 }).expect(
      412,
    );
    expect(viejo.body).toMatchObject({ codigo: 'SECCION_VERSION_CONFLICTO', versionActual: 1 });
    expect(viejo.headers.etag).toBe('"v1"');

    const malo = await conToken(api().put(ruta(ctx.solicitud, 'educacion')), ctx.token)
      .set('If-Match', 'v1')
      .send({ datos: {} })
      .expect(400);
    expect(malo.body.campos).toEqual({ 'If-Match': 'FORMATO_INVALIDO' });

    await guardar('educacion', { gradoEscolar: 'basica_2' }, { version: 1 }).expect(200);
    const leida = await leer('educacion').expect(200);
    expect(leida.headers.etag).toBe('"v2"');
    await leer('educacion').set('If-None-Match', '"v2"').expect(304);
  });

  test('2 guardados simultáneos sobre la misma versión: uno gana, el otro recibe 412', async () => {
    const [a, b] = await Promise.all([
      guardar('educacion', { gradoEscolar: 'basica_1' }, { version: 0 }),
      guardar('educacion', { gradoEscolar: 'basica_2' }, { version: 0 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 412]);
    expect((await db.SolicitudSeccion.findOne()).version).toBe(1);
  });

  test('sección desconocida o sin formulario → 404', async () => {
    expect((await leer('seccion_inventada')).body.codigo).toBe('SECCION_NO_ENCONTRADA');
    await leer('profesional_salud').expect(404);
    await guardar('consentimientos', {}).expect(404);
    await leer('Mayusculas').expect(400);
  });

  test('acceso: familia ajena 404, voluntario sin asignación 404, administrador 403', async () => {
    const ajena = await tokenPara(await f.crearUsuario());
    await leer('educacion', ajena).expect(404);
    await guardar('educacion', {}, { t: ajena }).expect(404);
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await leer('educacion', await tokenPara(voluntario)).expect(404);
    const admin = await tokenPara(await f.crearUsuario({ rol: 'administrador' }));
    await leer('educacion', admin).expect(403);
    await api().get(ruta(ctx.solicitud)).expect(401);
  });

  test('la familia queda bloqueada en EN_REVISION, salvo la sección con corrección abierta', async () => {
    await db.Solicitud.update({ estado: 'EN_REVISION' }, { where: { id: ctx.solicitud.id } });
    const bloqueada = await guardar('educacion', { gradoEscolar: 'basica_1' }).expect(409);
    expect(bloqueada.body.codigo).toBe('SOLICITUD_EDICION_BLOQUEADA');

    await db.Solicitud.update({ estado: 'INFO_ADICIONAL' }, { where: { id: ctx.solicitud.id } });
    await f.crearCorreccion({ solicitud: ctx.solicitud, seccion: 'educacion' });
    await guardar('educacion', { gradoEscolar: 'basica_1' }).expect(200);
    await guardar('informacion_medica', { diagnostico: 'x' }).expect(409);
  });

  test('el voluntario asignado y el coordinador editan en revisión; su lectura queda registrada', async () => {
    await db.Solicitud.update({ estado: 'EN_REVISION' }, { where: { id: ctx.solicitud.id } });
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud: ctx.solicitud, voluntario });
    const tv = await tokenPara(voluntario);
    await guardar('educacion', { gradoEscolar: 'basica_1' }, { t: tv }).expect(200);
    await leer('educacion', tv).expect(200);

    const coordinador = await tokenPara(await f.crearUsuario({ rol: 'coordinador' }));
    await guardar('educacion', { gradoEscolar: 'basica_3' }, { t: coordinador, version: 1 }).expect(
      200,
    );
    expect(await db.RegistroAcceso.count({ where: { recurso: 'expediente' } })).toBe(1);
  });

  test('cada guardado emite seccion.guardada y la bitácora no copia los datos médicos', async () => {
    const recibidos = [];
    const cancelar = eventos.suscribir(eventos.EVENTOS.SECCION_GUARDADA, (d) => recibidos.push(d));
    try {
      await guardar('informacion_medica', COMPLETAS.informacion_medica).expect(200);
      await eventos.esperarEventos();
    } finally {
      cancelar();
    }
    expect(recibidos).toEqual([
      expect.objectContaining({
        solicitudId: ctx.solicitud.id,
        seccion: 'informacion_medica',
        version: 1,
        estado: 'completa',
        origen: 'app',
        usuarioId: ctx.usuario.id,
      }),
    ]);
    const [bitacora] = await db.Bitacora.findAll({ where: { accion: 'secciones.guardar' } });
    expect(bitacora.despues.campos).toEqual([
      'atencionSolicitada',
      'cirugias',
      'diagnostico',
      'fechaInicio',
    ]);
    expect(JSON.stringify(bitacora)).not.toContain('Diagnóstico ficticio');
  });
});

describe('contrato fusionarValoresOcr', () => {
  let ctx;
  let revisor;

  beforeEach(async () => {
    await limpiarBase();
    ctx = await familiaConSolicitud({ modalidad: 'fotos' });
    revisor = await f.crearUsuario({ rol: 'voluntario' });
  });

  const fusionar = (valores, seccion = 'informacion_medica') =>
    db.sequelize.transaction((transaction) =>
      fusionarValoresOcr({
        solicitudId: ctx.solicitud.id,
        seccion,
        valores,
        usuarioId: revisor.id,
        transaction,
      }),
    );

  test('sobre una sección vacía deja origen ocr; con datos de la app, mixto', async () => {
    const r1 = await fusionar([
      { rutaDato: '/diagnostico', valor: 'Leído por OCR (ficticio)' },
      { rutaDato: '/cirugias/0/procedimiento', valor: 'Procedimiento ficticio' },
    ]);
    expect(r1).toEqual({ seccion: 'informacion_medica', version: 1, estado: 'incompleta' });
    let fila = await db.SolicitudSeccion.findOne({ where: { seccion: 'informacion_medica' } });
    expect(fila).toMatchObject({ origen: 'ocr', actualizadoPor: revisor.id });
    expect(fila.datos).toEqual({
      diagnostico: 'Leído por OCR (ficticio)',
      cirugias: [{ procedimiento: 'Procedimiento ficticio' }],
    });

    await conToken(api().put(ruta(ctx.solicitud)), ctx.token)
      .set('If-Match', '"v1"')
      .send({ datos: { ...fila.datos, fechaInicio: '2019' } })
      .expect(200);
    const r2 = await fusionar([
      { rutaDato: '/atencionSolicitada', valor: 'escoliosis' },
      { rutaDato: '/cirugias/0', valor: null },
    ]);
    expect(r2).toEqual({ seccion: 'informacion_medica', version: 3, estado: 'completa' });
    fila = await fila.reload();
    expect(fila.origen).toBe('mixto');
    expect(fila.datos.cirugias).toBeUndefined();
    expect(await db.Bitacora.count({ where: { accion: 'secciones.fusionar_ocr' } })).toBe(2);
  });

  test('un valor inválido lanza 400 por rutaDato y no guarda nada', async () => {
    await fusionar([{ rutaDato: '/diagnostico', valor: 'Primero (ficticio)' }]);
    const error = await fusionar([
      { rutaDato: '/diagnostico', valor: 'Cambio que no debe quedar' },
      { rutaDato: '/atencionSolicitada', valor: 'no_es_un_codigo' },
      { rutaDato: '/fechaInicio', valor: 2020 },
    ]).catch((e) => e);
    expect(error).toMatchObject({
      status: 400,
      codigo: 'VALIDACION',
      campos: { '/atencionSolicitada': 'VALOR_NO_PERMITIDO', '/fechaInicio': 'TIPO_INVALIDO' },
    });
    const fila = await db.SolicitudSeccion.findOne();
    expect(fila).toMatchObject({ version: 1, datos: { diagnostico: 'Primero (ficticio)' } });

    const rutaMala = await fusionar([{ rutaDato: 'diagnostico', valor: 'x' }]).catch((e) => e);
    expect(rutaMala.campos).toEqual({ diagnostico: 'RUTA_INVALIDA' });
    const prototipo = await fusionar([{ rutaDato: '/__proto__/x', valor: 1 }]).catch((e) => e);
    expect(prototipo.campos).toEqual({ '/__proto__/x': 'RUTA_INVALIDA' });
    await expect(fusionar([], 'consentimientos')).rejects.toMatchObject({ status: 404 });
  });
});

describe('esquemas JSON v1', () => {
  beforeAll(() => limpiarBase());

  test.each(Object.entries(COMPLETAS))(
    '%s: los datos completos de ejemplo son válidos',
    async (s, d) => {
      await expect(validarSeccion(s, d)).resolves.toMatchObject({ estado: 'completa' });
    },
  );

  test.each([
    ['informacion_medica', { fechaInicio: '2021-02-30' }, 'fechaInicio', 'FORMATO_INVALIDO'],
    [
      'informacion_medica',
      { atencionSolicitada: 'pie_zambo', atencionSolicitadaOtra: 'x' },
      'atencionSolicitadaOtra',
      'NO_APLICA',
    ],
    ['embarazo_nacimiento', { pesoNacerKg: 0 }, 'pesoNacerKg', 'MUY_PEQUENO'],
    ['antecedentes_medicos', { condiciones: ['asma', 'asma'] }, 'condiciones', 'REPETIDO'],
    [
      'antecedentes_medicos',
      { condiciones: ['asma'], condicionesOtra: 'x' },
      'condicionesOtra',
      'NO_APLICA',
    ],
    [
      'medicamentos_alergias',
      { usaMedicamentos: 'no', medicamentos: [{ nombre: 'x' }] },
      'medicamentos',
      'NO_APLICA',
    ],
    [
      'medicamentos_alergias',
      { medicamentos: [{ tipo: 'vitamina' }] },
      'medicamentos.0.tipo',
      'VALOR_NO_PERMITIDO',
    ],
    [
      'crecimiento_movilidad',
      { sentarse: 'aun_no', sentarseEdadMeses: 8 },
      'sentarseEdadMeses',
      'NO_APLICA',
    ],
    ['crecimiento_movilidad', { terapias: ['magia'] }, 'terapias.0', 'VALOR_NO_PERMITIDO'],
    [
      'educacion',
      { gradoEscolar: 'no_aplica', educacionEspecial: 'no' },
      'educacionEspecial',
      'NO_APLICA',
    ],
  ])('%s rechaza %j', async (seccion, datos, campo, codigo) => {
    await expect(validarSeccion(seccion, datos)).rejects.toMatchObject({
      status: 400,
      campos: { [`datos.${campo}`]: codigo },
    });
  });

  test.each([
    ['embarazo_nacimiento', { medicamentosEmbarazo: 'si' }, 'medicamentosEmbarazoDetalle'],
    ['medicamentos_alergias', { usaMedicamentos: 'si', alergias: 'si' }, 'alergiasTipo'],
    ['crecimiento_movilidad', { caminarSolo: 'logrado' }, 'caminarSoloEdadMeses'],
    ['educacion', { gradoEscolar: 'basica_4' }, 'asisteEscuela'],
  ])('%s: %j deja pendiente un campo condicional', async (seccion, datos, pendiente) => {
    const r = await validarSeccion(seccion, datos);
    expect(r.estado).toBe('incompleta');
    expect(r.pendientes).toContain(pendiente);
  });
});
