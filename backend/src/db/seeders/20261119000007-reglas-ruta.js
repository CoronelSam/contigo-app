'use strict';

const { REGLAS, sembrarReglasRuta } = require('../semillas');

/** Reglas de ruta de ejemplo, versión 1 activa. Los criterios reales están pendientes. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) =>
      sembrarReglasRuta({ queryInterface, transaction }),
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('reglas_ruta', { version: REGLAS.version });
  },
};
