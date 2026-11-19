'use strict';

const { REQUISITOS, sembrarTiposYRequisitos } = require('../semillas');

/** Tipos de documento y requisitos por ruta (ver data/requisitos.json). */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) =>
      sembrarTiposYRequisitos({ queryInterface, transaction }),
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const codigos = REQUISITOS.tipos.map((t) => t.codigo);
      await queryInterface.sequelize.query(
        'DELETE FROM requisitos_ruta WHERE tipo_documento_id IN (SELECT id FROM tipos_documento WHERE codigo IN (:codigos))',
        { replacements: { codigos }, transaction },
      );
      await queryInterface.bulkDelete('tipos_documento', { codigo: codigos }, { transaction });
    });
  },
};
