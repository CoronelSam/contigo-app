'use strict';

/**
 * Tabla técnica de idempotencia.
 * Tablas: claves_idempotencia.
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

      // claves_idempotencia
      await queryInterface.createTable(
        'claves_idempotencia',
        {
          usuario_id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          clave: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
          metodo: { type: Sequelize.STRING(10), allowNull: false },
          ruta: { type: Sequelize.STRING(300), allowNull: false },
          hash_cuerpo: { type: Sequelize.STRING(64), allowNull: false },
          estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'en_proceso' },
          codigo_http: { type: Sequelize.INTEGER, allowNull: true },
          respuesta: { type: Sequelize.JSONB, allowNull: true },
          expira_en: { type: Sequelize.DATE, allowNull: false },
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
      await sql(`ALTER TABLE claves_idempotencia
  ADD CONSTRAINT claves_idempotencia_estado_check CHECK (estado IN ('en_proceso', 'completada'))`);
      await queryInterface.addIndex('claves_idempotencia', ['expira_en'], {
        name: 'claves_idempotencia_expira_en',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('claves_idempotencia', { transaction });
    });
  },
};
