'use strict';

/**
 * Solicitudes, secciones del formulario, textos de consentimiento, asignaciones e historial de estados.
 * Tablas: solicitudes, solicitud_secciones, textos_consentimiento, asignaciones, historial_estados.
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
      await sql('CREATE SEQUENCE solicitud_codigo_seq START 1');

      // solicitudes
      await queryInterface.createTable(
        'solicitudes',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          codigo: { type: Sequelize.STRING(20), allowNull: false, unique: true },
          paciente_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'pacientes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          modalidad: { type: Sequelize.STRING(10), allowNull: true },
          estado: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'BORRADOR' },
          etapa: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'evaluacion' },
          ruta_sugerida: { type: Sequelize.STRING(20), allowNull: true },
          ruta_decidida: { type: Sequelize.STRING(20), allowNull: true },
          paquete: { type: Sequelize.STRING(20), allowNull: true },
          faltantes_al_enviar: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'[]'::jsonb"),
          },
          enviada_en: { type: Sequelize.DATE, allowNull: true },
          coordinador_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          creada_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          ultimo_cambio_estado: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
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
      await sql(`ALTER TABLE solicitudes
  ADD CONSTRAINT solicitudes_modalidad_check CHECK (modalidad IN ('app', 'fotos')),
  ADD CONSTRAINT solicitudes_estado_check CHECK (estado IN ('BORRADOR', 'CAPTURA', 'EN_REVISION', 'INFO_ADICIONAL', 'EN_EVALUACION', 'PAQUETE_EXTERIOR', 'COMPLETA', 'ENVIADA', 'ACEPTADA', 'DENEGADA', 'DERIVADA_HN', 'ATENDIDA_HN')),
  ADD CONSTRAINT solicitudes_etapa_check CHECK (etapa IN ('evaluacion', 'paquete')),
  ADD CONSTRAINT solicitudes_ruta_sugerida_check CHECK (ruta_sugerida IN ('HONDURAS', 'MEXICO', 'INTERNACIONAL', 'POR_EVALUAR')),
  ADD CONSTRAINT solicitudes_ruta_decidida_check CHECK (ruta_decidida IN ('HONDURAS', 'MEXICO', 'INTERNACIONAL')),
  ADD CONSTRAINT solicitudes_paquete_check CHECK (paquete IN ('MEXICO', 'INTERNACIONAL'))`);
      await queryInterface.addIndex('solicitudes', ['estado', 'ultimo_cambio_estado'], {
        name: 'solicitudes_estado_ultimo_cambio_estado',
        transaction,
      });
      await queryInterface.addIndex('solicitudes', ['paciente_id'], {
        name: 'solicitudes_paciente_id',
        transaction,
      });
      await queryInterface.addIndex('solicitudes', ['coordinador_id'], {
        name: 'solicitudes_coordinador_id',
        transaction,
      });

      // solicitud_secciones
      await queryInterface.createTable(
        'solicitud_secciones',
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
          seccion: { type: Sequelize.STRING(40), allowNull: false },
          datos: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: Sequelize.literal("'{}'::jsonb"),
          },
          estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'vacia' },
          version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          version_plantilla: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'v1' },
          idioma: { type: Sequelize.STRING(2), allowNull: false, defaultValue: 'es' },
          origen: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'app' },
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
      await sql(`ALTER TABLE solicitud_secciones
  ADD CONSTRAINT solicitud_secciones_seccion_check CHECK (seccion IN ('informacion_medica', 'embarazo_nacimiento', 'antecedentes_medicos', 'medicamentos_alergias', 'crecimiento_movilidad', 'educacion')),
  ADD CONSTRAINT solicitud_secciones_estado_check CHECK (estado IN ('vacia', 'incompleta', 'completa')),
  ADD CONSTRAINT solicitud_secciones_version_valido CHECK (version >= 0),
  ADD CONSTRAINT solicitud_secciones_idioma_check CHECK (idioma IN ('es', 'en')),
  ADD CONSTRAINT solicitud_secciones_origen_check CHECK (origen IN ('app', 'ocr', 'mixto'))`);
      await queryInterface.addIndex('solicitud_secciones', ['solicitud_id', 'seccion'], {
        name: 'solicitud_secciones_solicitud_id_seccion_unico',
        unique: true,
        transaction,
      });
      await sql(
        'CREATE INDEX solicitud_secciones_datos_gin ON solicitud_secciones USING gin (datos)',
      );

      // textos_consentimiento
      await queryInterface.createTable(
        'textos_consentimiento',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          tipo: { type: Sequelize.STRING(40), allowNull: false },
          version: { type: Sequelize.INTEGER, allowNull: false },
          idioma: { type: Sequelize.STRING(2), allowNull: false },
          titulo: { type: Sequelize.STRING(200), allowNull: false },
          cuerpo: { type: Sequelize.TEXT, allowNull: false },
          vigente_desde: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
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
      await sql(`ALTER TABLE textos_consentimiento
  ADD CONSTRAINT textos_consentimiento_tipo_check CHECK (tipo IN ('divulgacion_informacion_medica', 'marketing', 'telesalud', 'condiciones_atencion')),
  ADD CONSTRAINT textos_consentimiento_version_valido CHECK (version >= 1),
  ADD CONSTRAINT textos_consentimiento_idioma_check CHECK (idioma IN ('es', 'en'))`);
      await queryInterface.addIndex('textos_consentimiento', ['tipo', 'version', 'idioma'], {
        name: 'textos_consentimiento_tipo_version_idioma_unico',
        unique: true,
        transaction,
      });

      // asignaciones
      await queryInterface.createTable(
        'asignaciones',
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
          voluntario_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          estado: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'asignado' },
          activa: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          asignado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
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
      await sql(`ALTER TABLE asignaciones
  ADD CONSTRAINT asignaciones_estado_check CHECK (estado IN ('asignado', 'pendiente_captura', 'captura_en_proceso', 'en_revision', 'revisado'))`);
      await queryInterface.addIndex('asignaciones', ['voluntario_id', 'solicitud_id'], {
        name: 'asignaciones_voluntario_id_solicitud_id',
        transaction,
      });
      await queryInterface.addIndex('asignaciones', ['solicitud_id'], {
        name: 'asignaciones_solicitud_id',
        transaction,
      });
      await sql(
        'CREATE UNIQUE INDEX asignaciones_activa_unica ON asignaciones (solicitud_id, voluntario_id) WHERE activa',
      );

      // historial_estados
      await queryInterface.createTable(
        'historial_estados',
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
          estado_anterior: { type: Sequelize.STRING(30), allowNull: true },
          estado_nuevo: { type: Sequelize.STRING(30), allowNull: false },
          etapa: { type: Sequelize.STRING(20), allowNull: true },
          usuario_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          nota: { type: Sequelize.TEXT, allowNull: true },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('now()'),
          },
        },
        { transaction },
      );
      await sql(`ALTER TABLE historial_estados
  ADD CONSTRAINT historial_estados_estado_anterior_check CHECK (estado_anterior IN ('BORRADOR', 'CAPTURA', 'EN_REVISION', 'INFO_ADICIONAL', 'EN_EVALUACION', 'PAQUETE_EXTERIOR', 'COMPLETA', 'ENVIADA', 'ACEPTADA', 'DENEGADA', 'DERIVADA_HN', 'ATENDIDA_HN')),
  ADD CONSTRAINT historial_estados_estado_nuevo_check CHECK (estado_nuevo IN ('BORRADOR', 'CAPTURA', 'EN_REVISION', 'INFO_ADICIONAL', 'EN_EVALUACION', 'PAQUETE_EXTERIOR', 'COMPLETA', 'ENVIADA', 'ACEPTADA', 'DENEGADA', 'DERIVADA_HN', 'ATENDIDA_HN')),
  ADD CONSTRAINT historial_estados_etapa_check CHECK (etapa IN ('evaluacion', 'paquete'))`);
      await queryInterface.addIndex('historial_estados', ['solicitud_id', 'created_at'], {
        name: 'historial_estados_solicitud_id_created_at',
        transaction,
      });
      await queryInterface.addIndex('historial_estados', ['usuario_id'], {
        name: 'historial_estados_usuario_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('historial_estados', { transaction });
      await queryInterface.dropTable('asignaciones', { transaction });
      await queryInterface.dropTable('textos_consentimiento', { transaction });
      await queryInterface.dropTable('solicitud_secciones', { transaction });
      await queryInterface.dropTable('solicitudes', { transaction });
      await queryInterface.sequelize.query('DROP SEQUENCE IF EXISTS solicitud_codigo_seq', {
        transaction,
      });
    });
  },
};
