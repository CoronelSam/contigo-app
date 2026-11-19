'use strict';

const { CATALOGOS, sembrarCatalogos } = require('../semillas');

/** Catálogos bilingües iniciales (ver data/catalogos.json). Valores para revisar con la organización. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) =>
      sembrarCatalogos({ queryInterface, transaction }),
    );
  },

  async down(queryInterface) {
    const tipos = Object.keys(CATALOGOS).filter((t) => !t.startsWith('_'));
    await queryInterface.bulkDelete('catalogos_items', { tipo: tipos });
  },
};
