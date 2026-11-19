'use strict';

const { PERMISOS, sembrarRolesYPermisos } = require('../semillas');

/** Roles fijos, permisos y su relación (ver src/db/seeders/data/permisos.json). */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) =>
      sembrarRolesYPermisos({ queryInterface, transaction }),
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.bulkDelete('rol_permiso', null, { transaction });
      await queryInterface.bulkDelete(
        'permisos',
        { codigo: PERMISOS.permisos.map((p) => p.codigo) },
        { transaction },
      );
      await queryInterface.bulkDelete(
        'roles',
        { codigo: PERMISOS.roles.map((r) => r.codigo) },
        { transaction },
      );
    });
  },
};
