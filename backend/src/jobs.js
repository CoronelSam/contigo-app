'use strict';

// Trabajo en cola → handler del módulo dueño (carga diferida).
// Cada handler: async (datos, { trabajo, logger }) => { ... }

const T = require('./core/cola/trabajos');

module.exports = {
  [T.OCR_PROCESAR]: () => require('./modules/ocr/jobs/procesar'), // agente 07
  [T.PAQUETE_GENERAR]: () => require('./modules/paquetes/jobs/generar'), // agente 11
  [T.NOTIFICACION_PUSH]: () => require('./modules/comunicacion/jobs/push'), // agente 12
  [T.CORREO_ENVIAR]: () => require('./core/correo/job'), // agente 02
};
