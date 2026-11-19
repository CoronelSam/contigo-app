'use strict';

const db = require('../../src/models');
const f = require('../factories');
const { limpiarBase } = require('../helpers/db');

const { sequelize } = db;
const NOMBRES_MODELOS = Object.keys(db).filter(
  (k) => !['sequelize', 'Sequelize', 'DataTypes'].includes(k),
);

const consultar = (sql, replacements) =>
  sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

describe('esquema de la base', () => {
  beforeEach(() => limpiarBase());

  test('existen las 43 tablas y un modelo por tabla', async () => {
    const tablas = await consultar(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'Sequelize%'",
    );
    expect(tablas).toHaveLength(43);
    expect(NOMBRES_MODELOS).toHaveLength(43);
    const tablasModelos = NOMBRES_MODELOS.map((n) => db[n].getTableName()).sort();
    expect(tablasModelos).toEqual(tablas.map((t) => t.tablename).sort());
  });

  test('cada modelo consulta su tabla con todas sus asociaciones', async () => {
    for (const nombre of NOMBRES_MODELOS) {
      const modelo = db[nombre];
      const include = Object.keys(modelo.associations).map((as) => ({ association: as }));
      await expect(modelo.findAll({ limit: 1, include })).resolves.toEqual(expect.any(Array));
    }
  });

  test('una solicitud carga paciente, tutores, documentos con páginas e historial', async () => {
    const familia = await f.crearFamilia();
    const solicitud = await f.crearSolicitud({ paciente: familia.paciente, estado: 'CAPTURA' });
    await f.crearDocumento({ solicitud, paginas: 2 });
    await db.HistorialEstado.create({
      solicitudId: solicitud.id,
      estadoNuevo: 'BORRADOR',
      usuarioId: familia.usuario.id,
    });

    const cargada = await db.Solicitud.findByPk(solicitud.id, {
      include: [
        { association: 'paciente', include: ['tutores', 'municipio'] },
        { association: 'documentos', include: ['paginas', 'tipoDocumento'] },
        'historial',
      ],
    });
    expect(cargada.paciente.tutores[0].id).toBe(familia.tutor.id);
    expect(cargada.paciente.municipio.nombre).toBe('Distrito Central');
    expect(cargada.documentos[0].paginas).toHaveLength(2);
    expect(cargada.documentos[0].tipoDocumento.codigo).toBe('fotos_condicion');
    expect(cargada.historial).toHaveLength(1);
  });

  test('la búsqueda por nombre ignora acentos y mayúsculas (trigram)', async () => {
    const familia = await f.crearFamilia();
    const jose = await f.crearPaciente({
      nombres: 'José Ángel',
      apellidoPaterno: 'Núñez',
      apellidoMaterno: null,
      creadoPor: familia.usuario.id,
    });
    await f.crearPaciente({ nombres: 'María', apellidoPaterno: 'López' });

    const porSimilitud = await consultar(
      'SELECT id FROM pacientes WHERE lower(f_unaccent(:q)) <% nombre_busqueda',
      { q: 'jose angel nunez' },
    );
    expect(porSimilitud.map((p) => p.id)).toEqual([jose.id]);

    const porFragmento = await consultar(
      "SELECT id FROM pacientes WHERE nombre_busqueda ILIKE '%' || lower(f_unaccent(:q)) || '%'",
      { q: 'NUÑEZ' },
    );
    expect(porFragmento.map((p) => p.id)).toEqual([jose.id]);

    const [indice] = await consultar(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'pacientes_nombre_busqueda_trgm'",
    );
    expect(indice.indexdef).toContain('gin_trgm_ops');
  });

  test('la columna generada nombre_busqueda no se puede escribir', async () => {
    await expect(
      sequelize.query(
        "INSERT INTO pacientes (nombres, apellido_paterno, fecha_nacimiento, sexo, municipio_codigo, nombre_busqueda) VALUES ('A', 'B', '2016-01-01', 'femenino', '0801', 'x')",
      ),
    ).rejects.toThrow(/nombre_busqueda/);
  });

  test('la secuencia del código de caso entrega números consecutivos', async () => {
    const [{ a }] = await consultar("SELECT nextval('solicitud_codigo_seq') AS a");
    const [{ b }] = await consultar("SELECT nextval('solicitud_codigo_seq') AS b");
    expect(Number(b)).toBe(Number(a) + 1);
  });

  test('solo puede haber un documento vigente por solicitud y tipo', async () => {
    const solicitud = await f.crearSolicitud({ estado: 'CAPTURA' });
    const primero = await f.crearDocumento({ solicitud, paginas: 0 });
    await expect(f.crearDocumento({ solicitud, paginas: 0 })).rejects.toMatchObject({
      name: 'SequelizeUniqueConstraintError',
    });
    await primero.update({ vigente: false });
    await expect(
      f.crearDocumento({ solicitud, paginas: 0, version: 2, reemplazaA: primero.id }),
    ).resolves.toBeDefined();
  });

  test('las páginas de un documento se pueden reordenar dentro de una transacción', async () => {
    const documento = await f.crearDocumento({ paginas: 2 });
    const [p1, p2] = await db.DocumentoPagina.findAll({
      where: { documentoId: documento.id },
      order: [['orden', 'ASC']],
    });
    await sequelize.transaction(async (transaction) => {
      await p1.update({ orden: 2 }, { transaction });
      await p2.update({ orden: 1 }, { transaction });
    });
    await p1.reload();
    expect(p1.orden).toBe(2);
    await expect(
      db.DocumentoPagina.update({ orden: 1 }, { where: { id: p1.id } }),
    ).rejects.toThrow();
  });

  test('una sola asignación activa por voluntario y caso, y una sola evaluación vigente', async () => {
    const solicitud = await f.crearSolicitud({ estado: 'CAPTURA' });
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    const asignacion = await f.crearAsignacion({ solicitud, voluntario });
    await expect(f.crearAsignacion({ solicitud, voluntario })).rejects.toMatchObject({
      name: 'SequelizeUniqueConstraintError',
    });
    await asignacion.update({ activa: false });
    await expect(f.crearAsignacion({ solicitud, voluntario })).resolves.toBeDefined();

    const evaluada = await f.crearSolicitud({ estado: 'EN_EVALUACION' });
    await f.crearEvaluacion({ solicitud: evaluada });
    await expect(f.crearEvaluacion({ solicitud: evaluada })).rejects.toMatchObject({
      name: 'SequelizeUniqueConstraintError',
    });
    await expect(f.crearEvaluacion({ solicitud: evaluada, vigente: false })).resolves.toBeDefined();
  });

  test('los CHECK rechazan valores fuera de la lista y el modelo también', async () => {
    const solicitud = await f.crearSolicitud();
    await expect(
      sequelize.query("UPDATE solicitudes SET estado = 'INVENTADO' WHERE id = :id", {
        replacements: { id: solicitud.id },
      }),
    ).rejects.toThrow(/solicitudes_estado_check/);
    await expect(solicitud.update({ estado: 'INVENTADO' })).rejects.toMatchObject({
      name: 'SequelizeValidationError',
    });
    await expect(
      db.Extraccion.create({ documentoId: (await f.crearDocumento()).id, progreso: 150 }),
    ).rejects.toThrow(/extracciones_progreso_valido/);
  });

  test('una corrección necesita documento o sección', async () => {
    const solicitud = await f.crearSolicitud({ estado: 'EN_REVISION' });
    await expect(
      db.SolicitudCorreccion.create({ solicitudId: solicitud.id, motivo: 'otro' }),
    ).rejects.toThrow(/solicitudes_correccion_check_1/);
    await expect(
      f.crearCorreccion({ solicitud, seccion: 'antecedentes_medicos' }),
    ).resolves.toBeDefined();
  });

  test('el correo es único sin importar mayúsculas', async () => {
    await f.crearUsuario({ correo: 'unico@pruebas.test' });
    await expect(f.crearUsuario({ correo: 'UNICO@pruebas.test' })).rejects.toMatchObject({
      name: 'SequelizeUniqueConstraintError',
    });
  });

  test('las tablas de solo inserción no tienen updated_at', async () => {
    for (const modelo of [db.HistorialEstado, db.Bitacora, db.RegistroAcceso]) {
      expect(modelo.rawAttributes.createdAt).toBeDefined();
      expect(modelo.rawAttributes.updatedAt).toBeUndefined();
    }
  });
});
