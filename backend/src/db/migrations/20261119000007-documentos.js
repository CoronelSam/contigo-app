'use strict';

/**
 * Documentos, páginas, correcciones, profesional de salud y consentimientos.
 * Tablas: documentos, documento_paginas, solicitudes_correccion, profesionales_salud, consentimientos.
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

      // documentos
      await queryInterface.createTable(
        'documentos',
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
          tipo_documento_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'tipos_documento', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
          reemplaza_a: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'documentos', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          vigente: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'FALTA' },
          paginas_declaradas: { type: Sequelize.INTEGER, allowNull: true },
          origen: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'app' },
          capturado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          capturado_en: { type: Sequelize.DATE, allowNull: true },
          validado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          validado_en: { type: Sequelize.DATE, allowNull: true },
          motivo_rechazo: { type: Sequelize.TEXT, allowNull: true },
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
      await sql(`ALTER TABLE documentos
  ADD CONSTRAINT documentos_version_valido CHECK (version >= 1),
  ADD CONSTRAINT documentos_estado_check CHECK (estado IN ('FALTA', 'CAPTURADO', 'VALIDADO', 'RECHAZADO')),
  ADD CONSTRAINT documentos_paginas_declaradas_valido CHECK (paginas_declaradas >= 1),
  ADD CONSTRAINT documentos_origen_check CHECK (origen IN ('app', 'jornada'))`);
      await queryInterface.addIndex(
        'documentos',
        ['solicitud_id', 'tipo_documento_id', 'version'],
        { name: 'documentos_solicitud_id_tipo_documento_id_version', transaction },
      );
      await queryInterface.addIndex('documentos', ['tipo_documento_id'], {
        name: 'documentos_tipo_documento_id',
        transaction,
      });
      await sql(
        'CREATE UNIQUE INDEX documentos_vigente_unico ON documentos (solicitud_id, tipo_documento_id) WHERE vigente',
      );

      // documento_paginas
      await queryInterface.createTable(
        'documento_paginas',
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
            onDelete: 'CASCADE',
          },
          orden: { type: Sequelize.INTEGER, allowNull: false },
          archivo_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'archivos', key: 'id' },
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
      await sql(`ALTER TABLE documento_paginas
  ADD CONSTRAINT documento_paginas_orden_valido CHECK (orden >= 1)`);
      await queryInterface.addIndex('documento_paginas', ['archivo_id'], {
        name: 'documento_paginas_archivo_id',
        transaction,
      });
      await sql(
        'ALTER TABLE documento_paginas ADD CONSTRAINT documento_paginas_orden_unico UNIQUE (documento_id, orden) DEFERRABLE INITIALLY DEFERRED',
      );

      // solicitudes_correccion
      await queryInterface.createTable(
        'solicitudes_correccion',
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
          documento_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'documentos', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          seccion: { type: Sequelize.STRING(40), allowNull: true },
          motivo: { type: Sequelize.STRING(30), allowNull: false },
          observaciones: { type: Sequelize.TEXT, allowNull: true },
          solicitado_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'abierta' },
          resuelta_con_documento_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'documentos', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          resuelta_en: { type: Sequelize.DATE, allowNull: true },
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
      await sql(`ALTER TABLE solicitudes_correccion
  ADD CONSTRAINT solicitudes_correccion_seccion_check CHECK (seccion IN ('informacion_medica', 'embarazo_nacimiento', 'antecedentes_medicos', 'medicamentos_alergias', 'crecimiento_movilidad', 'educacion', 'profesional_salud', 'consentimientos')),
  ADD CONSTRAINT solicitudes_correccion_motivo_check CHECK (motivo IN ('imagen_borrosa', 'pagina_incompleta', 'texto_ilegible', 'documento_incorrecto', 'no_cumple_requisito', 'dato_incompleto', 'dato_incorrecto', 'otro')),
  ADD CONSTRAINT solicitudes_correccion_estado_check CHECK (estado IN ('abierta', 'resuelta', 'anulada')),
  ADD CONSTRAINT solicitudes_correccion_check_1 CHECK (documento_id IS NOT NULL OR seccion IS NOT NULL)`);
      await queryInterface.addIndex('solicitudes_correccion', ['solicitud_id'], {
        name: 'solicitudes_correccion_solicitud_id',
        transaction,
      });
      await queryInterface.addIndex('solicitudes_correccion', ['documento_id'], {
        name: 'solicitudes_correccion_documento_id',
        transaction,
      });

      // profesionales_salud
      await queryInterface.createTable(
        'profesionales_salud',
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
            unique: true,
            references: { model: 'solicitudes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          nombre: { type: Sequelize.STRING(200), allowNull: true },
          especialidad: { type: Sequelize.STRING(60), allowNull: true },
          telefono: { type: Sequelize.STRING(20), allowNull: true },
          correo: { type: Sequelize.STRING(254), allowNull: true },
          documento_certificacion_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'documentos', key: 'id' },
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

      // consentimientos
      await queryInterface.createTable(
        'consentimientos',
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
          tipo: { type: Sequelize.STRING(40), allowNull: false },
          texto_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'textos_consentimiento', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          decision: { type: Sequelize.STRING(20), allowNull: true },
          texto_abierto_en: { type: Sequelize.DATE, allowNull: true },
          decidido_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          decidido_en: { type: Sequelize.DATE, allowNull: true },
          ip: { type: Sequelize.STRING(45), allowNull: true },
          dispositivo: { type: Sequelize.STRING(255), allowNull: true },
          estado_firma: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pendiente' },
          documento_firmado_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'documentos', key: 'id' },
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
      await sql(`ALTER TABLE consentimientos
  ADD CONSTRAINT consentimientos_tipo_check CHECK (tipo IN ('divulgacion_informacion_medica', 'marketing', 'telesalud', 'condiciones_atencion')),
  ADD CONSTRAINT consentimientos_decision_check CHECK (decision IN ('acepta', 'no_acepta')),
  ADD CONSTRAINT consentimientos_estado_firma_check CHECK (estado_firma IN ('pendiente', 'firmado', 'no_aplica'))`);
      await queryInterface.addIndex('consentimientos', ['solicitud_id', 'tipo'], {
        name: 'consentimientos_solicitud_id_tipo_unico',
        unique: true,
        transaction,
      });
      await queryInterface.addIndex('consentimientos', ['texto_id'], {
        name: 'consentimientos_texto_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('consentimientos', { transaction });
      await queryInterface.dropTable('profesionales_salud', { transaction });
      await queryInterface.dropTable('solicitudes_correccion', { transaction });
      await queryInterface.dropTable('documento_paginas', { transaction });
      await queryInterface.dropTable('documentos', { transaction });
    });
  },
};
