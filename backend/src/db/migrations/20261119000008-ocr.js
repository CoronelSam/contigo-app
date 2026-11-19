'use strict';

/**
 * Extracciones de OCR y campos extraídos.
 * Tablas: extracciones, campos_extraidos.
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

      // extracciones
      await queryInterface.createTable(
        'extracciones',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          documento_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'documentos', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          plantilla_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'plantillas_formulario', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          motor: { type: Sequelize.STRING(30), allowNull: true },
          estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'en_cola' },
          progreso: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          confianza_promedio: { type: Sequelize.DECIMAL(4, 3), allowNull: true },
          respuesta_cruda: { type: Sequelize.JSONB, allowNull: true },
          error: { type: Sequelize.STRING(100), allowNull: true },
          revisado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          revisado_en: { type: Sequelize.DATE, allowNull: true },
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
      await sql(`ALTER TABLE extracciones
  ADD CONSTRAINT extracciones_estado_check CHECK (estado IN ('en_cola', 'procesando', 'por_confirmar', 'confirmada', 'fallida', 'cancelada')),
  ADD CONSTRAINT extracciones_progreso_valido CHECK (progreso BETWEEN 0 AND 100),
  ADD CONSTRAINT extracciones_confianza_promedio_valido CHECK (confianza_promedio BETWEEN 0 AND 1)`);
      await queryInterface.addIndex('extracciones', ['documento_id'], {
        name: 'extracciones_documento_id',
        transaction,
      });
      await queryInterface.addIndex('extracciones', ['plantilla_id'], {
        name: 'extracciones_plantilla_id',
        transaction,
      });

      // campos_extraidos
      await queryInterface.createTable(
        'campos_extraidos',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          extraccion_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'extracciones', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          campo: { type: Sequelize.STRING(100), allowNull: false },
          seccion: { type: Sequelize.STRING(40), allowNull: true },
          ruta_dato: { type: Sequelize.STRING(200), allowNull: true },
          tipo: { type: Sequelize.STRING(10), allowNull: false },
          valor_leido: { type: Sequelize.TEXT, allowNull: true },
          confianza: { type: Sequelize.DECIMAL(4, 3), allowNull: true },
          pagina: { type: Sequelize.INTEGER, allowNull: true },
          coordenadas: { type: Sequelize.JSONB, allowNull: true },
          valor_final: { type: Sequelize.TEXT, allowNull: true },
          estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'propuesto' },
          revisado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          revisado_en: { type: Sequelize.DATE, allowNull: true },
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
      await sql(`ALTER TABLE campos_extraidos
  ADD CONSTRAINT campos_extraidos_seccion_check CHECK (seccion IN ('informacion_medica', 'embarazo_nacimiento', 'antecedentes_medicos', 'medicamentos_alergias', 'crecimiento_movilidad', 'educacion')),
  ADD CONSTRAINT campos_extraidos_tipo_check CHECK (tipo IN ('texto', 'fecha', 'numero', 'casilla', 'opcion')),
  ADD CONSTRAINT campos_extraidos_confianza_valido CHECK (confianza BETWEEN 0 AND 1),
  ADD CONSTRAINT campos_extraidos_pagina_valido CHECK (pagina >= 1),
  ADD CONSTRAINT campos_extraidos_estado_check CHECK (estado IN ('propuesto', 'confirmado', 'corregido'))`);
      await queryInterface.addIndex('campos_extraidos', ['extraccion_id'], {
        name: 'campos_extraidos_extraccion_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('campos_extraidos', { transaction });
      await queryInterface.dropTable('extracciones', { transaction });
    });
  },
};
