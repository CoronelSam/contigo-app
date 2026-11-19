'use strict';

/**
 * Extensiones y funciones de apoyo: pgcrypto (gen_random_uuid), pg_trgm (búsqueda por nombre),
 * unaccent y f_unaccent(), una envoltura IMMUTABLE de unaccent para poder indexarla.
 * Las 3 extensiones son "de confianza": las puede crear el dueño de la base sin ser superusuario.
 * No modifiques esta migración: cualquier cambio va en una migración nueva.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (texto) => queryInterface.sequelize.query(texto, { transaction });
      await sql('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await sql('CREATE EXTENSION IF NOT EXISTS unaccent');
      await sql(`CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
        AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (texto) => queryInterface.sequelize.query(texto, { transaction });
      await sql('DROP FUNCTION IF EXISTS f_unaccent(text)');
      await sql('DROP EXTENSION IF EXISTS unaccent');
      await sql('DROP EXTENSION IF EXISTS pg_trgm');
      await sql('DROP EXTENSION IF EXISTS pgcrypto');
    });
  },
};
