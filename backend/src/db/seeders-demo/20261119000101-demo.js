'use strict';

const { sembrarDemo } = require('../semillas/demo');

/**
 * Datos de demostración ficticios: pnpm db:seed:demo (nunca en producción).
 * Usuarios *.demo@vanguardia.test con la contraseña de SEED_DEMO_CONTRASENA.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) =>
      sembrarDemo({ queryInterface, transaction, contrasena: process.env.SEED_DEMO_CONTRASENA }),
    );
  },

  async down() {
    // Los datos de demostración se quitan con pnpm db:reset.
  },
};
