'use strict';

const { CONFIGURACION, sembrarConfiguracion } = require('../semillas');

/** Configuración base: contactos de prueba y valores seguros de las decisiones pendientes. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) =>
      sembrarConfiguracion({ queryInterface, transaction }),
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('configuracion', { clave: Object.keys(CONFIGURACION) });
  },
};
