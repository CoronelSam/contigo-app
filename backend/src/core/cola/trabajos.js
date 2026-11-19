'use strict';

// Nombres de los trabajos en cola. Lista cerrada: agregar uno exige actualizar src/jobs.js.

const TRABAJOS = Object.freeze({
  OCR_PROCESAR: 'ocr.procesar',
  PAQUETE_GENERAR: 'paquete.generar',
  NOTIFICACION_PUSH: 'notificacion.push',
  CORREO_ENVIAR: 'correo.enviar',
});

const NOMBRES = Object.freeze(Object.values(TRABAJOS));

/** Lanza si el nombre no es un trabajo conocido (error de programación). */
function validarNombre(nombre) {
  if (!NOMBRES.includes(nombre)) {
    throw new Error(
      `Trabajo desconocido: "${nombre}". Usa las constantes de core/cola/trabajos.js`,
    );
  }
}

module.exports = { ...TRABAJOS, TRABAJOS, NOMBRES, validarNombre };
