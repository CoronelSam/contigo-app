'use strict';

/**
 * Paquetes PDF, envíos a Shriners y respuestas.
 * Tablas: paquetes_pdf, envios, respuestas_shriners.
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

      // paquetes_pdf
      await queryInterface.createTable(
        'paquetes_pdf',
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
          paquete: { type: Sequelize.STRING(20), allowNull: false },
          tipo: { type: Sequelize.STRING(10), allowNull: false },
          estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'en_cola' },
          progreso: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          archivo_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'archivos', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          numero_paginas: { type: Sequelize.INTEGER, allowNull: true },
          plantillas_usadas: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'[]'::jsonb"),
          },
          avisos: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'[]'::jsonb"),
          },
          generado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          revisado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          revisado_en: { type: Sequelize.DATE, allowNull: true },
          error: { type: Sequelize.STRING(100), allowNull: true },
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
      await sql(`ALTER TABLE paquetes_pdf
  ADD CONSTRAINT paquetes_pdf_paquete_check CHECK (paquete IN ('MEXICO', 'INTERNACIONAL')),
  ADD CONSTRAINT paquetes_pdf_tipo_check CHECK (tipo IN ('borrador', 'final')),
  ADD CONSTRAINT paquetes_pdf_estado_check CHECK (estado IN ('en_cola', 'generando', 'listo', 'fallido')),
  ADD CONSTRAINT paquetes_pdf_progreso_valido CHECK (progreso BETWEEN 0 AND 100)`);
      await queryInterface.addIndex('paquetes_pdf', ['solicitud_id'], {
        name: 'paquetes_pdf_solicitud_id',
        transaction,
      });
      await queryInterface.addIndex('paquetes_pdf', ['archivo_id'], {
        name: 'paquetes_pdf_archivo_id',
        transaction,
      });

      // envios
      await queryInterface.createTable(
        'envios',
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
          paquete_pdf_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'paquetes_pdf', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          destino: { type: Sequelize.STRING(20), allowNull: false },
          fecha: { type: Sequelize.DATEONLY, allowNull: false },
          metodo: { type: Sequelize.STRING(30), allowNull: false },
          guia: { type: Sequelize.STRING(200), allowNull: true },
          observaciones: { type: Sequelize.TEXT, allowNull: true },
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
      await sql(`ALTER TABLE envios
  ADD CONSTRAINT envios_destino_check CHECK (destino IN ('MEXICO', 'INTERNACIONAL')),
  ADD CONSTRAINT envios_metodo_check CHECK (metodo IN ('correo', 'mensajeria', 'portal', 'entrega_personal', 'otro'))`);
      await queryInterface.addIndex('envios', ['solicitud_id'], {
        name: 'envios_solicitud_id',
        transaction,
      });
      await queryInterface.addIndex('envios', ['paquete_pdf_id'], {
        name: 'envios_paquete_pdf_id',
        transaction,
      });

      // respuestas_shriners
      await queryInterface.createTable(
        'respuestas_shriners',
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
          envio_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'envios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          fecha: { type: Sequelize.DATEONLY, allowNull: false },
          resultado: { type: Sequelize.STRING(30), allowNull: false },
          observaciones: { type: Sequelize.TEXT, allowNull: true },
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
      await sql(`ALTER TABLE respuestas_shriners
  ADD CONSTRAINT respuestas_shriners_resultado_check CHECK (resultado IN ('informacion_adicional', 'aceptada', 'denegada'))`);
      await queryInterface.addIndex('respuestas_shriners', ['solicitud_id'], {
        name: 'respuestas_shriners_solicitud_id',
        transaction,
      });
      await queryInterface.addIndex('respuestas_shriners', ['envio_id'], {
        name: 'respuestas_shriners_envio_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('respuestas_shriners', { transaction });
      await queryInterface.dropTable('envios', { transaction });
      await queryInterface.dropTable('paquetes_pdf', { transaction });
    });
  },
};
