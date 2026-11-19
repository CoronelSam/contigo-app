'use strict';

const { sembrarTextosConsentimiento } = require('../semillas');

/** Textos de consentimiento de prueba (versión 1, es y en). Reemplazar por los textos legales aprobados. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) =>
      sembrarTextosConsentimiento({ queryInterface, transaction }),
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('textos_consentimiento', { version: 1 });
  },
};
