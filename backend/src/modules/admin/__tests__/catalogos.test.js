'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { estadoExpediente } = require('../../../core/expediente');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

let token;

beforeEach(async () => {
  await limpiarBase();
  token = await tokenPara(await f.crearUsuario({ rol: 'administrador' }));
});

const con = (req) => req.set('Authorization', `Bearer ${token}`);
const get = (ruta) => con(api().get(`/api/v1/admin/${ruta}`));
const post = (ruta, cuerpo) => con(api().post(`/api/v1/admin/${ruta}`)).send(cuerpo);
const patch = (ruta, cuerpo) => con(api().patch(`/api/v1/admin/${ruta}`)).send(cuerpo);
const idTipo = async (codigo) => (await db.TipoDocumento.findOne({ where: { codigo } })).id;

const TIPO = {
  codigo: 'constancia_ficticia',
  nombreEs: 'Constancia ficticia',
  nombreEn: 'Fictitious certificate',
  categoria: 'otro',
  paraQueSirveEs: 'Texto de ayuda de prueba.',
  paraQueSirveEn: 'Test help text.',
  admiteVariasPaginas: false,
  paginasEsperadas: 1,
};

describe('tipos de documento', () => {
  test('lista también los inactivos, con filtros', async () => {
    const todos = await get('tipos-documento').expect(200);
    expect(todos.body.length).toBe(await db.TipoDocumento.count());
    expect(Object.keys(todos.body[0]).sort()).toEqual(
      [
        'id',
        'codigo',
        'nombreEs',
        'nombreEn',
        'categoria',
        'paraQueSirveEs',
        'paraQueSirveEn',
        'comoFotografiarEs',
        'comoFotografiarEn',
        'admiteVariasPaginas',
        'paginasEsperadas',
        'plantillaId',
        'version',
        'activo',
        'actualizadoEn',
      ].sort(),
    );
    const medicos = await get('tipos-documento?categoria=medico').expect(200);
    expect(medicos.body.every((t) => t.categoria === 'medico')).toBe(true);
    await db.TipoDocumento.update({ activo: false }, { where: { codigo: 'seguros' } });
    const inactivos = await get('tipos-documento?activo=false').expect(200);
    expect(inactivos.body.map((t) => t.codigo)).toEqual(['seguros']);
    await get('tipos-documento?categoria=receta').expect(400);
  });

  test('crear: versión 1 y activo; código repetido → 409; reglas de ayuda, páginas y plantilla', async () => {
    const res = await post('tipos-documento', TIPO).expect(201);
    expect(res.body).toMatchObject({ ...TIPO, version: 1, activo: true, plantillaId: null });
    expect(
      await db.Bitacora.count({
        where: { accion: 'tipos_documento.crear', entidadId: res.body.id },
      }),
    ).toBe(1);

    const repetido = await post('tipos-documento', TIPO).expect(409);
    expect(repetido.body.codigo).toBe('TIPO_DOCUMENTO_CODIGO_EXISTE');

    const otro = { ...TIPO, codigo: 'otra_constancia' };
    const soloEspanol = await post('tipos-documento', { ...otro, paraQueSirveEn: null }).expect(
      400,
    );
    expect(soloEspanol.body.campos).toEqual({ paraQueSirveEn: 'REQUERIDO' });
    const paginas = await post('tipos-documento', { ...otro, paginasEsperadas: 3 }).expect(400);
    expect(paginas.body.campos).toEqual({ paginasEsperadas: 'INCOMPATIBLE' });
    const sinPlantilla = await post('tipos-documento', {
      ...otro,
      plantillaId: crypto.randomUUID(),
    }).expect(400);
    expect(sinPlantilla.body.campos).toEqual({ plantillaId: 'NO_EXISTE' });
    const mal = await post('tipos-documento', { ...otro, codigo: 'Con Espacios', version: 4 });
    expect(mal.status).toBe(400);
    expect(mal.body.campos).toEqual({ codigo: 'FORMATO_INVALIDO', version: 'CAMPO_NO_PERMITIDO' });

    const plantilla = await f.crearPlantilla();
    const conPlantilla = await post('tipos-documento', { ...otro, plantillaId: plantilla.id });
    expect(conPlantilla.status).toBe(201);
    expect(conPlantilla.body.plantillaId).toBe(plantilla.id);
  });

  test('cambiar textos o plantilla sube la versión; otros campos no; el código no cambia', async () => {
    const { body: tipo } = await post('tipos-documento', TIPO).expect(201);
    const ruta = `tipos-documento/${tipo.id}`;

    const textos = await patch(ruta, { nombreEs: 'Constancia ficticia nueva' }).expect(200);
    expect(textos.body.version).toBe(2);
    const paginas = await patch(ruta, { admiteVariasPaginas: true, paginasEsperadas: 4 });
    expect(paginas.body).toMatchObject({ version: 2, paginasEsperadas: 4 });
    const igual = await patch(ruta, { nombreEs: 'Constancia ficticia nueva' }).expect(200);
    expect(igual.body.version).toBe(2);
    const plantilla = await f.crearPlantilla();
    expect((await patch(ruta, { plantillaId: plantilla.id }).expect(200)).body.version).toBe(3);
    expect((await patch(ruta, { plantillaId: null }).expect(200)).body.version).toBe(4);

    const entrada = await db.Bitacora.findOne({
      where: { accion: 'tipos_documento.actualizar', entidadId: tipo.id },
      order: [['createdAt', 'ASC']],
    });
    expect(entrada.antes).toEqual({ nombreEs: 'Constancia ficticia', version: 1 });
    expect(entrada.despues).toEqual({ nombreEs: 'Constancia ficticia nueva', version: 2 });

    expect((await patch(ruta, { codigo: 'otro_codigo' }).expect(400)).body.campos).toEqual({
      codigo: 'CAMPO_NO_PERMITIDO',
    });
    expect((await patch(ruta, {}).expect(400)).body.campos).toEqual({ cuerpo: 'SIN_CAMBIOS' });
    expect(
      (await patch(ruta, { comoFotografiarEn: 'Only English' }).expect(400)).body.campos,
    ).toEqual({ comoFotografiarEs: 'REQUERIDO' });
    await patch(`tipos-documento/${crypto.randomUUID()}`, { activo: false }).expect(404);
  });

  test('desactivar: no se borra; con requisitos activos → 409', async () => {
    const fotos = await idTipo('fotos_condicion');
    const res = await patch(`tipos-documento/${fotos}`, { activo: false }).expect(409);
    expect(res.body).toMatchObject({
      codigo: 'TIPO_DOCUMENTO_CON_REQUISITOS',
      campos: { 'requisito.EVALUACION': 'ACTIVO' },
    });

    const { body: tipo } = await post('tipos-documento', TIPO).expect(201);
    const inactivo = await patch(`tipos-documento/${tipo.id}`, { activo: false }).expect(200);
    expect(inactivo.body).toMatchObject({ activo: false, version: 1 });
    expect(await db.TipoDocumento.count({ where: { id: tipo.id } })).toBe(1);
  });
});

describe('requisitos por ruta', () => {
  test('lista en el orden de las rutas y por orden dentro de cada una', async () => {
    const evaluacion = await get('requisitos-ruta?ruta=EVALUACION').expect(200);
    expect(evaluacion.body.map((r) => r.tipoDocumento.codigo)).toEqual([
      'fotos_condicion',
      'radiografias_informes',
      'certificacion_medica',
    ]);
    const todos = await get('requisitos-ruta').expect(200);
    const rutas = [...new Set(todos.body.map((r) => r.ruta))];
    expect(rutas).toEqual(
      ['EVALUACION', 'HONDURAS', 'MEXICO', 'INTERNACIONAL'].filter((r) => rutas.includes(r)),
    );
    const internacional = todos.body.find(
      (r) => r.tipoDocumento.codigo === 'solicitud_internacional',
    );
    expect(internacional.cubiertoPorSecciones).toEqual(['informacion_medica', 'profesional_salud']);
    await get('requisitos-ruta?ruta=TAMPA').expect(400);
  });

  test('crear: el mismo tipo dos veces → 409; tipo inactivo → 409; sección desconocida → 400', async () => {
    const fotos = await idTipo('fotos_condicion');
    const res = await post('requisitos-ruta', {
      ruta: 'HONDURAS',
      tipoDocumentoId: fotos,
      orden: 5,
      cubiertoPorSecciones: ['informacion_medica'],
    }).expect(201);
    expect(res.body).toMatchObject({
      ruta: 'HONDURAS',
      obligatorio: true,
      orden: 5,
      activo: true,
      cubiertoPorSecciones: ['informacion_medica'],
      tipoDocumento: { id: fotos, codigo: 'fotos_condicion', activo: true },
    });

    const repetido = await post('requisitos-ruta', { ruta: 'HONDURAS', tipoDocumentoId: fotos });
    expect(repetido.status).toBe(409);
    expect(repetido.body.codigo).toBe('REQUISITO_EXISTE');

    const { body: tipo } = await post('tipos-documento', TIPO).expect(201);
    await patch(`tipos-documento/${tipo.id}`, { activo: false }).expect(200);
    const inactivo = await post('requisitos-ruta', { ruta: 'MEXICO', tipoDocumentoId: tipo.id });
    expect(inactivo.status).toBe(409);
    expect(inactivo.body.codigo).toBe('REQUISITO_TIPO_INACTIVO');

    const seccion = await post('requisitos-ruta', {
      ruta: 'MEXICO',
      tipoDocumentoId: fotos,
      cubiertoPorSecciones: ['informacion_medica', 'seccion_inventada'],
    }).expect(400);
    expect(seccion.body.campos).toEqual({ 'cubiertoPorSecciones.1': 'VALOR_NO_PERMITIDO' });
    const sinTipo = await post('requisitos-ruta', {
      ruta: 'MEXICO',
      tipoDocumentoId: crypto.randomUUID(),
    }).expect(400);
    expect(sinTipo.body.campos).toEqual({ tipoDocumentoId: 'NO_EXISTE' });
  });

  test('desactivar cambia la lista que se pide, no los documentos ya capturados', async () => {
    const solicitud = await f.crearSolicitud({ estado: 'CAPTURA' });
    const documento = await f.crearDocumento({
      solicitud,
      tipo: 'radiografias_informes',
      estado: 'CAPTURADO',
    });
    const codigos = async () =>
      (await estadoExpediente(solicitud.id)).documentos.map((d) => d.codigo);
    expect(await codigos()).toContain('radiografias_informes');

    const requisito = await db.RequisitoRuta.findOne({
      where: { ruta: 'EVALUACION', tipoDocumentoId: await idTipo('radiografias_informes') },
    });
    const res = await patch(`requisitos-ruta/${requisito.id}`, { activo: false }).expect(200);
    expect(res.body.activo).toBe(false);
    expect(await codigos()).not.toContain('radiografias_informes');
    expect((await documento.reload()).estado).toBe('CAPTURADO');

    // Con el tipo desactivado, el requisito no se puede reactivar.
    const tipoId = requisito.tipoDocumentoId;
    await patch(`tipos-documento/${tipoId}`, { activo: false }).expect(200);
    const reactivar = await patch(`requisitos-ruta/${requisito.id}`, { activo: true }).expect(409);
    expect(reactivar.body.codigo).toBe('REQUISITO_TIPO_INACTIVO');
    await patch(`tipos-documento/${tipoId}`, { activo: true }).expect(200);
    await patch(`requisitos-ruta/${requisito.id}`, { activo: true, obligatorio: false }).expect(
      200,
    );
    expect(await codigos()).toContain('radiografias_informes');

    expect(
      (await patch(`requisitos-ruta/${requisito.id}`, { ruta: 'MEXICO' }).expect(400)).body.campos,
    ).toEqual({ ruta: 'CAMPO_NO_PERMITIDO' });
    await patch(`requisitos-ruta/${crypto.randomUUID()}`, { activo: false }).expect(404);
    const entrada = await db.Bitacora.findOne({
      where: { accion: 'requisitos_ruta.actualizar', entidadId: requisito.id },
      order: [['createdAt', 'ASC']],
    });
    expect(entrada.despues).toEqual({ activo: false });
  });
});

describe('catálogos', () => {
  test('crear un ítem lo publica en el catálogo; desactivarlo lo oculta', async () => {
    const familia = await tokenPara(await f.crearUsuario({ rol: 'familia' }));
    const publico = async () =>
      (
        await api()
          .get('/api/v1/catalogos/parentesco?idioma=en')
          .set('Authorization', `Bearer ${familia}`)
          .expect(200)
      ).body;

    const res = await post('catalogos', {
      tipo: 'parentesco',
      codigo: 'padrino_ficticio',
      etiquetaEs: 'Padrino (prueba)',
      etiquetaEn: 'Godparent (test)',
      orden: 99,
      metadatos: { notas: 'ficticio' },
    }).expect(201);
    expect(res.body).toMatchObject({ tipo: 'parentesco', activo: true, orden: 99 });
    expect((await publico()).find((i) => i.codigo === 'padrino_ficticio')).toMatchObject({
      codigo: 'padrino_ficticio',
      etiqueta: 'Godparent (test)',
    });

    const lista = await get('catalogos?tipo=parentesco').expect(200);
    expect(lista.body.find((i) => i.codigo === 'padrino_ficticio')).toMatchObject({
      etiquetaEs: 'Padrino (prueba)',
      metadatos: { notas: 'ficticio' },
    });

    await patch(`catalogos/${res.body.id}`, { activo: false }).expect(200);
    expect((await publico()).map((i) => i.codigo)).not.toContain('padrino_ficticio');
    const inactivos = await get('catalogos?tipo=parentesco&activo=false').expect(200);
    expect(inactivos.body.map((i) => i.codigo)).toEqual(['padrino_ficticio']);
  });

  test('catálogo inexistente → 400; código repetido → 409; tipo y código no cambian', async () => {
    const nuevo = {
      tipo: 'parentesco',
      codigo: 'primo_ficticio',
      etiquetaEs: 'Primo',
      etiquetaEn: 'Cousin',
    };
    const inventado = await post('catalogos', { ...nuevo, tipo: 'catalogo_inventado' }).expect(400);
    expect(inventado.body.campos).toEqual({ tipo: 'NO_EXISTE' });
    const { body } = await post('catalogos', nuevo).expect(201);
    expect((await post('catalogos', nuevo).expect(409)).body.codigo).toBe('CATALOGO_CODIGO_EXISTE');

    const cambio = await patch(`catalogos/${body.id}`, { codigo: 'otro', tipo: 'terapia' });
    expect(cambio.status).toBe(400);
    expect(cambio.body.campos).toEqual({
      codigo: 'CAMPO_NO_PERMITIDO',
      tipo: 'CAMPO_NO_PERMITIDO',
    });
    const etiqueta = await patch(`catalogos/${body.id}`, { etiquetaEn: 'First cousin' }).expect(
      200,
    );
    expect(etiqueta.body.etiquetaEn).toBe('First cousin');
    const entrada = await db.Bitacora.findOne({ where: { accion: 'catalogos_items.actualizar' } });
    expect(entrada.antes).toEqual({ etiquetaEn: 'Cousin' });
    await patch(`catalogos/${crypto.randomUUID()}`, { activo: false }).expect(404);
  });
});
