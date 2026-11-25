'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const {
  con,
  pdfFormulario,
  pdfEscaneado,
  MAPA_INTERNACIONAL,
  MAPA_MEXICO,
} = require('./ayudantes');

let admin;
let ta;
let formulario;
let escaneado;

beforeAll(async () => {
  formulario = await pdfFormulario();
  escaneado = await pdfEscaneado();
});

beforeEach(async () => {
  await limpiarBase();
  admin = await f.crearUsuario({ rol: 'administrador' });
  ta = await tokenPara(admin);
});

const ZONA = Object.freeze({
  campo: 'diagnostico',
  seccion: 'informacion_medica',
  rutaDato: '/diagnostico',
  tipo: 'texto',
  pagina: 2,
  caja: { x: 0.1, y: 0.2, ancho: 0.5, alto: 0.1 },
});

const internacional = (extra = {}) => ({
  codigo: 'solicitud_internacional',
  nombre: 'Solicitud internacional (prueba)',
  version: 1,
  paquete: 'INTERNACIONAL',
  metodo: 'campo',
  mapaCampos: MAPA_INTERNACIONAL,
  pdf: formulario,
  ...extra,
});

/** POST multipart a /admin/plantillas. Los valores que no son texto viajan como JSON. */
function registrar({ pdf, ...campos }, token = ta) {
  let req = con(api().post('/api/v1/admin/plantillas'), token);
  for (const [k, v] of Object.entries(campos)) {
    req = req.field(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  if (pdf) req = req.attach('archivo', pdf, 'plantilla.pdf');
  return req;
}
const cambiar = (id, cuerpo, token = ta) =>
  con(api().patch(`/api/v1/admin/plantillas/${id}`), token).send(cuerpo);
const listar = (q = '', token = ta) => con(api().get(`/api/v1/admin/plantillas${q}`), token);

describe('POST /admin/plantillas', () => {
  test('registra una plantilla por campo con zonas de OCR y su PDF guardado', async () => {
    const res = await registrar(internacional({ zonasOcr: [ZONA], orden: 2 })).expect(201);
    expect(res.body).toMatchObject({
      codigo: 'solicitud_internacional',
      version: 1,
      paquete: 'INTERNACIONAL',
      metodo: 'campo',
      numeroCampos: MAPA_INTERNACIONAL.length,
      mapaCampos: MAPA_INTERNACIONAL,
      zonasOcr: [ZONA],
      orden: 2,
      activa: true,
    });
    const archivo = await db.Archivo.findByPk(res.body.archivoPdfId);
    expect(archivo).toMatchObject({ mime: 'application/pdf', bytes: formulario.length });
    expect(await db.Bitacora.count({ where: { accion: 'plantilla.registrar' } })).toBe(1);
  });

  test('registra una plantilla escaneada por coordenadas', async () => {
    const res = await registrar({
      codigo: 'formulario_mexico',
      nombre: 'Formulario México (prueba)',
      version: 1,
      paquete: 'MEXICO',
      metodo: 'coordenadas',
      mapaCampos: MAPA_MEXICO,
      pdf: escaneado,
    }).expect(201);
    expect(res.body).toMatchObject({ metodo: 'coordenadas', paquete: 'MEXICO', orden: 0 });
  });

  test('campo inexistente, de firma o de otro tipo → 400', async () => {
    const mapa = [
      { destino: { campoPdf: 'NoExiste' }, origen: 'paciente.nombres', tipo: 'texto' },
      { destino: { campoPdf: 'ParentSignature' }, origen: 'paciente.nombres', tipo: 'texto' },
      { destino: { campoPdf: 'Female' }, origen: 'paciente.nombres', tipo: 'texto' },
      { destino: { campoPdf: 'PatientLastName' }, origen: 'paciente.sexo', tipo: 'casilla' },
      { destinoCoordenadas: { pagina: 1, x: 1, y: 1 }, origen: 'paciente.sexo', tipo: 'texto' },
    ];
    const res = await registrar(internacional({ mapaCampos: mapa })).expect(400);
    expect(res.body).toMatchObject({
      codigo: 'VALIDACION',
      campos: {
        'mapaCampos.0.destino.campoPdf': 'CAMPO_INEXISTENTE',
        'mapaCampos.1.destino.campoPdf': 'CAMPO_DE_FIRMA',
        'mapaCampos.2.destino.campoPdf': 'TIPO_DE_CAMPO_DISTINTO',
        'mapaCampos.3.destino.campoPdf': 'TIPO_DE_CAMPO_DISTINTO',
        'mapaCampos.4.destino': 'REQUERIDO',
      },
    });
    expect(await db.PlantillaFormulario.count()).toBe(0);
  });

  test('página inexistente (mapa o zonas de OCR) → 400', async () => {
    const res = await registrar({
      codigo: 'formulario_mexico',
      nombre: 'Formulario México (prueba)',
      version: 1,
      paquete: 'MEXICO',
      metodo: 'coordenadas',
      mapaCampos: [
        {
          destinoCoordenadas: { pagina: 2, x: 10, y: 10 },
          origen: 'paciente.nombres',
          tipo: 'texto',
        },
      ],
      zonasOcr: [{ ...ZONA, pagina: 3 }],
      pdf: escaneado,
    }).expect(400);
    expect(res.body.campos).toEqual({
      'mapaCampos.0.destinoCoordenadas.pagina': 'PAGINA_INEXISTENTE',
      'zonasOcr.0.pagina': 'PAGINA_INEXISTENTE',
    });
  });

  test('origen desconocido, zonas de OCR inválidas o JSON roto → 400', async () => {
    const origenes = [
      'paciente.diagnostico',
      'seccion.inventada./x',
      'seccion.informacion_medica./noExiste',
      'consentimiento.firma.decision',
      'usuario.contrasena',
    ];
    const res = await registrar(
      internacional({
        mapaCampos: origenes.map((origen) => ({
          destino: { campoPdf: 'PatientLastName' },
          origen,
          tipo: 'texto',
        })),
      }),
    ).expect(400);
    expect(Object.values(res.body.campos)).toEqual(origenes.map(() => 'ORIGEN_DESCONOCIDO'));

    const zonas = await registrar(internacional({ zonasOcr: [{ ...ZONA, tipo: 'firma' }] })).expect(
      400,
    );
    expect(zonas.body.campos).toEqual({ 'zonasOcr.0.tipo': 'VALOR_NO_PERMITIDO' });

    const roto = await registrar(internacional({ mapaCampos: '[{"origen":' })).expect(400);
    expect(roto.body.campos).toEqual({ mapaCampos: 'JSON_INVALIDO' });

    const firma = await registrar(
      internacional({
        mapaCampos: [
          { destino: { campoPdf: 'PatientLastName' }, origen: 'paciente.nombres', tipo: 'firma' },
        ],
      }),
    ).expect(400);
    expect(firma.body.campos).toEqual({ 'mapaCampos.0.tipo': 'VALOR_NO_PERMITIDO' });
  });

  test('sin PDF, con un archivo que no es PDF o con un PDF dañado → 400', async () => {
    expect((await registrar(internacional({ pdf: undefined })).expect(400)).body.campos).toEqual({
      archivo: 'REQUERIDO',
    });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect((await registrar(internacional({ pdf: jpeg })).expect(400)).body.codigo).toBe(
      'ARCHIVO_TIPO_NO_PERMITIDO',
    );
    const danado = Buffer.from('%PDF-1.7\nesto no es un PDF de verdad');
    expect((await registrar(internacional({ pdf: danado })).expect(400)).body.campos).toEqual({
      archivo: 'PDF_INVALIDO',
    });
  });

  test('una versión nueva queda activa y desactiva la anterior; versión repetida → 409', async () => {
    const v1 = (await registrar(internacional()).expect(201)).body;
    const v2 = (await registrar(internacional({ version: 2 })).expect(201)).body;
    expect(v2).toMatchObject({ version: 2, activa: true });
    expect((await db.PlantillaFormulario.findByPk(v1.id)).activa).toBe(false);
    const repetida = await registrar(internacional({ version: 2 })).expect(409);
    expect(repetida.body.codigo).toBe('PLANTILLA_VERSION_EXISTE');
    expect(await db.PlantillaFormulario.count()).toBe(2);
  });
});

describe('GET y PATCH /admin/plantillas', () => {
  test('lista con filtros; activar una versión desactiva las demás; desactivar sin borrar', async () => {
    const v1 = (await registrar(internacional()).expect(201)).body;
    const v2 = (await registrar(internacional({ version: 2 })).expect(201)).body;
    await registrar({
      codigo: 'formulario_mexico',
      nombre: 'Formulario México (prueba)',
      version: 1,
      paquete: 'MEXICO',
      metodo: 'coordenadas',
      mapaCampos: MAPA_MEXICO,
      pdf: escaneado,
    }).expect(201);

    const todas = (await listar().expect(200)).body;
    expect(todas.map((p) => [p.codigo, p.version])).toEqual([
      ['solicitud_internacional', 2],
      ['solicitud_internacional', 1],
      ['formulario_mexico', 1],
    ]);
    expect((await listar('?paquete=MEXICO').expect(200)).body).toHaveLength(1);
    expect((await listar('?activa=false').expect(200)).body.map((p) => p.id)).toEqual([v1.id]);

    const activada = await cambiar(v1.id, { activa: true, orden: 3 }).expect(200);
    expect(activada.body).toMatchObject({ activa: true, orden: 3 });
    expect((await db.PlantillaFormulario.findByPk(v2.id)).activa).toBe(false);

    await cambiar(v1.id, { activa: false }).expect(200);
    expect(await db.PlantillaFormulario.count()).toBe(3);
    expect((await listar('?codigo=solicitud_internacional&activa=true').expect(200)).body).toEqual(
      [],
    );
    expect(await db.Bitacora.count({ where: { accion: 'plantilla.cambiar' } })).toBe(3);
  });

  test('sin cambios → 400; inexistente → 404', async () => {
    const v1 = (await registrar(internacional()).expect(201)).body;
    expect((await cambiar(v1.id, {}).expect(400)).body.campos).toEqual({ cuerpo: 'SIN_CAMBIOS' });
    // El mapa no se edita: se registra una versión nueva.
    expect((await cambiar(v1.id, { mapaCampos: [] }).expect(400)).body.campos).toMatchObject({
      mapaCampos: 'CAMPO_NO_PERMITIDO',
    });
    await cambiar(crypto.randomUUID(), { activa: false }).expect(404);
  });

  test('solo el administrador: coordinador, familia y voluntario → 403; sin token → 401', async () => {
    const v1 = (await registrar(internacional()).expect(201)).body;
    for (const rol of ['coordinador', 'familia', 'voluntario']) {
      const t = await tokenPara(await f.crearUsuario({ rol }));
      await listar('', t).expect(403);
      await registrar(internacional({ version: 5 }), t).expect(403);
      await cambiar(v1.id, { activa: false }, t).expect(403);
    }
    await listar('', 'token-invalido').expect(401);
  });
});
