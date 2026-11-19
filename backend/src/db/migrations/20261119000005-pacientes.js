'use strict';

/**
 * Pacientes, tutores y vínculo paciente–tutor.
 * Tablas: pacientes, tutores, paciente_tutor.
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

      // pacientes
      await queryInterface.createTable(
        'pacientes',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          nombres: { type: Sequelize.STRING(120), allowNull: false },
          apellido_paterno: { type: Sequelize.STRING(80), allowNull: false },
          apellido_materno: { type: Sequelize.STRING(80), allowNull: true },
          fecha_nacimiento: { type: Sequelize.DATEONLY, allowNull: false },
          sexo: { type: Sequelize.STRING(10), allowNull: false },
          municipio_codigo: {
            type: Sequelize.STRING(4),
            allowNull: false,
            references: { model: 'municipios', key: 'codigo' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          direccion: { type: Sequelize.TEXT, allowNull: true },
          foto_archivo_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'archivos', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          posible_duplicado: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          creado_por: {
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
      await sql(`ALTER TABLE pacientes
  ADD CONSTRAINT pacientes_sexo_check CHECK (sexo IN ('femenino', 'masculino'))`);
      await queryInterface.addIndex('pacientes', ['municipio_codigo'], {
        name: 'pacientes_municipio_codigo',
        transaction,
      });
      await queryInterface.addIndex('pacientes', ['foto_archivo_id'], {
        name: 'pacientes_foto_archivo_id',
        transaction,
      });
      await sql(
        "ALTER TABLE pacientes ADD COLUMN nombre_busqueda text GENERATED ALWAYS AS (lower(f_unaccent(nombres || ' ' || apellido_paterno || ' ' || coalesce(apellido_materno, '')))) STORED",
      );
      await sql(
        'CREATE INDEX pacientes_nombre_busqueda_trgm ON pacientes USING gin (nombre_busqueda gin_trgm_ops)',
      );

      // tutores
      await queryInterface.createTable(
        'tutores',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          usuario_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          nombres: { type: Sequelize.STRING(120), allowNull: false },
          apellidos: { type: Sequelize.STRING(120), allowNull: false },
          parentesco: { type: Sequelize.STRING(60), allowNull: true },
          telefono: { type: Sequelize.STRING(20), allowNull: true },
          correo: { type: Sequelize.STRING(254), allowNull: true },
          direccion: { type: Sequelize.TEXT, allowNull: true },
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
      await queryInterface.addIndex('tutores', ['usuario_id'], {
        name: 'tutores_usuario_id',
        transaction,
      });

      // paciente_tutor
      await queryInterface.createTable(
        'paciente_tutor',
        {
          paciente_id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'pacientes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          tutor_id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'tutores', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          es_responsable_legal: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          confirmado_en: { type: Sequelize.DATE, allowNull: true },
          confirmado_por: {
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
      await queryInterface.addIndex('paciente_tutor', ['tutor_id'], {
        name: 'paciente_tutor_tutor_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('paciente_tutor', { transaction });
      await queryInterface.dropTable('tutores', { transaction });
      await queryInterface.dropTable('pacientes', { transaction });
    });
  },
};
