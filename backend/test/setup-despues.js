'use strict';

// Corre en cada archivo de prueba: cierra la conexión a la base al terminar.
// Crear la instancia de Sequelize no abre conexiones hasta la primera consulta.

afterAll(async () => {
  const { sequelize } = require('../src/models');
  await sequelize.close();
});
