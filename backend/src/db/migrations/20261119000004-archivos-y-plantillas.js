'use strict';

/**
 * Archivos, plantillas oficiales, tipos de documento y requisitos por ruta.
 * Tablas: archivos, plantillas_formulario, tipos_documento, requisitos_ruta.
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

      // archivos
      await queryInterface.createTable(
        'archivos',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          clave: { type: Sequelize.STRING(512), allowNull: false, unique: true },
          mime: { type: Sequelize.STRING(100), allowNull: false },
          bytes: { type: Sequelize.INTEGER, allowNull: false },
          sha256: { type: Sequelize.STRING(64), allowNull: false },
          ancho: { type: Sequelize.INTEGER, allowNull: true },
          alto: { type: Sequelize.INTEGER, allowNull: true },
          subido_por: {
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
      await sql(`ALTER TABLE archivos
  ADD CONSTRAINT archivos_bytes_valido CHECK (bytes >= 0)`);
      await queryInterface.addIndex('archivos', ['sha256'], {
        name: 'archivos_sha256',
        transaction,
      });

      // plantillas_formulario
      await queryInterface.createTable(
        'plantillas_formulario',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          codigo: { type: Sequelize.STRING(60), allowNull: false },
          nombre: { type: Sequelize.STRING(200), allowNull: false },
          version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
          paquete: { type: Sequelize.STRING(20), allowNull: true },
          archivo_pdf_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'archivos', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          mapa_campos: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'[]'::jsonb"),
          },
          metodo: { type: Sequelize.STRING(20), allowNull: false },
          zonas_ocr: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'[]'::jsonb"),
          },
          orden: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          activa: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
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
      await sql(`ALTER TABLE plantillas_formulario
  ADD CONSTRAINT plantillas_formulario_version_valido CHECK (version >= 1),
  ADD CONSTRAINT plantillas_formulario_paquete_check CHECK (paquete IN ('MEXICO', 'INTERNACIONAL')),
  ADD CONSTRAINT plantillas_formulario_metodo_check CHECK (metodo IN ('campo', 'coordenadas'))`);
      await queryInterface.addIndex('plantillas_formulario', ['codigo', 'version'], {
        name: 'plantillas_formulario_codigo_version_unico',
        unique: true,
        transaction,
      });
      await queryInterface.addIndex('plantillas_formulario', ['archivo_pdf_id'], {
        name: 'plantillas_formulario_archivo_pdf_id',
        transaction,
      });

      // tipos_documento
      await queryInterface.createTable(
        'tipos_documento',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          codigo: { type: Sequelize.STRING(60), allowNull: false, unique: true },
          nombre_es: { type: Sequelize.STRING(200), allowNull: false },
          nombre_en: { type: Sequelize.STRING(200), allowNull: false },
          version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          categoria: { type: Sequelize.STRING(30), allowNull: false },
          para_que_sirve_es: { type: Sequelize.TEXT, allowNull: true },
          para_que_sirve_en: { type: Sequelize.TEXT, allowNull: true },
          como_fotografiar_es: { type: Sequelize.TEXT, allowNull: true },
          como_fotografiar_en: { type: Sequelize.TEXT, allowNull: true },
          admite_varias_paginas: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          paginas_esperadas: { type: Sequelize.INTEGER, allowNull: true },
          plantilla_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'plantillas_formulario', key: 'id' },
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
      await sql(`ALTER TABLE tipos_documento
  ADD CONSTRAINT tipos_documento_version_valido CHECK (version >= 1),
  ADD CONSTRAINT tipos_documento_categoria_check CHECK (categoria IN ('medico', 'formulario', 'consentimiento_firmado', 'identidad', 'financiero', 'otro')),
  ADD CONSTRAINT tipos_documento_paginas_esperadas_valido CHECK (paginas_esperadas >= 1)`);
      await queryInterface.addIndex('tipos_documento', ['plantilla_id'], {
        name: 'tipos_documento_plantilla_id',
        transaction,
      });

      // requisitos_ruta
      await queryInterface.createTable(
        'requisitos_ruta',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          ruta: { type: Sequelize.STRING(20), allowNull: false },
          tipo_documento_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'tipos_documento', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          obligatorio: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          orden: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          cubierto_por_secciones: {
            type: Sequelize.ARRAY(Sequelize.TEXT),
            allowNull: false,
            defaultValue: Sequelize.literal("'{}'::text[]"),
          },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
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
      await sql(`ALTER TABLE requisitos_ruta
  ADD CONSTRAINT requisitos_ruta_ruta_check CHECK (ruta IN ('EVALUACION', 'HONDURAS', 'MEXICO', 'INTERNACIONAL'))`);
      await queryInterface.addIndex('requisitos_ruta', ['ruta', 'tipo_documento_id'], {
        name: 'requisitos_ruta_ruta_tipo_documento_id_unico',
        unique: true,
        transaction,
      });
      await queryInterface.addIndex('requisitos_ruta', ['tipo_documento_id'], {
        name: 'requisitos_ruta_tipo_documento_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('requisitos_ruta', { transaction });
      await queryInterface.dropTable('tipos_documento', { transaction });
      await queryInterface.dropTable('plantillas_formulario', { transaction });
      await queryInterface.dropTable('archivos', { transaction });
    });
  },
};
