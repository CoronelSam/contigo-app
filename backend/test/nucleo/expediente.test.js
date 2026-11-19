'use strict';

const db = require('../../src/models');
const f = require('../factories');
const { limpiarBase } = require('../helpers/db');
const {
  estadoExpediente,
  SECCIONES,
  CODIGOS_SECCIONES_JSON,
} = require('../../src/core/expediente');

const TIPOS_CONSENTIMIENTO = [
  'divulgacion_informacion_medica',
  'marketing',
  'telesalud',
  'condiciones_atencion',
];

const codigos = (faltantes, tipo) =>
  faltantes
    .filter((x) => x.tipo === tipo)
    .map((x) => `${x.codigo}:${x.motivo}`)
    .sort();

async function completarSecciones(solicitud, lista = CODIGOS_SECCIONES_JSON) {
  for (const seccion of lista) await f.crearSeccion({ solicitud, seccion, estado: 'completa' });
}

async function completarProfesional(solicitud) {
  const certificacion = await f.crearDocumento({
    solicitud,
    tipo: 'certificacion_medica',
    estado: 'VALIDADO',
  });
  await db.ProfesionalSalud.create({
    solicitudId: solicitud.id,
    nombre: 'Dra. Prueba',
    especialidad: 'ortopedia_pediatrica',
    telefono: '+50400000000',
    documentoCertificacionId: certificacion.id,
  });
}

async function decidirConsentimientos(solicitud, estadoFirma = 'firmado') {
  for (const tipo of TIPOS_CONSENTIMIENTO) {
    await db.Consentimiento.create({
      solicitudId: solicitud.id,
      tipo,
      decision: 'acepta',
      estadoFirma,
    });
  }
}

describe('estado del expediente', () => {
  beforeEach(() => limpiarBase());

  test('expediente nuevo en evaluación: pide lo de la etapa y no lo del paquete', async () => {
    const s = await f.crearSolicitud({ estado: 'CAPTURA', modalidad: 'fotos' });
    const e = await estadoExpediente(s.id);

    expect(e.secciones.map((x) => x.codigo)).toEqual(SECCIONES.map((x) => x.codigo));
    expect(codigos(e.faltantes, 'seccion')).toEqual([
      'antecedentes_medicos:falta',
      'crecimiento_movilidad:falta',
      'informacion_medica:falta',
    ]);
    expect(codigos(e.faltantes, 'profesional')).toEqual(['profesional_salud:falta']);
    expect(codigos(e.faltantes, 'documento')).toEqual([
      'certificacion_medica:falta',
      'fotos_condicion:falta',
      'radiografias_informes:falta',
    ]);
    expect(codigos(e.faltantes, 'consentimiento')).toEqual([]);
    expect(e.documentos).toHaveLength(3);
    expect(e.rutasRequisitos).toEqual(['EVALUACION']);
    expect(e.listoParaConfirmar).toBe(false);
  });

  test('con lo de evaluación completo y validado queda listo para confirmar', async () => {
    const s = await f.crearSolicitud({ estado: 'EN_REVISION', modalidad: 'fotos' });
    await completarSecciones(s, [
      'informacion_medica',
      'antecedentes_medicos',
      'crecimiento_movilidad',
    ]);
    await completarProfesional(s);
    await f.crearDocumento({ solicitud: s, tipo: 'fotos_condicion', estado: 'VALIDADO' });
    await f.crearDocumento({ solicitud: s, tipo: 'radiografias_informes', estado: 'VALIDADO' });

    const e = await estadoExpediente(s.id);
    expect(e.faltantes).toEqual([]);
    expect(e.profesional).toEqual({ estado: 'completa', obligatorio: true });
    expect(e.listoParaConfirmar).toBe(true);
  });

  test('distingue documento rechazado, sin validar y con OCR sin revisar', async () => {
    const s = await f.crearSolicitud({ estado: 'EN_REVISION', modalidad: 'fotos' });
    await f.crearDocumento({ solicitud: s, tipo: 'fotos_condicion', estado: 'RECHAZADO' });
    await f.crearDocumento({ solicitud: s, tipo: 'radiografias_informes', estado: 'CAPTURADO' });
    const certificacion = await f.crearDocumento({
      solicitud: s,
      tipo: 'certificacion_medica',
      estado: 'CAPTURADO',
    });
    const extraccion = await f.crearExtraccion({
      documento: certificacion,
      estado: 'por_confirmar',
    });

    let e = await estadoExpediente(s.id);
    expect(codigos(e.faltantes, 'documento')).toEqual([
      'certificacion_medica:ocr_sin_revisar',
      'fotos_condicion:rechazado',
      'radiografias_informes:sin_validar',
    ]);
    expect(e.documentos.find((d) => d.codigo === 'certificacion_medica').extraccion).toMatchObject({
      estado: 'por_confirmar',
    });

    await extraccion.update({ estado: 'confirmada' });
    e = await estadoExpediente(s.id);
    expect(codigos(e.faltantes, 'documento')).toContain('certificacion_medica:sin_validar');
  });

  test('en la app, el formulario internacional se cubre con las secciones', async () => {
    const enApp = await f.crearSolicitud({
      estado: 'PAQUETE_EXTERIOR',
      rutaDecidida: 'INTERNACIONAL',
      modalidad: 'app',
    });
    await completarSecciones(enApp);
    await completarProfesional(enApp);
    let e = await estadoExpediente(enApp.id);
    expect(e.rutasRequisitos).toEqual(['EVALUACION', 'INTERNACIONAL']);
    expect(e.documentos).toHaveLength(9);
    const solicitudInternacional = e.documentos.find((d) => d.codigo === 'solicitud_internacional');
    expect(solicitudInternacional).toMatchObject({ cubiertoPorFormulario: true, cumplido: true });
    expect(codigos(e.faltantes, 'documento')).not.toContain('solicitud_internacional:falta');
    expect(codigos(e.faltantes, 'documento')).not.toContain('cuestionario_historia_clinica:falta');

    const enFotos = await f.crearSolicitud({
      estado: 'PAQUETE_EXTERIOR',
      rutaDecidida: 'INTERNACIONAL',
      modalidad: 'fotos',
    });
    await completarSecciones(enFotos);
    e = await estadoExpediente(enFotos.id);
    expect(codigos(e.faltantes, 'documento')).toContain('solicitud_internacional:falta');
  });

  test('las firmas pendientes bloquean el paquete solo si la configuración lo pide', async () => {
    const s = await f.crearSolicitud({
      estado: 'EN_REVISION',
      rutaDecidida: 'MEXICO',
      modalidad: 'app',
    });
    expect(s.etapa).toBe('evaluacion');
    await s.update({ etapa: 'paquete' });
    await completarSecciones(s);
    await completarProfesional(s);
    await decidirConsentimientos(s, 'pendiente');
    for (const tipo of [
      'fotos_condicion',
      'radiografias_informes',
      'informacion_financiera',
      'seguros',
      'consentimiento_ortopedico',
      'inmunizaciones',
      'registro_domicilio_croquis',
    ]) {
      await f.crearDocumento({ solicitud: s, tipo, estado: 'VALIDADO' });
    }

    let e = await estadoExpediente(s.id);
    expect(codigos(e.faltantes, 'consentimiento')).toHaveLength(4);
    expect(e.faltantes.every((x) => x.motivo === 'firma_pendiente')).toBe(true);
    expect(e.listoParaConfirmar).toBe(false);

    await db.Configuracion.update(
      { valor: false },
      { where: { clave: 'paquete.bloquear_firmas_pendientes' } },
    );
    e = await estadoExpediente(s.id);
    expect(e.faltantes).toHaveLength(4);
    expect(e.listoParaConfirmar).toBe(true);

    await db.Configuracion.update(
      { valor: ['divulgacion_informacion_medica'] },
      { where: { clave: 'consentimientos.requieren_firma' } },
    );
    e = await estadoExpediente(s.id);
    expect(codigos(e.faltantes, 'consentimiento')).toEqual([
      'divulgacion_informacion_medica:firma_pendiente',
    ]);
  });

  test('con ruta Honduras se agregan los requisitos de Honduras', async () => {
    const s = await f.crearSolicitud({ estado: 'EN_EVALUACION', rutaDecidida: 'HONDURAS' });
    await db.RequisitoRuta.create({
      ruta: 'HONDURAS',
      tipoDocumentoId: await f.idTipoDocumento('inmunizaciones'),
    });
    const e = await estadoExpediente(s.id);
    expect(e.rutasRequisitos).toEqual(['EVALUACION', 'HONDURAS']);
    expect(e.documentos.map((d) => d.codigo)).toContain('inmunizaciones');
  });

  test('una solicitud inexistente responde 404', async () => {
    await expect(estadoExpediente('7d4f3c0e-6f1a-4b8e-9a51-2a3c4d5e6f70')).rejects.toMatchObject({
      status: 404,
    });
  });
});
