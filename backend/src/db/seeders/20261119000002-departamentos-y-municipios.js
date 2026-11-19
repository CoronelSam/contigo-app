'use strict';

const { sembrarDepartamentosYMunicipios } = require('../semillas');

/**
 * 18 departamentos y 298 municipios con su código oficial (ver data/municipios.csv).
 * Pendiente de verificar contra la fuente oficial del INE o del RNP.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) =>
      sembrarDepartamentosYMunicipios({ queryInterface, transaction }),
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.bulkDelete('municipios', null, { transaction });
      await queryInterface.bulkDelete('departamentos', null, { transaction });
    });
  },
};
