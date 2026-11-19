'use strict';

/**
 * Mensajes por caso y notificaciones.
 * Tablas: mensajes, notificaciones.
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

      // mensajes
      await queryInterface.createTable(
        'mensajes',
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
          autor_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          cuerpo: { type: Sequelize.TEXT, allowNull: true },
          archivo_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'archivos', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          leido_en: { type: Sequelize.DATE, allowNull: true },
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
      await sql(`ALTER TABLE mensajes
  ADD CONSTRAINT mensajes_check_1 CHECK (cuerpo IS NOT NULL OR archivo_id IS NOT NULL)`);
      await queryInterface.addIndex('mensajes', ['solicitud_id', 'created_at'], {
        name: 'mensajes_solicitud_id_created_at',
        transaction,
      });
      await queryInterface.addIndex('mensajes', ['autor_id'], {
        name: 'mensajes_autor_id',
        transaction,
      });
      await queryInterface.addIndex('mensajes', ['archivo_id'], {
        name: 'mensajes_archivo_id',
        transaction,
      });

      // notificaciones
      await queryInterface.createTable(
        'notificaciones',
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
          tipo: { type: Sequelize.STRING(40), allowNull: false },
          titulo: { type: Sequelize.STRING(200), allowNull: false },
          cuerpo: { type: Sequelize.TEXT, allowNull: false },
          idioma: { type: Sequelize.STRING(2), allowNull: false, defaultValue: 'es' },
          datos: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'{}'::jsonb"),
          },
          solicitud_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'solicitudes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          leida_en: { type: Sequelize.DATE, allowNull: true },
          enviada_push_en: { type: Sequelize.DATE, allowNull: true },
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
      await sql(`ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_idioma_check CHECK (idioma IN ('es', 'en'))`);
      await queryInterface.addIndex('notificaciones', ['usuario_id', 'leida_en'], {
        name: 'notificaciones_usuario_id_leida_en',
        transaction,
      });
      await queryInterface.addIndex('notificaciones', ['solicitud_id'], {
        name: 'notificaciones_solicitud_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('notificaciones', { transaction });
      await queryInterface.dropTable('mensajes', { transaction });
    });
  },
};
