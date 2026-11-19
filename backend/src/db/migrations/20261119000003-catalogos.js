'use strict';

/**
 * Catálogos y configuración.
 * Tablas: departamentos, municipios, catalogos_items, configuracion.
 *
 * Los valores de los CHECK son copia de las constantes vigentes al crear la migración
 * (test/modelo/restricciones.test.js comprueba que sigan coincidiendo).
 * No modifiques esta migración: cualquier cambio va en una migración nueva.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // departamentos
      await queryInterface.createTable(
        'departamentos',
        {
          codigo: { type: Sequelize.STRING(2), allowNull: false, primaryKey: true },
          nombre: { type: Sequelize.STRING(80), allowNull: false },
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

      // municipios
      await queryInterface.createTable(
        'municipios',
        {
          codigo: { type: Sequelize.STRING(4), allowNull: false, primaryKey: true },
          departamento_codigo: {
            type: Sequelize.STRING(2),
            allowNull: false,
            references: { model: 'departamentos', key: 'codigo' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          nombre: { type: Sequelize.STRING(120), allowNull: false },
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
      await queryInterface.addIndex('municipios', ['departamento_codigo'], {
        name: 'municipios_departamento_codigo',
        transaction,
      });

      // catalogos_items
      await queryInterface.createTable(
        'catalogos_items',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          tipo: { type: Sequelize.STRING(40), allowNull: false },
          codigo: { type: Sequelize.STRING(60), allowNull: false },
          etiqueta_es: { type: Sequelize.STRING(200), allowNull: false },
          etiqueta_en: { type: Sequelize.STRING(200), allowNull: false },
          orden: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          metadatos: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'{}'::jsonb"),
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
      await queryInterface.addIndex('catalogos_items', ['tipo', 'codigo'], {
        name: 'catalogos_items_tipo_codigo_unico',
        unique: true,
        transaction,
      });

      // configuracion
      await queryInterface.createTable(
        'configuracion',
        {
          clave: { type: Sequelize.STRING(100), allowNull: false, primaryKey: true },
          valor: { type: Sequelize.JSONB, allowNull: false },
          descripcion: { type: Sequelize.TEXT, allowNull: true },
          actualizado_por: {
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
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('configuracion', { transaction });
      await queryInterface.dropTable('catalogos_items', { transaction });
      await queryInterface.dropTable('municipios', { transaction });
      await queryInterface.dropTable('departamentos', { transaction });
    });
  },
};
