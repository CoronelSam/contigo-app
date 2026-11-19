'use strict';

const db = require('../../src/models');
const semillas = require('../../src/db/semillas');
const { limpiarBase } = require('../helpers/db');

const { sequelize } = db;
const consultar = (sql, replacements) =>
  sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

/** Hechos que el motor de reglas (agente 10) expone a las condiciones. */
const HECHOS = [
  'edadAnios',
  'edadMeses',
  'sexo',
  'departamento',
  'municipio',
  'tiposAtencion',
  'condiciones',
  'cirugiasPrevias',
  'ayudasTecnicas',
  'caminaSolo',
  'especialidadesRequeridas',
  'proveedoresLocalesEnDepartamento',
  'proveedoresLocalesEnPais',
  'documentosEvaluacion',
  'tieneCertificacionMedica',
];

const BLOQUES = [
  'informacion_medica',
  'embarazo_nacimiento',
  'antecedentes_medicos',
  'medicamentos_alergias',
  'crecimiento_movilidad',
  'educacion',
  'profesional_salud',
  'consentimientos',
];

function variablesDe(condicion) {
  if (Array.isArray(condicion)) return condicion.flatMap(variablesDe);
  if (condicion && typeof condicion === 'object') {
    return Object.entries(condicion).flatMap(([op, arg]) =>
      op === 'var' ? [Array.isArray(arg) ? arg[0] : arg] : variablesDe(arg),
    );
  }
  return [];
}

describe('seeders base', () => {
  beforeAll(() => limpiarBase());

  test('4 roles fijos con sus permisos', async () => {
    const roles = await db.Rol.findAll({ include: ['permisos'] });
    const porRol = Object.fromEntries(
      roles.map((r) => [r.codigo, r.permisos.map((p) => p.codigo).sort()]),
    );
    expect(Object.keys(porRol).sort()).toEqual([
      'administrador',
      'coordinador',
      'familia',
      'voluntario',
    ]);
    expect(await db.Permiso.count()).toBe(semillas.PERMISOS.permisos.length);

    for (const permisos of Object.values(porRol)) {
      expect(permisos).toEqual(
        expect.arrayContaining(['perfil.gestionar', 'catalogo.leer', 'notificacion.leer']),
      );
    }
    expect(porRol.familia).toEqual(expect.arrayContaining(['solicitud.crear', 'solicitud.enviar']));
    expect(porRol.familia.some((p) => p.startsWith('admin.'))).toBe(false);
    expect(porRol.voluntario).toEqual(expect.arrayContaining(['voluntario.casos', 'ocr.revisar']));
    expect(porRol.coordinador).toEqual(
      expect.arrayContaining(['solicitud.confirmar_destino', 'documento.validar']),
    );
    // El administrador no abre expedientes clínicos.
    expect(porRol.administrador).not.toContain('solicitud.leer');
    expect(porRol.administrador).not.toContain('paciente.leer');
    expect(porRol.administrador).toContain('admin.reportes');
  });

  test('18 departamentos y 298 municipios con códigos coherentes', async () => {
    expect(await db.Departamento.count()).toBe(18);
    expect(await db.Municipio.count()).toBe(298);
    const incoherentes = await consultar(
      'SELECT codigo FROM municipios WHERE left(codigo, 2) <> departamento_codigo',
    );
    expect(incoherentes).toEqual([]);
    const fm = await db.Departamento.findByPk('08', { include: ['municipios'] });
    expect(fm.nombre).toBe('Francisco Morazán');
    expect(fm.municipios).toHaveLength(28);
    expect((await db.Municipio.findByPk('1701')).nombre).toBe('Nacaome');
  });

  test('catálogos bilingües con los 7 tipos y especialidades válidas', async () => {
    const tipos = await consultar('SELECT DISTINCT tipo FROM catalogos_items ORDER BY tipo');
    expect(tipos.map((t) => t.tipo)).toEqual([
      'ayuda_tecnica',
      'condicion_medica',
      'especialidad_medica',
      'grado_escolar',
      'parentesco',
      'terapia',
      'tipo_atencion',
    ]);
    const sinTraduccion = await db.CatalogoItem.count({ where: { etiquetaEn: '' } });
    expect(sinTraduccion).toBe(0);
    expect(
      await db.CatalogoItem.findOne({ where: { tipo: 'grado_escolar', codigo: 'no_aplica' } }),
    ).not.toBeNull();

    const especialidades = new Set(
      (await db.CatalogoItem.findAll({ where: { tipo: 'especialidad_medica' } })).map(
        (e) => e.codigo,
      ),
    );
    const tiposAtencion = await db.CatalogoItem.findAll({ where: { tipo: 'tipo_atencion' } });
    for (const t of tiposAtencion) {
      expect(Array.isArray(t.metadatos.especialidades)).toBe(true);
      for (const e of t.metadatos.especialidades) expect(especialidades.has(e)).toBe(true);
    }
  });

  test('requisitos por ruta sin mezclar paquetes y sin los "por confirmar"', async () => {
    const requisitos = await db.RequisitoRuta.findAll({ include: ['tipoDocumento'] });
    const porRuta = {};
    for (const r of requisitos) (porRuta[r.ruta] ??= []).push(r.tipoDocumento.codigo);
    expect(porRuta.EVALUACION.sort()).toEqual([
      'certificacion_medica',
      'fotos_condicion',
      'radiografias_informes',
    ]);
    expect(porRuta.INTERNACIONAL).toHaveLength(6);
    expect(porRuta.MEXICO).toHaveLength(5);
    expect(porRuta.HONDURAS).toBeUndefined();
    expect(porRuta.MEXICO.some((c) => porRuta.INTERNACIONAL.includes(c))).toBe(false);
    expect(await db.TipoDocumento.findOne({ where: { codigo: 'partida_nacimiento' } })).toBeNull();

    for (const r of requisitos) {
      for (const s of r.cubiertoPorSecciones) expect(BLOQUES).toContain(s);
    }
    const solicitud = requisitos.find((r) => r.tipoDocumento.codigo === 'solicitud_internacional');
    expect(solicitud.cubiertoPorSecciones).toEqual(['informacion_medica', 'profesional_salud']);
  });

  test('textos de consentimiento de prueba en es y en', async () => {
    const textos = await db.TextoConsentimiento.findAll();
    expect(textos).toHaveLength(8);
    for (const t of textos) expect(t.cuerpo).toMatch(/TEXTO DE PRUEBA|TEST TEXT/);
  });

  test('configuración base con los valores seguros de las decisiones pendientes', async () => {
    const config = Object.fromEntries(
      (await db.Configuracion.findAll()).map((c) => [c.clave, c.valor]),
    );
    expect(config['solicitudes.permitir_multiples_abiertas']).toBe(false);
    expect(config['ocr.umbral_confianza']).toBe(0.8);
    expect(config['paquete.bloquear_firmas_pendientes']).toBe(true);
    expect(config['auth.exigir_correo_verificado']).toBe(false);
    expect(config['consentimientos.requieren_firma']).toHaveLength(4);
    expect(config['contactos.oficiales'].dePrueba).toBe(true);
    expect(config['contactos.oficiales'].correo).toMatch(/\.test$/);
    expect(config['ayuda.articulos'].es).toHaveLength(config['ayuda.articulos'].en.length);
  });

  test('reglas de ruta versión 1 activas y solo con hechos conocidos', async () => {
    const reglas = await db.ReglaRuta.findAll({ order: [['prioridad', 'ASC']] });
    expect(reglas.map((r) => [r.version, r.activa, r.rutaSugerida])).toEqual([
      [1, true, 'HONDURAS'],
      [1, true, 'POR_EVALUAR'],
    ]);
    for (const r of reglas) {
      for (const v of variablesDe(r.condicion)) expect(HECHOS).toContain(v);
    }
  });

  test('limpiarBase vacía los datos y restaura los datos base modificados', async () => {
    await db.Configuracion.update(
      { valor: true },
      { where: { clave: 'solicitudes.permitir_multiples_abiertas' } },
    );
    await db.CatalogoItem.destroy({ where: { tipo: 'parentesco' } });
    await db.Usuario.create({
      correo: 'temporal@pruebas.test',
      nombres: 'Temporal',
      apellidos: 'Prueba',
      rolId: (await db.Rol.findOne({ where: { codigo: 'familia' } })).id,
    });

    await limpiarBase();

    expect(await db.Usuario.count()).toBe(0);
    expect(await db.CatalogoItem.count({ where: { tipo: 'parentesco' } })).toBe(10);
    const permitir = await db.Configuracion.findByPk('solicitudes.permitir_multiples_abiertas');
    expect(permitir.valor).toBe(false);
    expect(await db.Rol.count()).toBe(4);
    expect(await db.Municipio.count()).toBe(298);
    const [{ n }] = await consultar("SELECT nextval('solicitud_codigo_seq') AS n");
    expect(Number(n)).toBe(1);
  });
});
