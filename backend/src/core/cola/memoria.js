'use strict';

// Cola en memoria para pruebas: los trabajos se guardan y se ejecutan con procesarPendientes().

const { validarNombre } = require('./trabajos');

function crearColaMemoria({ log }) {
  /** @type {Map<string, Function>} */
  const handlers = new Map();
  let cola = [];
  let secuencia = 0;

  function resolverHandler(nombre) {
    if (handlers.has(nombre)) return handlers.get(nombre);
    // Si la prueba no registró uno propio, se usa el handler real del módulo dueño.
    const cargar = require('../../jobs')[nombre];
    if (!cargar) throw new Error(`No hay handler para el trabajo "${nombre}"`);
    return cargar();
  }

  return {
    proveedor: 'memoria',

    async iniciar() {},

    async detener() {},

    async registrar(nombre, handler) {
      validarNombre(nombre);
      handlers.set(nombre, handler);
    },

    async enviar(nombre, datos = {}, opciones = {}) {
      validarNombre(nombre);
      secuencia += 1;
      const id = `memoria-${secuencia}`;
      cola.push({ id, nombre, datos: structuredClone(datos), opciones });
      return id;
    },

    /** Trabajos encolados que aún no se procesan. */
    pendientes() {
      return cola.map((t) => ({ ...t }));
    },

    /** Descarta los trabajos pendientes y los handlers registrados por las pruebas. */
    vaciar() {
      cola = [];
      handlers.clear();
    },

    /**
     * Ejecuta en orden todos los trabajos pendientes, incluidos los que se encolen mientras tanto.
     * @param {{ lanzarErrores?: boolean }} [opciones]
     */
    async procesarPendientes({ lanzarErrores = true } = {}) {
      const procesados = [];
      const fallidos = [];
      let vueltas = 0;
      while (cola.length) {
        vueltas += 1;
        if (vueltas > 1000)
          throw new Error('Demasiados trabajos encadenados en la cola en memoria');
        const t = cola.shift();
        const handler = resolverHandler(t.nombre);
        const trabajo = { id: t.id, name: t.nombre, data: t.datos, retryCount: 0 };
        try {
          await handler(t.datos, {
            trabajo,
            logger: log.child({ trabajo: t.nombre, trabajoId: t.id }),
          });
          procesados.push(t);
        } catch (error) {
          fallidos.push({ ...t, error });
          if (lanzarErrores) throw error;
        }
      }
      return { procesados, fallidos };
    },

    async verificar() {
      return true;
    },
  };
}

module.exports = { crearColaMemoria };
