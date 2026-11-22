'use strict';

// Motor de OCR en la nube: interfaz lista, sin implementar. El proveedor se elige tras la prueba
// comparativa, y enviar imágenes con datos médicos de menores a un tercero requiere la aprobación
// de la organización (y un acuerdo de tratamiento de datos).

const { NoImplementado } = require('../../../core/errores');

module.exports = {
  nombre: 'nube',

  async procesar() {
    throw new NoImplementado('El motor de OCR en la nube');
  },

  async verificar() {
    throw new NoImplementado('El motor de OCR en la nube');
  },
};
