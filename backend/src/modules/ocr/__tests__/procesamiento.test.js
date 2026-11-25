'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const cola = require('../../../core/cola');
const trabajos = require('../../../core/cola/trabajos');
const eventos = require('../../../core/eventos');
const simulado = require('../motores/simulado');

/** El motor simulado sin espía, para usarlo dentro de una implementación simulada. */
const procesarOriginal = simulado.procesar;
const simuladoReal = (entrada) => procesarOriginal.call(simulado, entrada);
const { cancelarExtraccion, esquemaZonasOcr } = require('../contratos');
const { ZONAS, imagen, plantillaPara, documentoConPaginas, encolar } = require('./ayudantes');

let solicitud;

beforeEach(async () => {
  await limpiarBase();
  cola.vaciar();
  const familia = await f.crearFamilia();
  solicitud = await f.crearSolicitud({
    paciente: familia.paciente,
    estado: 'CAPTURA',
    modalidad: 'fotos',
  });
});

afterEach(async () => {
  await eventos.esperarEventos();
  jest.restoreAllMocks();
});

const campos = (extraccion) =>
  db.CampoExtraido.findAll({ where: { extraccionId: extraccion.id }, order: [['campo', 'ASC']] });

describe('encolar y procesar', () => {
  test('un tipo sin plantilla de OCR no crea extracción', async () => {
    const documento = await documentoConPaginas({ solicitud });
    expect(await encolar(documento)).toBeNull();
    expect(await db.Extraccion.count()).toBe(0);
    expect(cola.pendientes()).toEqual([]);
  });

  test('si la plantilla vinculada quedó inactiva, usa la versión activa del mismo código', async () => {
    const vieja = await plantillaPara();
    await vieja.update({ activa: false });
    const documento = await documentoConPaginas({ solicitud });
    expect(await encolar(documento)).toBeNull(); // sin versión activa no hay OCR

    // El administrador registra la versión 2 (el tipo de documento sigue apuntando a la 1).
    const nueva = await f.crearPlantilla({ codigo: vieja.codigo, version: 2, zonasOcr: ZONAS });
    const extraccion = await encolar(documento);
    expect(extraccion.plantillaId).toBe(nueva.id);
    await cola.procesarPendientes();
    expect((await extraccion.reload()).estado).toBe('por_confirmar');
  });

  test('con plantilla: en cola → procesando → por confirmar, con un campo por zona', async () => {
    await plantillaPara();
    const documento = await documentoConPaginas({ solicitud });
    const vistos = [];
    const quitar = [
      eventos.suscribir(eventos.EVENTOS.EXTRACCION_CREADA, (d) => vistos.push(['creada', d])),
      eventos.suscribir(eventos.EVENTOS.EXTRACCION_LISTA_PARA_REVISION, (d) =>
        vistos.push(['lista', d]),
      ),
    ];
    const progresos = [];
    const procesar = jest.spyOn(simulado, 'procesar');
    procesar.mockImplementation(async (entrada) => {
      const e = await db.Extraccion.findOne();
      progresos.push([e.estado, e.progreso]);
      return simuladoReal(entrada);
    });

    try {
      const extraccion = await encolar(documento);
      expect(extraccion).toMatchObject({ estado: 'en_cola', progreso: 0, motor: 'simulado' });
      expect(cola.pendientes()).toEqual([
        expect.objectContaining({
          nombre: trabajos.OCR_PROCESAR,
          datos: { extraccionId: extraccion.id },
        }),
      ]);

      await cola.procesarPendientes();
      await extraccion.reload();
      expect(extraccion).toMatchObject({ estado: 'por_confirmar', progreso: 100, error: null });
      expect(Number(extraccion.confianzaPromedio)).toBeCloseTo(
        (0.95 + 0.62 + 0.71 + 0.97 + 0.93 + 0.96) / 6,
        3,
      );
      expect(extraccion.respuestaCruda.zonas).toHaveLength(ZONAS.length);
      expect(progresos).toEqual([
        ['procesando', 0],
        ['procesando', 48],
      ]);

      const leidos = await campos(extraccion);
      expect(leidos.map((c) => [c.campo, c.valorLeido, Number(c.confianza), c.estado])).toEqual([
        ['diagnostico', 'Diagnóstico ficticio', 0.95, 'propuesto'],
        ['fecha_inicio', '01/02/2020', 0.62, 'propuesto'],
        ['peso_nacer', '3,2', 0.71, 'propuesto'],
        ['tipo_parto_cesarea', 'true', 0.93, 'propuesto'],
        ['tipo_parto_no_se', 'false', 0.96, 'propuesto'],
        ['tipo_parto_vaginal', 'false', 0.97, 'propuesto'],
      ]);
      expect(leidos[0]).toMatchObject({
        seccion: 'informacion_medica',
        rutaDato: '/diagnostico',
        pagina: 1,
        coordenadas: ZONAS[0].caja,
      });
      await eventos.esperarEventos();
    } finally {
      quitar.forEach((q) => q());
    }
    expect(vistos.map(([n]) => n)).toEqual(['creada', 'lista']);
    expect(vistos[1][1]).toMatchObject({ solicitudId: solicitud.id, documentoId: documento.id });
  });

  test('una zona de una página que no se capturó queda vacía y dudosa', async () => {
    await plantillaPara();
    const documento = await documentoConPaginas({ solicitud, paginas: 1 });
    const extraccion = await encolar(documento);
    await cola.procesarPendientes();
    const peso = (await campos(extraccion)).find((c) => c.campo === 'peso_nacer');
    expect(peso).toMatchObject({ valorLeido: null, estado: 'propuesto' });
    expect(Number(peso.confianza)).toBe(0);
  });

  test('cancelar antes del proceso: el trabajo termina sin campos', async () => {
    await plantillaPara();
    const documento = await documentoConPaginas({ solicitud });
    const extraccion = await encolar(documento);
    const cancelada = await db.sequelize.transaction((transaction) =>
      cancelarExtraccion({ documentoId: documento.id, transaction }),
    );
    expect(cancelada).toBe(true);
    await cola.procesarPendientes();
    await extraccion.reload();
    expect(extraccion.estado).toBe('cancelada');
    expect(await db.CampoExtraido.count()).toBe(0);
    // Ya no hay nada en curso que cancelar.
    expect(
      await db.sequelize.transaction((transaction) =>
        cancelarExtraccion({ documentoId: documento.id, transaction }),
      ),
    ).toBe(false);
  });

  test('cancelar durante el proceso: se detiene entre páginas', async () => {
    await plantillaPara();
    const documento = await documentoConPaginas({ solicitud });
    const extraccion = await encolar(documento);
    const procesar = jest.spyOn(simulado, 'procesar').mockImplementationOnce(async (entrada) => {
      await db.Extraccion.update({ estado: 'cancelada' }, { where: { id: extraccion.id } });
      return simuladoReal(entrada);
    });
    await cola.procesarPendientes();
    await extraccion.reload();
    expect(extraccion.estado).toBe('cancelada');
    expect(procesar).toHaveBeenCalledTimes(1);
    expect(await db.CampoExtraido.count()).toBe(0);
  });

  test('un reintento reemplaza los campos propuestos sin duplicarlos', async () => {
    await plantillaPara();
    const documento = await documentoConPaginas({ solicitud });
    const extraccion = await encolar(documento);
    await cola.procesarPendientes();
    expect(await db.CampoExtraido.count()).toBe(ZONAS.length);

    // Un intento que se cortó después de escribir: vuelve a procesando y se reintenta.
    await extraccion.update({ estado: 'procesando' });
    await cola.enviar(trabajos.OCR_PROCESAR, { extraccionId: extraccion.id });
    await cola.procesarPendientes();
    expect(await db.CampoExtraido.count()).toBe(ZONAS.length);

    // Ya terminada, otro mensaje del mismo trabajo no hace nada.
    await cola.enviar(trabajos.OCR_PROCESAR, { extraccionId: extraccion.id });
    await cola.procesarPendientes();
    expect((await extraccion.reload()).estado).toBe('por_confirmar');
  });

  test('si el motor falla o falta una página, queda fallida con un código', async () => {
    await plantillaPara();
    const documento = await documentoConPaginas({ solicitud });
    jest
      .spyOn(simulado, 'procesar')
      .mockRejectedValueOnce(new Error('texto leído que no va al log'));
    const extraccion = await encolar(documento);
    await cola.procesarPendientes();
    expect(await extraccion.reload()).toMatchObject({ estado: 'fallida', error: 'ERROR_MOTOR' });

    const sinArchivo = await f.crearDocumento({ solicitud, tipo: 'fotos_condicion' });
    await plantillaPara('fotos_condicion');
    const otra = await encolar(sinArchivo);
    await cola.procesarPendientes();
    expect(await otra.reload()).toMatchObject({ estado: 'fallida', error: 'PAGINA_NO_DISPONIBLE' });
  });

  test('integración con el agente 06: finalizar un documento con plantilla encola el OCR', async () => {
    await plantillaPara('fotos_condicion');
    const familia = await f.crearFamilia();
    const caso = await f.crearSolicitud({ paciente: familia.paciente, estado: 'CAPTURA' });
    const t = await tokenPara(familia.usuario);
    const creado = await api()
      .post(`/api/v1/solicitudes/${caso.id}/documentos`)
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ tipoDocumentoId: await f.idTipoDocumento('fotos_condicion') })
      .expect(201);
    for (const n of [1, 2]) {
      await api()
        .post(`/api/v1/documentos/${creado.body.id}/paginas`)
        .set('Authorization', `Bearer ${t}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .attach('archivo', await imagen(n), 'hoja.png')
        .expect(201);
    }
    const final = await api()
      .post(`/api/v1/documentos/${creado.body.id}/finalizar`)
      .set('Authorization', `Bearer ${t}`)
      .send({ paginasDeclaradas: 2 })
      .expect(200);
    expect(final.body.extraccion).toMatchObject({ estado: 'en_cola' });
    await cola.procesarPendientes();
    const extraccion = await db.Extraccion.findOne({ where: { documentoId: creado.body.id } });
    expect(extraccion.estado).toBe('por_confirmar');
  });
});

describe('esquemaZonasOcr', () => {
  const base = ZONAS[0];

  test('acepta las zonas de ejemplo', () => {
    expect(esquemaZonasOcr.parse(ZONAS)).toHaveLength(ZONAS.length);
  });

  test.each([
    ['sin tipo firma', [{ ...base, tipo: 'firma' }]],
    ['caja fuera de la página', [{ ...base, caja: { x: 0.8, y: 0.1, ancho: 0.4, alto: 0.1 } }]],
    ['campo repetido', [base, { ...base, rutaDato: '/otro' }]],
    ['formato fuera de una fecha', [{ ...base, formato: 'DD/MM/AAAA' }]],
    ['grupo sin valor', [{ ...ZONAS[3], valor: undefined }]],
    ['grupo con datos distintos', [ZONAS[3], { ...ZONAS[4], rutaDato: '/otraPregunta' }]],
    ['sección sin formulario', [{ ...base, seccion: 'consentimientos' }]],
    ['ruta que no es JSON Pointer', [{ ...base, rutaDato: 'diagnostico' }]],
  ])('rechaza: %s', (_nombre, zonas) => {
    expect(esquemaZonasOcr.safeParse(zonas).success).toBe(false);
  });
});

describe('GET /health', () => {
  test('incluye el chequeo del OCR', async () => {
    const res = await api().get('/health').expect(200);
    expect(res.body.chequeos.ocr).toEqual({ ok: true, ms: expect.any(Number) });
  });
});
