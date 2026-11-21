'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

describe('catálogos, contactos y ayuda', () => {
  let token;
  let tokenEn;

  beforeEach(async () => {
    await limpiarBase();
    token = await tokenPara(await f.crearUsuario({ rol: 'voluntario' }));
    tokenEn = await tokenPara(await f.crearUsuario({ idioma: 'en' }));
  });

  const get = (ruta, t = token) => api().get(`/api/v1${ruta}`).set('Authorization', `Bearer ${t}`);

  test('exigen sesión', async () => {
    for (const ruta of [
      '/catalogos/departamentos',
      '/catalogos/parentesco',
      '/configuracion/contactos',
      '/ayuda/articulos',
    ]) {
      await api().get(`/api/v1${ruta}`).expect(401);
    }
  });

  test('departamentos y municipios con su código oficial', async () => {
    const departamentos = await get('/catalogos/departamentos').expect(200);
    expect(departamentos.body).toHaveLength(18);
    expect(departamentos.body[0]).toEqual({ codigo: '01', nombre: 'Atlántida' });
    expect(departamentos.headers['cache-control']).toBe('private, max-age=3600');

    const municipios = await get('/catalogos/departamentos/08/municipios').expect(200);
    expect(municipios.body).toHaveLength(28);
    expect(municipios.body[0]).toEqual({ codigo: '0801', nombre: 'Distrito Central' });

    await get('/catalogos/departamentos/99/municipios').expect(404);
    const invalido = await get('/catalogos/departamentos/abc/municipios').expect(400);
    expect(invalido.body.campos).toEqual({ 'params.id': 'FORMATO_INVALIDO' });
  });

  test('un catálogo devuelve códigos con la etiqueta en el idioma del usuario o en ?idioma=', async () => {
    const es = await get('/catalogos/parentesco').expect(200);
    expect(es.body[0]).toEqual({ codigo: 'madre', etiqueta: 'Madre', orden: 10, metadatos: {} });
    const en = await get('/catalogos/parentesco', tokenEn).expect(200);
    expect(en.body[0].etiqueta).toBe('Mother');
    const forzado = await get('/catalogos/parentesco?idioma=en').expect(200);
    expect(forzado.body[0].etiqueta).toBe('Mother');

    const atencion = await get('/catalogos/tipo_atencion').expect(200);
    expect(atencion.body.find((i) => i.codigo === 'pie_zambo').metadatos).toEqual({
      especialidades: ['ortopedia_pediatrica'],
    });
  });

  test('oculta los ítems inactivos; un tipo inexistente responde 404', async () => {
    await db.CatalogoItem.update(
      { activo: false },
      { where: { tipo: 'parentesco', codigo: 'otro' } },
    );
    const res = await get('/catalogos/parentesco').expect(200);
    expect(res.body.map((i) => i.codigo)).not.toContain('otro');
    const inexistente = await get('/catalogos/colores').expect(404);
    expect(inexistente.body.codigo).toBe('CATALOGO_NO_ENCONTRADO');
  });

  test('responde 304 si el catálogo no cambió (ETag)', async () => {
    const primera = await get('/catalogos/terapia').expect(200);
    expect(primera.headers.etag).toBeDefined();
    await get('/catalogos/terapia').set('If-None-Match', primera.headers.etag).expect(304);
  });

  test('contactos oficiales y artículos de ayuda en el idioma pedido', async () => {
    const contactos = await get('/configuracion/contactos').expect(200);
    expect(contactos.body).toMatchObject({ dePrueba: true, correo: 'contacto@vanguardia.test' });
    expect(contactos.body.horario).toMatch(/Lunes/);
    const contactosEn = await get('/configuracion/contactos', tokenEn).expect(200);
    expect(contactosEn.body.horario).toMatch(/Monday/);

    const ayuda = await get('/ayuda/articulos?idioma=en').expect(200);
    expect(ayuda.body.map((a) => a.codigo)).toEqual([
      'como_usar',
      'como_fotografiar',
      'preguntas_frecuentes',
      'privacidad',
    ]);
    expect(ayuda.body[0].titulo).toBe('How to use the app');
  });
});
