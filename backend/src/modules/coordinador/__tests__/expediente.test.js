'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { registrarBitacora } = require('../../../core/auditoria');

const SECCIONES_EVALUACION = [
  'informacion_medica',
  'antecedentes_medicos',
  'crecimiento_movilidad',
];
const TODAS = [
  'informacion_medica',
  'embarazo_nacimiento',
  'antecedentes_medicos',
  'medicamentos_alergias',
  'crecimiento_movilidad',
  'educacion',
];
const DOCUMENTOS_MEXICO = [
  'informacion_financiera',
  'seguros',
  'consentimiento_ortopedico',
  'inmunizaciones',
  'registro_domicilio_croquis',
];

let coordinador;
let tc;
let familia;

beforeEach(async () => {
  await limpiarBase();
  coordinador = await f.crearUsuario({ rol: 'coordinador' });
  tc = await tokenPara(coordinador);
  familia = await f.crearFamilia();
});

const get = (ruta, t = tc) => api().get(`/api/v1${ruta}`).set('Authorization', `Bearer ${t}`);
const confirmar = (s, cuerpo = {}) =>
  api()
    .post(`/api/v1/solicitudes/${s.id}/confirmar-completo`)
    .set('Authorization', `Bearer ${tc}`)
    .send(cuerpo);

/** Lo que pide la etapa de evaluación, completo y validado. */
async function completarEvaluacion(solicitud) {
  for (const seccion of SECCIONES_EVALUACION) {
    await f.crearSeccion({ solicitud, seccion, estado: 'completa' });
  }
  for (const tipo of ['fotos_condicion', 'radiografias_informes']) {
    await f.crearDocumento({ solicitud, tipo, estado: 'VALIDADO' });
  }
  const certificacion = await f.crearDocumento({
    solicitud,
    tipo: 'certificacion_medica',
    estado: 'VALIDADO',
  });
  await db.ProfesionalSalud.create({
    solicitudId: solicitud.id,
    nombre: 'Dra. Ficticia',
    especialidad: 'ortopedia_pediatrica',
    telefono: '+50400000000',
    documentoCertificacionId: certificacion.id,
  });
}

describe('GET /solicitudes/:id/historia-clinica', () => {
  test('resuelve las etiquetas de catálogo en el idioma del coordinador y registra el acceso', async () => {
    const s = await f.crearSolicitud({ paciente: familia.paciente, estado: 'EN_REVISION' });
    await f.crearSeccion({
      solicitud: s,
      seccion: 'informacion_medica',
      estado: 'incompleta',
      datos: { diagnostico: 'Diagnóstico ficticio', atencionSolicitada: 'pie_zambo' },
    });
    await f.crearSeccion({
      solicitud: s,
      seccion: 'crecimiento_movilidad',
      datos: { sentarse: 'logrado', ayudasTecnicas: ['andadera', 'muletas'] },
    });
    await db.ProfesionalSalud.create({ solicitudId: s.id, especialidad: 'ortopedia_pediatrica' });

    const res = await get(`/solicitudes/${s.id}/historia-clinica`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.secciones.map((x) => x.codigo)).toEqual(TODAS);
    const medica = res.body.secciones[0];
    expect(medica).toMatchObject({
      titulo: 'Información médica',
      estado: 'incompleta',
      version: 1,
    });
    expect(medica.datos).toEqual({
      diagnostico: 'Diagnóstico ficticio',
      atencionSolicitada: { codigo: 'pie_zambo', etiqueta: expect.any(String) },
    });
    const movilidad = res.body.secciones.find((x) => x.codigo === 'crecimiento_movilidad');
    expect(movilidad.datos.ayudasTecnicas).toEqual([
      { codigo: 'andadera', etiqueta: 'Andadera' },
      { codigo: 'muletas', etiqueta: 'Muletas' },
    ]);
    expect(res.body.secciones.find((x) => x.codigo === 'educacion')).toMatchObject({
      estado: 'vacia',
      version: 0,
      datos: {},
    });
    expect(res.body.profesional.especialidad).toEqual({
      codigo: 'ortopedia_pediatrica',
      etiqueta: 'Ortopedia pediátrica',
    });
    expect(res.body.consentimientos).toHaveLength(4);
    expect(await db.RegistroAcceso.findOne()).toMatchObject({
      usuarioId: coordinador.id,
      solicitudId: s.id,
      recurso: 'historia_clinica',
    });

    const ingles = await tokenPara(await f.crearUsuario({ rol: 'coordinador', idioma: 'en' }));
    const en = await get(`/solicitudes/${s.id}/historia-clinica`, ingles).expect(200);
    expect(en.body.secciones[0].titulo).toBe('Medical information');
    expect(en.body.secciones[4].datos.ayudasTecnicas[0].etiqueta).toBe('Walker');
  });
});

describe('GET /solicitudes/:id/bitacora', () => {
  test('cambios con antes, después y autor; con incluirAccesos, los accesos', async () => {
    const s = await f.crearSolicitud({ paciente: familia.paciente, estado: 'EN_REVISION' });
    await registrarBitacora({
      accion: 'pacientes.actualizar',
      entidad: 'pacientes',
      solicitudId: s.id,
      antes: { direccion: 'Antes (ficticia)' },
      despues: { direccion: 'Después (ficticia)' },
    });
    await get(`/solicitudes/${s.id}/historia-clinica`).expect(200);

    const sin = await get(`/solicitudes/${s.id}/bitacora`).expect(200);
    expect(sin.body).not.toHaveProperty('accesos');
    expect(sin.body.datos).toEqual([
      expect.objectContaining({
        accion: 'pacientes.actualizar',
        antes: { direccion: 'Antes (ficticia)' },
        despues: { direccion: 'Después (ficticia)' },
      }),
    ]);
    const con = await get(`/solicitudes/${s.id}/bitacora?incluirAccesos=true`).expect(200);
    expect(con.body.accesos.datos).toEqual([
      expect.objectContaining({
        recurso: 'historia_clinica',
        usuario: expect.objectContaining({ id: coordinador.id, rol: 'coordinador' }),
      }),
    ]);
  });
});

describe('validación y confirmación (45)', () => {
  test('etapa de evaluación: bloques en el orden de la lista única y faltantes', async () => {
    const s = await f.crearSolicitud({ paciente: familia.paciente, estado: 'EN_REVISION' });
    await f.crearDocumento({ solicitud: s, tipo: 'fotos_condicion', estado: 'CAPTURADO' });

    const res = await get(`/solicitudes/${s.id}/validacion`).expect(200);
    expect(res.body).toMatchObject({
      estado: 'EN_REVISION',
      etapa: 'evaluacion',
      listoParaConfirmar: false,
      puedeConfirmar: false,
      destinoAlConfirmar: 'EN_EVALUACION',
    });
    expect(res.body.bloques.map((b) => `${b.tipo}:${b.codigo}`)).toEqual([
      'seccion:informacion_medica',
      'seccion:embarazo_nacimiento',
      'seccion:antecedentes_medicos',
      'seccion:medicamentos_alergias',
      'seccion:crecimiento_movilidad',
      'seccion:educacion',
      'profesional:profesional_salud',
      'consentimiento:divulgacion_informacion_medica',
      'consentimiento:marketing',
      'consentimiento:telesalud',
      'consentimiento:condiciones_atencion',
      'documento:fotos_condicion',
      'documento:radiografias_informes',
      'documento:certificacion_medica',
    ]);
    const fotos = res.body.bloques.find((b) => b.codigo === 'fotos_condicion');
    expect(fotos).toMatchObject({
      estado: 'CAPTURADO',
      motivo: 'sin_validar',
      documentoId: expect.any(String),
      acciones: ['validar_documento', 'rechazar_documento', 'pedir_nueva_captura'],
    });
    expect(res.body.bloques.find((b) => b.codigo === 'educacion')).toMatchObject({
      obligatorio: false,
      motivo: null,
    });

    const conFaltantes = await confirmar(s).expect(409);
    expect(conFaltantes.body.codigo).toBe('SOLICITUD_FALTANTES');
    expect(conFaltantes.body.campos).toMatchObject({
      'seccion.informacion_medica': 'FALTA',
      'documento.fotos_condicion': 'SIN_VALIDAR',
      'profesional.profesional_salud': 'FALTA',
    });
    expect((await s.reload()).estado).toBe('EN_REVISION');
  });

  test('confirmar la evaluación: EN_EVALUACION, historial, aviso a la familia y coordinador asignado', async () => {
    const s = await f.crearSolicitud({ paciente: familia.paciente, estado: 'EN_REVISION' });
    await completarEvaluacion(s);
    expect((await get(`/solicitudes/${s.id}/validacion`).expect(200)).body.puedeConfirmar).toBe(
      true,
    );

    const res = await confirmar(s, { nota: 'Revisión completa (prueba)' }).expect(200);
    expect(res.body).toMatchObject({
      estado: 'EN_EVALUACION',
      etapa: 'evaluacion',
      coordinadorId: coordinador.id,
    });
    const historial = await db.HistorialEstado.findOne({ where: { solicitudId: s.id } });
    expect(historial).toMatchObject({
      estadoAnterior: 'EN_REVISION',
      estadoNuevo: 'EN_EVALUACION',
      usuarioId: coordinador.id,
      nota: 'Revisión completa (prueba)',
    });
    const aviso = await db.Notificacion.findOne({ where: { usuarioId: familia.usuario.id } });
    expect(aviso.tipo).toBe('CAMBIO_ESTADO');

    // Ya no está en revisión.
    expect((await confirmar(s).expect(409)).body.codigo).toBe('SOLICITUD_TRANSICION_INVALIDA');
  });

  test('etapa de paquete (México): con todo listo pasa a COMPLETA y conserva el coordinador', async () => {
    const otro = await f.crearUsuario({ rol: 'coordinador' });
    const s = await f.crearSolicitud({
      paciente: familia.paciente,
      estado: 'EN_REVISION',
      rutaDecidida: 'MEXICO',
      paquete: 'MEXICO',
      etapa: 'paquete',
      coordinadorId: otro.id,
    });
    await completarEvaluacion(s);
    const faltan = await get(`/solicitudes/${s.id}/validacion`).expect(200);
    expect(faltan.body).toMatchObject({ etapa: 'paquete', destinoAlConfirmar: 'COMPLETA' });
    expect(faltan.body.faltantes.map((x) => x.codigo)).toEqual(
      expect.arrayContaining(['embarazo_nacimiento', 'seguros', 'telesalud']),
    );
    await confirmar(s).expect(409);

    for (const seccion of TODAS.filter((x) => !SECCIONES_EVALUACION.includes(x))) {
      await f.crearSeccion({ solicitud: s, seccion, estado: 'completa' });
    }
    for (const tipo of DOCUMENTOS_MEXICO) {
      await f.crearDocumento({ solicitud: s, tipo, estado: 'VALIDADO' });
    }
    for (const tipo of [
      'divulgacion_informacion_medica',
      'marketing',
      'telesalud',
      'condiciones_atencion',
    ]) {
      await db.Consentimiento.create({
        solicitudId: s.id,
        tipo,
        decision: 'acepta',
        estadoFirma: 'firmado',
      });
    }
    const res = await confirmar(s).expect(200);
    expect(res.body).toMatchObject({ estado: 'COMPLETA', coordinadorId: otro.id });
  });

  test('desde un estado distinto de EN_REVISION → 409', async () => {
    const s = await f.crearSolicitud({ paciente: familia.paciente, estado: 'CAPTURA' });
    await completarEvaluacion(s);
    const res = await confirmar(s).expect(409);
    expect(res.body.codigo).toBe('SOLICITUD_TRANSICION_INVALIDA');
    expect((await get(`/solicitudes/${s.id}/validacion`).expect(200)).body).toMatchObject({
      puedeConfirmar: false,
      destinoAlConfirmar: null,
    });
  });
});
