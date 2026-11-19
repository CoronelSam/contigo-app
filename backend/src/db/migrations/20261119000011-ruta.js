'use strict';

/**
 * Reglas de ruta, evaluaciones, proveedores locales y derivaciones en Honduras.
 * Tablas: reglas_ruta, evaluaciones, proveedores_locales, derivaciones_locales.
 *
 * Los valores de los CHECK son copia de las constantes vigentes al crear la migración
 * (test/modelo/restricciones.test.js comprueba que sigan coincidiendo).
 * No modifiques esta migración: cualquier cambio va en una migración nueva.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (texto) => queryInterface.sequelize.query(texto, { transaction });

      // reglas_ruta
      await queryInterface.createTable(
        'reglas_ruta',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          version: { type: Sequelize.INTEGER, allowNull: false },
          prioridad: { type: Sequelize.INTEGER, allowNull: false },
          nombre: { type: Sequelize.STRING(100), allowNull: false },
          condicion: { type: Sequelize.JSONB, allowNull: false },
          ruta_sugerida: { type: Sequelize.STRING(20), allowNull: false },
          motivo_es: { type: Sequelize.TEXT, allowNull: false },
          motivo_en: { type: Sequelize.TEXT, allowNull: false },
          activa: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
        },
        { transaction },
      );
      await sql(`ALTER TABLE reglas_ruta
  ADD CONSTRAINT reglas_ruta_version_valido CHECK (version >= 1),
  ADD CONSTRAINT reglas_ruta_ruta_sugerida_check CHECK (ruta_sugerida IN ('HONDURAS', 'MEXICO', 'INTERNACIONAL', 'POR_EVALUAR'))`);
      await queryInterface.addIndex('reglas_ruta', ['version', 'nombre'], {
        name: 'reglas_ruta_version_nombre_unico',
        unique: true,
        transaction,
      });

      // evaluaciones
      await queryInterface.createTable(
        'evaluaciones',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          solicitud_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'solicitudes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          ruta_sugerida: { type: Sequelize.STRING(20), allowNull: false },
          motivos: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'[]'::jsonb"),
          },
          hechos: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'{}'::jsonb"),
          },
          version_reglas: { type: Sequelize.INTEGER, allowNull: true },
          ruta_decidida: { type: Sequelize.STRING(20), allowNull: false },
          justificacion: { type: Sequelize.TEXT, allowNull: false },
          evaluador_nombre: { type: Sequelize.STRING(200), allowNull: false },
          evaluador_cargo: { type: Sequelize.STRING(200), allowNull: false },
          tipo_dictamen: { type: Sequelize.STRING(30), allowNull: false },
          fecha_dictamen: { type: Sequelize.DATEONLY, allowNull: false },
          registrado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          vigente: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
        },
        { transaction },
      );
      await sql(`ALTER TABLE evaluaciones
  ADD CONSTRAINT evaluaciones_ruta_sugerida_check CHECK (ruta_sugerida IN ('HONDURAS', 'MEXICO', 'INTERNACIONAL', 'POR_EVALUAR')),
  ADD CONSTRAINT evaluaciones_ruta_decidida_check CHECK (ruta_decidida IN ('HONDURAS', 'MEXICO', 'INTERNACIONAL')),
  ADD CONSTRAINT evaluaciones_tipo_dictamen_check CHECK (tipo_dictamen IN ('medico_evaluador', 'comite_medico'))`);
      await queryInterface.addIndex('evaluaciones', ['solicitud_id'], {
        name: 'evaluaciones_solicitud_id',
        transaction,
      });
      await sql(
        'CREATE UNIQUE INDEX evaluaciones_vigente_unica ON evaluaciones (solicitud_id) WHERE vigente',
      );

      // proveedores_locales
      await queryInterface.createTable(
        'proveedores_locales',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          nombre: { type: Sequelize.STRING(200), allowNull: false },
          tipo: { type: Sequelize.STRING(30), allowNull: false },
          departamento_codigo: {
            type: Sequelize.STRING(2),
            allowNull: false,
            references: { model: 'departamentos', key: 'codigo' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          municipio_codigo: {
            type: Sequelize.STRING(4),
            allowNull: true,
            references: { model: 'municipios', key: 'codigo' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          especialidades: {
            type: Sequelize.ARRAY(Sequelize.TEXT),
            allowNull: false,
            defaultValue: Sequelize.literal("'{}'::text[]"),
          },
          contacto: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'{}'::jsonb"),
          },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          notas: { type: Sequelize.TEXT, allowNull: true },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
        },
        { transaction },
      );
      await sql(`ALTER TABLE proveedores_locales
  ADD CONSTRAINT proveedores_locales_tipo_check CHECK (tipo IN ('hospital_publico', 'hospital_privado', 'clinica', 'jornada_medica'))`);
      await queryInterface.addIndex('proveedores_locales', ['departamento_codigo'], {
        name: 'proveedores_locales_departamento_codigo',
        transaction,
      });
      await queryInterface.addIndex('proveedores_locales', ['municipio_codigo'], {
        name: 'proveedores_locales_municipio_codigo',
        transaction,
      });
      await sql(
        'CREATE INDEX proveedores_locales_especialidades_gin ON proveedores_locales USING gin (especialidades)',
      );

      // derivaciones_locales
      await queryInterface.createTable(
        'derivaciones_locales',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          solicitud_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'solicitudes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          proveedor_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'proveedores_locales', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          especialidad: { type: Sequelize.STRING(60), allowNull: false },
          fecha_cita: { type: Sequelize.DATEONLY, allowNull: false },
          hora_cita: { type: Sequelize.TIME, allowNull: true },
          estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'programada' },
          observaciones: { type: Sequelize.TEXT, allowNull: true },
          reemplaza_a: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'derivaciones_locales', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          registrado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
        },
        { transaction },
      );
      await sql(`ALTER TABLE derivaciones_locales
  ADD CONSTRAINT derivaciones_locales_estado_check CHECK (estado IN ('programada', 'atendida', 'no_asistio', 'cancelada'))`);
      await queryInterface.addIndex('derivaciones_locales', ['solicitud_id'], {
        name: 'derivaciones_locales_solicitud_id',
        transaction,
      });
      await queryInterface.addIndex('derivaciones_locales', ['proveedor_id'], {
        name: 'derivaciones_locales_proveedor_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('derivaciones_locales', { transaction });
      await queryInterface.dropTable('proveedores_locales', { transaction });
      await queryInterface.dropTable('evaluaciones', { transaction });
      await queryInterface.dropTable('reglas_ruta', { transaction });
    });
  },
};
