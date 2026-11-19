'use strict';

/**
 * Bitácora y registro de accesos.
 * Tablas: bitacora, registro_accesos.
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

      // bitacora
      await queryInterface.createTable(
        'bitacora',
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
          accion: { type: Sequelize.STRING(60), allowNull: false },
          entidad: { type: Sequelize.STRING(60), allowNull: false },
          entidad_id: { type: Sequelize.STRING(64), allowNull: true },
          solicitud_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'solicitudes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          antes: { type: Sequelize.JSONB, allowNull: true },
          despues: { type: Sequelize.JSONB, allowNull: true },
          ip: { type: Sequelize.STRING(45), allowNull: true },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
        },
        { transaction },
      );
      await queryInterface.addIndex('bitacora', ['solicitud_id', 'created_at'], {
        name: 'bitacora_solicitud_id_created_at',
        transaction,
      });
      await queryInterface.addIndex('bitacora', ['entidad', 'entidad_id'], {
        name: 'bitacora_entidad_entidad_id',
        transaction,
      });
      await queryInterface.addIndex('bitacora', ['created_at'], {
        name: 'bitacora_created_at',
        transaction,
      });
      await queryInterface.addIndex('bitacora', ['usuario_id'], {
        name: 'bitacora_usuario_id',
        transaction,
      });

      // registro_accesos
      await queryInterface.createTable(
        'registro_accesos',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          usuario_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          solicitud_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'solicitudes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          recurso: { type: Sequelize.STRING(30), allowNull: false },
          recurso_id: { type: Sequelize.UUID, allowNull: true },
          ip: { type: Sequelize.STRING(45), allowNull: true },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
        },
        { transaction },
      );
      await sql(`ALTER TABLE registro_accesos
  ADD CONSTRAINT registro_accesos_recurso_check CHECK (recurso IN ('expediente', 'historia_clinica', 'documento', 'archivo', 'paquete'))`);
      await queryInterface.addIndex('registro_accesos', ['solicitud_id', 'created_at'], {
        name: 'registro_accesos_solicitud_id_created_at',
        transaction,
      });
      await queryInterface.addIndex('registro_accesos', ['usuario_id'], {
        name: 'registro_accesos_usuario_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('registro_accesos', { transaction });
      await queryInterface.dropTable('bitacora', { transaction });
    });
  },
};
