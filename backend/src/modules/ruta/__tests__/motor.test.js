'use strict';

const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { construirHechos } = require('../hechos');
const { sugerirRuta } = require('../motor');
const { con, caso, coordinador } = require('./ayudantes');

beforeEach(() => limpiarBase());

/** Edad de un niño nacido hace `anios` años y `meses` meses, hoy. */
function nacidoHace(anios, meses) {
  // Día 1 del mes: así la edad es exacta cualquier día que corra la prueba.
  const [a, m] = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' })
    .split('-')
    .map(Number);
  const total = a * 12 + (m - 1) - (anios * 12 + meses);
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

describe('hechos del expediente', () => {
  test('cada hecho sale de su fuente', async () => {
    const { solicitud } = await caso({
      paciente: { fechaNacimiento: nacidoHace(7, 3), sexo: 'femenino', municipioCodigo: '0801' },
    });
    await f.crearSeccion({
      solicitud,
      seccion: 'informacion_medica',
      datos: {
        atencionSolicitada: 'pie_zambo',
        cirugias: [{ procedimiento: 'Ficticio 1' }, { procedimiento: 'Ficticio 2' }],
      },
    });
    await f.crearSeccion({
      solicitud,
      seccion: 'antecedentes_medicos',
      datos: { condiciones: ['asma', 'anemia'] },
    });
    await f.crearSeccion({
      solicitud,
      seccion: 'crecimiento_movilidad',
      datos: { caminarSolo: 'logrado', ayudasTecnicas: ['andadera'] },
    });
    await f.crearProveedorLocal({
      departamentoCodigo: '08',
      especialidades: ['ortopedia_pediatrica'],
    });
    await f.crearProveedorLocal({
      departamentoCodigo: '05',
      municipioCodigo: '0501',
      especialidades: ['ortopedia_pediatrica'],
    });
    await f.crearProveedorLocal({ departamentoCodigo: '08', especialidades: ['neurocirugia'] });
    await f.crearProveedorLocal({
      departamentoCodigo: '08',
      especialidades: ['ortopedia_pediatrica'],
      activo: false,
    });
    await f.crearDocumento({ solicitud, tipo: 'fotos_condicion', estado: 'VALIDADO' });

    const hechos = await construirHechos(solicitud.id);
    expect(hechos).toEqual({
      edadAnios: 7,
      edadMeses: 87,
      sexo: 'femenino',
      departamento: '08',
      municipio: '0801',
      tiposAtencion: ['pie_zambo'],
      condiciones: ['asma', 'anemia'],
      cirugiasPrevias: 2,
      ayudasTecnicas: ['andadera'],
      caminaSolo: true,
      especialidadesRequeridas: ['ortopedia_pediatrica'],
      proveedoresLocalesEnDepartamento: 1,
      proveedoresLocalesEnPais: 2,
      documentosEvaluacion: {
        fotos_condicion: 'VALIDADO',
        radiografias_informes: 'FALTA',
        certificacion_medica: 'FALTA',
      },
      tieneCertificacionMedica: false,
    });
  });

  test('sin secciones: listas vacías y nada que inventar', async () => {
    const { solicitud } = await caso();
    const hechos = await construirHechos(solicitud.id);
    expect(hechos).toMatchObject({
      tiposAtencion: [],
      especialidadesRequeridas: [],
      cirugiasPrevias: 0,
      caminaSolo: null,
      proveedoresLocalesEnDepartamento: 0,
      proveedoresLocalesEnPais: 0,
    });
  });
});

describe('sugerencia', () => {
  async function reglas(version, lista, activa = true) {
    for (const [i, r] of lista.entries()) {
      await db.ReglaRuta.create({
        version,
        prioridad: r.prioridad ?? (i + 1) * 10,
        nombre: r.nombre,
        condicion: r.condicion,
        rutaSugerida: r.rutaSugerida,
        motivoEs: `Motivo ${r.nombre}`,
        motivoEn: `Reason ${r.nombre}`,
        activa,
      });
    }
  }

  test('la primera regla por prioridad da la ruta; los motivos de todas las que se cumplen', async () => {
    await db.ReglaRuta.destroy({ where: {} });
    await reglas(1, [
      {
        nombre: 'b',
        prioridad: 20,
        condicion: { '>=': [{ var: 'edadAnios' }, 5] },
        rutaSugerida: 'MEXICO',
      },
      {
        nombre: 'a',
        prioridad: 10,
        condicion: { in: ['asma', { var: 'condiciones' }] },
        rutaSugerida: 'INTERNACIONAL',
      },
      {
        nombre: 'c',
        prioridad: 30,
        condicion: { '<': [{ var: 'edadAnios' }, 1] },
        rutaSugerida: 'HONDURAS',
      },
    ]);
    const { solicitud } = await caso({ paciente: { fechaNacimiento: nacidoHace(8, 0) } });
    await f.crearSeccion({
      solicitud,
      seccion: 'antecedentes_medicos',
      datos: { condiciones: ['asma'] },
    });

    const s = await sugerirRuta(solicitud.id);
    expect(s.rutaSugerida).toBe('INTERNACIONAL');
    expect(s.versionReglas).toBe(1);
    expect(s.motivos.map((m) => m.nombre)).toEqual(['a', 'b']);
  });

  test('sin coincidencias, POR_EVALUAR; con las reglas de ejemplo, Honduras si hay proveedor cerca', async () => {
    const { solicitud } = await caso({ paciente: { municipioCodigo: '0801' } });
    await f.crearSeccion({
      solicitud,
      seccion: 'informacion_medica',
      datos: { atencionSolicitada: 'pie_zambo' },
    });
    // Reglas de ejemplo del seed: sin proveedores locales → POR_EVALUAR con su motivo.
    let s = await sugerirRuta(solicitud.id);
    expect(s).toMatchObject({ rutaSugerida: 'POR_EVALUAR', versionReglas: 1 });
    expect(s.motivos.map((m) => m.nombre)).toEqual(['sin_proveedor_local']);

    await f.crearProveedorLocal({
      departamentoCodigo: '08',
      especialidades: ['ortopedia_pediatrica'],
    });
    s = await sugerirRuta(solicitud.id);
    expect(s.rutaSugerida).toBe('HONDURAS');

    await db.ReglaRuta.update({ activa: false }, { where: {} });
    s = await sugerirRuta(solicitud.id);
    expect(s).toMatchObject({ rutaSugerida: 'POR_EVALUAR', versionReglas: null, motivos: [] });
  });

  test('GET /ruta-sugerida devuelve hechos y motivos en el idioma del coordinador y no guarda nada', async () => {
    const { solicitud } = await caso();
    const { token } = await coordinador();
    const res = await con(
      api().get(`/api/v1/solicitudes/${solicitud.id}/ruta-sugerida`),
      token,
    ).expect(200);
    expect(res.body).toMatchObject({ rutaSugerida: 'POR_EVALUAR', versionReglas: 1 });
    expect(res.body.motivos[0].motivo).toMatch(/proveedores locales/);
    expect(res.body.hechos).toHaveProperty('edadAnios');
    expect(await db.Evaluacion.count()).toBe(0);
  });
});
