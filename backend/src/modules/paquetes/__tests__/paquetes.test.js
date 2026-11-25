'use strict';

const crypto = require('node:crypto');
const { PDFDocument } = require('pdf-lib');
const db = require('../../../models');
const f = require('../../../../test/factories');
const cola = require('../../../core/cola');
const almacenamiento = require('../../../core/almacenamiento');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const {
  con,
  pdfFormulario,
  MAPA_INTERNACIONAL,
  DIAGNOSTICO,
  plantillasDePrueba,
  completarExpediente,
  leerArchivo,
  textoDelPdf,
  solicitar,
} = require('./ayudantes');

let coord;
let tc;
let plantillas;

beforeEach(async () => {
  await limpiarBase();
  cola.vaciar();
  coord = await f.crearUsuario({ rol: 'coordinador' });
  tc = await tokenPara(coord);
  plantillas = await plantillasDePrueba();
});

const get = (ruta, token = tc) => con(api().get(`/api/v1${ruta}`), token);
const enlace = (id, cuerpo, token = tc) =>
  con(api().post(`/api/v1/paquetes/${id}/enlace`), token).send(cuerpo);
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Solicita el paquete, corre la cola y devuelve el detalle. */
async function generar(solicitud, tipo) {
  const { body } = await solicitar(solicitud, tc, tipo);
  await cola.procesarPendientes();
  return (await get(`/paquetes/${body.id}`).expect(200)).body;
}

async function casoCompleto({ ruta = 'INTERNACIONAL', estado = 'COMPLETA', decision } = {}) {
  const familia = await f.crearFamilia();
  const solicitud = await f.crearSolicitud({
    paciente: familia.paciente,
    estado,
    rutaDecidida: ruta,
  });
  await completarExpediente(solicitud, { decision });
  return { familia, solicitud };
}

async function bytesDe(paqueteId) {
  return leerArchivo((await db.PaquetePdf.findByPk(paqueteId)).archivoId);
}

describe('POST /solicitudes/:id/paquetes y el trabajo paquete.generar', () => {
  test('final internacional: formulario rellenado por campo y aplanado, anexos y firma sin rellenar', async () => {
    const { solicitud, familia } = await casoCompleto();
    const { body } = await solicitar(solicitud, tc, 'final');
    expect(body).toEqual({
      id: expect.any(String),
      solicitudId: solicitud.id,
      paquete: 'INTERNACIONAL',
      tipo: 'final',
      estado: 'en_cola',
    });
    expect(cola.pendientes()).toEqual([
      expect.objectContaining({ nombre: 'paquete.generar', datos: { paqueteId: body.id } }),
    ]);
    await cola.procesarPendientes();

    const paquete = (await get(`/paquetes/${body.id}`).expect(200)).body;
    expect(paquete).toMatchObject({
      estado: 'listo',
      progreso: 100,
      error: null,
      generadoPor: { id: coord.id },
      revision: null,
      plantillas: [
        {
          id: plantillas.internacional.id,
          codigo: 'solicitud_internacional_prueba',
          version: 1,
          paginas: 2,
        },
      ],
    });
    // Anexos: los documentos validados de evaluación e internacional, una página cada uno.
    expect(paquete.anexos.map((a) => a.codigo)).toEqual(
      expect.arrayContaining([
        'fotos_condicion',
        'radiografias_informes',
        'certificacion_medica',
        'consentimiento_divulgacion_firmado',
      ]),
    );
    expect(paquete.anexos.every((a) => a.paginas === 1)).toBe(true);
    expect(paquete.numeroPaginas).toBe(2 + paquete.anexos.length);
    expect(paquete.avisos).toEqual(
      expect.arrayContaining([
        {
          tipo: 'firma_pendiente',
          plantilla: 'solicitud_internacional_prueba',
          campo: 'ParentSignature',
        },
        { tipo: 'campo_recortado', plantilla: 'solicitud_internacional_prueba', campo: 'CaseCode' },
      ]),
    );
    expect(paquete.avisos.some((a) => a.tipo === 'anexo_faltante')).toBe(false);

    const bytes = await bytesDe(body.id);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(paquete.numeroPaginas);
    expect(doc.getForm().getFields()).toHaveLength(0); // aplanado, sin el campo de firma
    const texto = await textoDelPdf(bytes);
    expect(texto).toContain('Prueba Ficticia'); // apellidos
    expect(texto).toContain(familia.paciente.nombres);
    expect(texto).toContain('05/10/2016'); // MM/DD/AAAA
    expect(texto).toContain(DIAGNOSTICO);
    expect(texto).toContain('Clubfoot'); // etiqueta del catálogo en inglés
    expect(texto).toContain(solicitud.codigo.slice(0, 4)); // recortado al máximo del campo
    expect(texto).not.toContain(solicitud.codigo);
  });

  test('borrador México en PAQUETE_EXTERIOR: texto en coordenadas en español y anexos faltantes', async () => {
    const familia = await f.crearFamilia();
    const solicitud = await f.crearSolicitud({
      paciente: familia.paciente,
      estado: 'PAQUETE_EXTERIOR',
      rutaDecidida: 'MEXICO',
    });
    await f.crearSeccion({
      solicitud,
      seccion: 'informacion_medica',
      datos: { diagnostico: DIAGNOSTICO },
    });
    await db.Consentimiento.create({
      solicitudId: solicitud.id,
      tipo: 'divulgacion_informacion_medica',
      decision: 'acepta',
      decididoEn: new Date(),
      estadoFirma: 'pendiente',
    });

    const paquete = await generar(solicitud, 'borrador');
    expect(paquete).toMatchObject({
      paquete: 'MEXICO',
      tipo: 'borrador',
      estado: 'listo',
      numeroPaginas: 1,
      plantillas: [{ codigo: 'formulario_mexico_prueba', paginas: 1 }],
      anexos: [],
    });
    expect(paquete.avisos).toEqual(
      expect.arrayContaining([
        { tipo: 'firma_pendiente', consentimiento: 'divulgacion_informacion_medica' },
        { tipo: 'anexo_faltante', documento: 'fotos_condicion' },
        { tipo: 'anexo_faltante', documento: 'informacion_financiera' },
      ]),
    );
    const texto = await textoDelPdf(await bytesDe(paquete.id));
    expect(texto).toContain(`${familia.paciente.nombres} Prueba Ficticia`);
    expect(texto).toContain(DIAGNOSTICO); // cabe al reducir la letra
    expect(texto).toContain('Madre'); // catálogo en español
    expect(texto).toMatch(/\(?X\)? Tj|X Tj/); // casilla marcada
  });

  test('borrador en EN_REVISION solo en la etapa paquete; final solo en COMPLETA', async () => {
    const enPaquete = await f.crearSolicitud({
      estado: 'EN_REVISION',
      etapa: 'paquete',
      rutaDecidida: 'INTERNACIONAL',
      paquete: 'INTERNACIONAL',
    });
    await solicitar(enPaquete, tc, 'borrador');

    const enEvaluacion = await f.crearSolicitud({
      estado: 'EN_REVISION',
      etapa: 'evaluacion',
      rutaDecidida: 'INTERNACIONAL',
      paquete: 'INTERNACIONAL',
    });
    const enviada = await f.crearSolicitud({ estado: 'ENVIADA', rutaDecidida: 'INTERNACIONAL' });
    for (const s of [enEvaluacion, enviada]) {
      const res = await solicitar(s, tc, 'borrador', 409);
      expect(res.body.codigo).toBe('PAQUETE_ESTADO_NO_PERMITIDO');
    }
    const exterior = await f.crearSolicitud({
      estado: 'PAQUETE_EXTERIOR',
      rutaDecidida: 'INTERNACIONAL',
    });
    expect((await solicitar(exterior, tc, 'final', 409)).body.codigo).toBe(
      'PAQUETE_ESTADO_NO_PERMITIDO',
    );
    expect(await db.PaquetePdf.count()).toBe(1);
  });

  test('final con obligatorios pendientes → 409 PAQUETE_FALTANTES con la lista', async () => {
    const solicitud = await f.crearSolicitud({ estado: 'COMPLETA', rutaDecidida: 'INTERNACIONAL' });
    const res = await solicitar(solicitud, tc, 'final', 409);
    expect(res.body.codigo).toBe('PAQUETE_FALTANTES');
    expect(res.body.campos).toMatchObject({
      'seccion.informacion_medica': 'FALTA',
      'documento.fotos_condicion': 'FALTA',
      'consentimiento.divulgacion_informacion_medica': 'FALTA',
    });
    expect(cola.pendientes()).toHaveLength(0);
  });

  test('firmas pendientes bloquean el final según paquete.bloquear_firmas_pendientes', async () => {
    const { solicitud } = await casoCompleto();
    await db.Consentimiento.update(
      { estadoFirma: 'pendiente' },
      { where: { solicitudId: solicitud.id, tipo: 'telesalud' } },
    );
    const res = await solicitar(solicitud, tc, 'final', 409);
    expect(res.body.campos).toEqual({ 'consentimiento.telesalud': 'FIRMA_PENDIENTE' });

    await db.Configuracion.update(
      { valor: false },
      { where: { clave: 'paquete.bloquear_firmas_pendientes' } },
    );
    const paquete = await generar(solicitud, 'final');
    expect(paquete.avisos).toContainEqual({ tipo: 'firma_pendiente', consentimiento: 'telesalud' });
    await db.Configuracion.update(
      { valor: true },
      { where: { clave: 'paquete.bloquear_firmas_pendientes' } },
    );
  });

  test('ruta Honduras o sin ruta → 409 PAQUETE_NO_APLICA; sin plantillas activas → 409', async () => {
    const honduras = await f.crearSolicitud({ estado: 'DERIVADA_HN', rutaDecidida: 'HONDURAS' });
    const sinRuta = await f.crearSolicitud({ estado: 'EN_EVALUACION' });
    for (const s of [honduras, sinRuta]) {
      expect((await solicitar(s, tc, 'borrador', 409)).body.codigo).toBe('PAQUETE_NO_APLICA');
    }
    await plantillas.internacional.update({ activa: false });
    const exterior = await f.crearSolicitud({
      estado: 'PAQUETE_EXTERIOR',
      rutaDecidida: 'INTERNACIONAL',
    });
    expect((await solicitar(exterior, tc, 'borrador', 409)).body.codigo).toBe(
      'PAQUETE_SIN_PLANTILLAS',
    );
  });

  test('consentimiento de divulgación rechazado: campos médicos en blanco y anexos médicos fuera', async () => {
    const { solicitud } = await casoCompleto({
      decision: (tipo) => (tipo === 'divulgacion_informacion_medica' ? 'no_acepta' : 'acepta'),
    });
    const paquete = await generar(solicitud, 'final');
    expect(paquete.estado).toBe('listo');
    for (const campo of ['Diagnosis', 'CareRequested']) {
      expect(paquete.avisos).toContainEqual({
        tipo: 'campo_omitido_por_consentimiento',
        plantilla: 'solicitud_internacional_prueba',
        campo,
        consentimiento: 'divulgacion_informacion_medica',
      });
    }
    for (const documento of ['fotos_condicion', 'radiografias_informes', 'certificacion_medica']) {
      expect(paquete.avisos).toContainEqual({
        tipo: 'anexo_omitido_por_consentimiento',
        documento,
        consentimiento: 'divulgacion_informacion_medica',
      });
    }
    const codigos = paquete.anexos.map((a) => a.codigo);
    expect(codigos).not.toContain('fotos_condicion');
    expect(codigos).toContain('consentimiento_divulgacion_firmado'); // no es médico

    const texto = await textoDelPdf(await bytesDe(paquete.id));
    expect(texto).not.toContain(DIAGNOSTICO);
    expect(texto).not.toContain('Clubfoot');
    expect(texto).toContain('Prueba Ficticia'); // los datos no médicos sí entran
  });

  test('requiereConsentimiento de la plantilla deja el campo en blanco si no se acepta', async () => {
    await plantillas.internacional.update({
      mapaCampos: MAPA_INTERNACIONAL.map((el) =>
        el.destino.campoPdf === 'PatientFirstName'
          ? { ...el, requiereConsentimiento: 'marketing' }
          : el,
      ),
    });
    const { solicitud, familia } = await casoCompleto({
      decision: (tipo) => (tipo === 'marketing' ? 'no_acepta' : 'acepta'),
    });
    const paquete = await generar(solicitud, 'final');
    expect(paquete.avisos).toContainEqual({
      tipo: 'campo_omitido_por_consentimiento',
      plantilla: 'solicitud_internacional_prueba',
      campo: 'PatientFirstName',
      consentimiento: 'marketing',
    });
    const texto = await textoDelPdf(await bytesDe(paquete.id));
    expect(texto).not.toContain(familia.paciente.nombres);
    expect(texto).toContain(DIAGNOSTICO);
  });

  test('una versión nueva de la plantilla no altera un paquete ya generado', async () => {
    const { solicitud } = await casoCompleto();
    const viejo = await generar(solicitud, 'final');
    const antes = sha(await bytesDe(viejo.id));

    const admin = await f.crearUsuario({ rol: 'administrador' });
    await con(api().post('/api/v1/admin/plantillas'), await tokenPara(admin))
      .field('codigo', 'solicitud_internacional_prueba')
      .field('nombre', 'Solicitud internacional v2')
      .field('version', '2')
      .field('paquete', 'INTERNACIONAL')
      .field('metodo', 'campo')
      .field('mapaCampos', JSON.stringify(MAPA_INTERNACIONAL))
      .attach('archivo', await pdfFormulario({ extra: 'Notes' }), 'plantilla.pdf')
      .expect(201);
    expect((await plantillas.internacional.reload()).activa).toBe(false);

    const otraVez = (await get(`/paquetes/${viejo.id}`).expect(200)).body;
    expect(otraVez.plantillas).toEqual(viejo.plantillas);
    expect(otraVez.plantillas[0].version).toBe(1);
    expect(sha(await bytesDe(viejo.id))).toBe(antes);

    const nuevo = await generar(solicitud, 'final');
    expect(nuevo.plantillas).toEqual([
      expect.objectContaining({ codigo: 'solicitud_internacional_prueba', version: 2 }),
    ]);
  });

  test('si el PDF de la plantilla no está disponible, el paquete queda fallido con un código', async () => {
    await plantillas.internacional.update({ activa: false });
    await f.crearPlantilla({ paquete: 'INTERNACIONAL', mapaCampos: MAPA_INTERNACIONAL });
    const solicitud = await f.crearSolicitud({
      estado: 'PAQUETE_EXTERIOR',
      rutaDecidida: 'INTERNACIONAL',
    });
    const paquete = await generar(solicitud, 'borrador');
    expect(paquete).toMatchObject({
      estado: 'fallido',
      error: 'PLANTILLA_NO_DISPONIBLE',
      numeroPaginas: null,
    });
  });

  test('validación: tipo inválido → 400', async () => {
    const solicitud = await f.crearSolicitud({
      estado: 'PAQUETE_EXTERIOR',
      rutaDecidida: 'INTERNACIONAL',
    });
    const res = await con(api().post(`/api/v1/solicitudes/${solicitud.id}/paquetes`), tc)
      .send({ tipo: 'definitivo' })
      .expect(400);
    expect(res.body.campos).toEqual({ tipo: 'VALOR_NO_PERMITIDO' });
  });
});

describe('GET /paquetes/:id/paginas/:n', () => {
  test('URL firmada de un PDF de una página, en caché y con registro de acceso', async () => {
    const solicitud = await f.crearSolicitud({
      estado: 'PAQUETE_EXTERIOR',
      rutaDecidida: 'INTERNACIONAL',
    });
    const paquete = await generar(solicitud, 'borrador');
    expect(paquete.numeroPaginas).toBe(2);

    const subir = jest.spyOn(almacenamiento, 'subirObjeto');
    const res = await get(`/paquetes/${paquete.id}/paginas/2`).expect(200);
    expect(res.body).toEqual({
      pagina: 2,
      numeroPaginas: 2,
      url: expect.stringContaining(encodeURIComponent(`paquetes/paginas/${paquete.id}/2.pdf`)),
      expiraEn: expect.any(String),
    });
    const flujo = await almacenamiento.leerObjeto(`paquetes/paginas/${paquete.id}/2.pdf`);
    const partes = [];
    for await (const p of flujo) partes.push(Buffer.from(p));
    expect((await PDFDocument.load(Buffer.concat(partes))).getPageCount()).toBe(1);

    await get(`/paquetes/${paquete.id}/paginas/2`).expect(200);
    expect(subir).toHaveBeenCalledTimes(1); // la segunda vez sale de la caché
    expect(
      await db.RegistroAcceso.count({
        where: { usuarioId: coord.id, recurso: 'paquete', recursoId: paquete.id },
      }),
    ).toBe(2);
  });

  test('página fuera de rango → 404; 0 → 400; paquete no listo → 409', async () => {
    const paquete = await f.crearPaquetePdf({ numeroPaginas: 3 });
    expect((await get(`/paquetes/${paquete.id}/paginas/4`).expect(404)).body.codigo).toBe(
      'NO_ENCONTRADO',
    );
    await get(`/paquetes/${paquete.id}/paginas/0`).expect(400);
    const enCola = await f.crearPaquetePdf({ estado: 'en_cola' });
    expect((await get(`/paquetes/${enCola.id}/paginas/1`).expect(409)).body.codigo).toBe(
      'PAQUETE_NO_LISTO',
    );
  });
});

describe('POST /paquetes/:id/enlace', () => {
  test('confirma la revisión y devuelve un enlace de 60 minutos', async () => {
    const paquete = await f.crearPaquetePdf();
    const antes = Date.now();
    const res = await enlace(paquete.id, { confirmoRevision: true }).expect(200);
    expect(res.body).toEqual({
      url: expect.any(String),
      expiraEn: expect.any(String),
      revision: {
        revisadoPor: { id: coord.id, nombre: expect.any(String) },
        revisadoEn: expect.any(String),
      },
    });
    const minutos = (new Date(res.body.expiraEn).getTime() - antes) / 60000;
    expect(minutos).toBeGreaterThan(59);
    expect(minutos).toBeLessThan(61);
    await paquete.reload();
    expect(paquete.revisadoPor).toBe(coord.id);
    expect(paquete.revisadoEn).toBeInstanceOf(Date);
    expect(await db.RegistroAcceso.count({ where: { recurso: 'paquete' } })).toBe(1);
    expect(await db.Bitacora.count({ where: { accion: 'paquete.revisar' } })).toBe(1);

    const detalle = (await get(`/paquetes/${paquete.id}`).expect(200)).body;
    expect(detalle.revision).toEqual(res.body.revision);
  });

  test('sin confirmoRevision → 400; borrador → 409; final no listo → 409', async () => {
    const paquete = await f.crearPaquetePdf();
    expect((await enlace(paquete.id, {}).expect(400)).body.campos).toEqual({
      confirmoRevision: 'REQUERIDO',
    });
    expect((await enlace(paquete.id, { confirmoRevision: false }).expect(400)).body.campos).toEqual(
      { confirmoRevision: 'DEBE_CONFIRMAR' },
    );

    const borrador = await f.crearPaquetePdf({ tipo: 'borrador' });
    expect((await enlace(borrador.id, { confirmoRevision: true }).expect(409)).body.codigo).toBe(
      'PAQUETE_NO_FINAL',
    );
    const generando = await f.crearPaquetePdf({ estado: 'generando' });
    expect((await enlace(generando.id, { confirmoRevision: true }).expect(409)).body.codigo).toBe(
      'PAQUETE_NO_LISTO',
    );
    expect((await paquete.reload()).revisadoEn).toBeNull();
  });
});

describe('acceso al módulo', () => {
  test('familia y voluntario → 403 en todo el módulo; sin token → 401; paquete ajeno → 404', async () => {
    const familia = await f.crearFamilia();
    const solicitud = await f.crearSolicitud({
      paciente: familia.paciente,
      estado: 'COMPLETA',
      rutaDecidida: 'INTERNACIONAL',
    });
    const paquete = await f.crearPaquetePdf({ solicitud });
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud, voluntario });

    const llamadas = [
      (t) =>
        con(api().post(`/api/v1/solicitudes/${solicitud.id}/paquetes`), t).send({
          tipo: 'borrador',
        }),
      (t) => con(api().get(`/api/v1/paquetes/${paquete.id}`), t),
      (t) => con(api().get(`/api/v1/paquetes/${paquete.id}/paginas/1`), t),
      (t) =>
        con(api().post(`/api/v1/paquetes/${paquete.id}/enlace`), t).send({
          confirmoRevision: true,
        }),
      (t) =>
        con(api().post(`/api/v1/solicitudes/${solicitud.id}/envios`), t).send({
          paqueteId: paquete.id,
          destino: 'INTERNACIONAL',
          fecha: '2026-11-01',
          metodo: 'correo',
        }),
      (t) =>
        con(api().post(`/api/v1/solicitudes/${solicitud.id}/respuestas`), t).send({
          fecha: '2026-11-01',
          resultado: 'aceptada',
        }),
    ];
    const tokens = [await tokenPara(familia.usuario), await tokenPara(voluntario)];
    for (const llamada of llamadas) {
      for (const t of tokens) {
        expect((await llamada(t).expect(403)).body.codigo).toBe('SIN_PERMISO');
      }
      await llamada('token-invalido').expect(401);
    }
    await get(`/paquetes/${crypto.randomUUID()}`).expect(404);
  });
});
