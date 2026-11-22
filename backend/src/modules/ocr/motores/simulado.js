'use strict';

// Motor simulado: determinista, para pruebas y desarrollo. Devuelve los resultados de
// `fixtures/simulado.json` por nombre de campo y, para el resto, un valor según el tipo.
// No lee las imágenes.

const RESULTADOS = require('./fixtures/simulado.json');

const CONFIANZA_POR_DEFECTO = 0.9;

function porDefecto(zona) {
  switch (zona.tipo) {
    case 'fecha':
      return zona.formato === 'AAAA-MM-DD' ? '2020-02-01' : '01/02/2020';
    case 'numero':
      return '3';
    case 'casilla':
      return 'false';
    case 'opcion':
      return zona.opciones?.[0] ?? 'otra';
    default:
      return `Texto ficticio (${zona.campo})`;
  }
}

module.exports = {
  nombre: 'simulado',

  /**
   * @param {{ paginas: Array<{ numero: number }>, zonas: object[],
   *   alProgresar?: (numero: number) => Promise<void> | void }} p
   */
  async procesar({ paginas, zonas, alProgresar }) {
    const numeros = new Set(paginas.map((p) => p.numero));
    const campos = zonas
      .filter((z) => numeros.has(z.pagina))
      .map((z) => {
        const fijo = RESULTADOS[z.campo];
        return {
          campo: z.campo,
          valor: fijo?.valor ?? porDefecto(z),
          confianza: fijo?.confianza ?? CONFIANZA_POR_DEFECTO,
          pagina: z.pagina,
          coordenadas: z.caja,
        };
      });
    for (const p of paginas) await alProgresar?.(p.numero);
    return { motor: 'simulado', campos, crudo: { simulado: true } };
  },

  async verificar() {
    return true;
  },
};
