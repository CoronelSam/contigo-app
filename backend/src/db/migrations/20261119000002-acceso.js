'use strict';

/**
 * Acceso: roles, permisos, usuarios, sesiones, tokens, dispositivos y preferencias.
 * Tablas: roles, permisos, rol_permiso, usuarios, sesiones, tokens_recuperacion, dispositivos, preferencias.
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

      // roles
      await queryInterface.createTable(
        'roles',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          codigo: { type: Sequelize.STRING(30), allowNull: false, unique: true },
          nombre_es: { type: Sequelize.STRING(60), allowNull: false },
          nombre_en: { type: Sequelize.STRING(60), allowNull: false },
          descripcion: { type: Sequelize.TEXT, allowNull: true },
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
      await sql(`ALTER TABLE roles
  ADD CONSTRAINT roles_codigo_check CHECK (codigo IN ('familia', 'voluntario', 'coordinador', 'administrador'))`);

      // permisos
      await queryInterface.createTable(
        'permisos',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          codigo: { type: Sequelize.STRING(60), allowNull: false, unique: true },
          descripcion: { type: Sequelize.TEXT, allowNull: true },
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

      // rol_permiso
      await queryInterface.createTable(
        'rol_permiso',
        {
          rol_id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'roles', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          permiso_id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'permisos', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
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
      await queryInterface.addIndex('rol_permiso', ['permiso_id'], {
        name: 'rol_permiso_permiso_id',
        transaction,
      });

      // usuarios
      await queryInterface.createTable(
        'usuarios',
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          correo: { type: Sequelize.STRING(254), allowNull: false },
          hash_contrasena: { type: Sequelize.TEXT, allowNull: true },
          nombres: { type: Sequelize.STRING(120), allowNull: false },
          apellidos: { type: Sequelize.STRING(120), allowNull: false },
          telefono: { type: Sequelize.STRING(20), allowNull: true },
          idioma: { type: Sequelize.STRING(2), allowNull: false, defaultValue: 'es' },
          estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'activo' },
          rol_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'roles', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          terminos_version: { type: Sequelize.STRING(20), allowNull: true },
          terminos_aceptados_en: { type: Sequelize.DATE, allowNull: true },
          correo_verificado_en: { type: Sequelize.DATE, allowNull: true },
          intentos_fallidos: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          bloqueado_hasta: { type: Sequelize.DATE, allowNull: true },
          ultimo_acceso_en: { type: Sequelize.DATE, allowNull: true },
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
      await sql(`ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_idioma_check CHECK (idioma IN ('es', 'en')),
  ADD CONSTRAINT usuarios_estado_check CHECK (estado IN ('invitado', 'activo', 'inactivo')),
  ADD CONSTRAINT usuarios_intentos_fallidos_valido CHECK (intentos_fallidos >= 0)`);
      await queryInterface.addIndex('usuarios', ['rol_id'], {
        name: 'usuarios_rol_id',
        transaction,
      });
      await sql('CREATE UNIQUE INDEX usuarios_correo_unico ON usuarios (lower(correo))');

      // sesiones
      await queryInterface.createTable(
        'sesiones',
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
          hash_refresh: { type: Sequelize.STRING(64), allowNull: false, unique: true },
          cadena_id: { type: Sequelize.UUID, allowNull: false },
          reemplazada_por: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'sesiones', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          dispositivo: { type: Sequelize.STRING(255), allowNull: true },
          ip: { type: Sequelize.STRING(45), allowNull: true },
          expira_en: { type: Sequelize.DATE, allowNull: false },
          revocada_en: { type: Sequelize.DATE, allowNull: true },
          ultimo_uso_en: { type: Sequelize.DATE, allowNull: true },
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
      await queryInterface.addIndex('sesiones', ['cadena_id'], {
        name: 'sesiones_cadena_id',
        transaction,
      });
      await queryInterface.addIndex('sesiones', ['usuario_id'], {
        name: 'sesiones_usuario_id',
        transaction,
      });

      // tokens_recuperacion
      await queryInterface.createTable(
        'tokens_recuperacion',
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
          hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
          tipo: { type: Sequelize.STRING(20), allowNull: false },
          expira_en: { type: Sequelize.DATE, allowNull: false },
          usado_en: { type: Sequelize.DATE, allowNull: true },
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
      await sql(`ALTER TABLE tokens_recuperacion
  ADD CONSTRAINT tokens_recuperacion_tipo_check CHECK (tipo IN ('recuperar', 'invitar', 'verificar_correo'))`);
      await queryInterface.addIndex('tokens_recuperacion', ['usuario_id'], {
        name: 'tokens_recuperacion_usuario_id',
        transaction,
      });

      // dispositivos
      await queryInterface.createTable(
        'dispositivos',
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
          token_fcm: { type: Sequelize.STRING(512), allowNull: false, unique: true },
          plataforma: { type: Sequelize.STRING(10), allowNull: false },
          ultimo_uso_en: { type: Sequelize.DATE, allowNull: true },
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
      await sql(`ALTER TABLE dispositivos
  ADD CONSTRAINT dispositivos_plataforma_check CHECK (plataforma IN ('android', 'ios', 'web'))`);
      await queryInterface.addIndex('dispositivos', ['usuario_id'], {
        name: 'dispositivos_usuario_id',
        transaction,
      });

      // preferencias
      await queryInterface.createTable(
        'preferencias',
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
            unique: true,
            references: { model: 'usuarios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          notificaciones: {
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
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('preferencias', { transaction });
      await queryInterface.dropTable('dispositivos', { transaction });
      await queryInterface.dropTable('tokens_recuperacion', { transaction });
      await queryInterface.dropTable('sesiones', { transaction });
      await queryInterface.dropTable('usuarios', { transaction });
      await queryInterface.dropTable('rol_permiso', { transaction });
      await queryInterface.dropTable('permisos', { transaction });
      await queryInterface.dropTable('roles', { transaction });
    });
  },
};
