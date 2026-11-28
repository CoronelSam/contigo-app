'use strict';

// Push simulado (desarrollo y pruebas): no sale nada de la máquina. Guarda en memoria lo enviado.
// Para probar errores, el token decide la respuesta:
//   - empieza con `invalido` → `registration-token-not-registered` (el dispositivo se borra);
//   - empieza con `caido`    → `server-unavailable` (error temporal, el trabajo se reintenta).

/** @type {{ token: string, titulo: string, cuerpo: string, datos: Record<string, string> }[]} */
const enviados = [];

function respuestaPara(token) {
  if (token.startsWith('invalido'))
    return { ok: false, error: 'registration-token-not-registered' };
  if (token.startsWith('caido')) return { ok: false, error: 'server-unavailable' };
  return { ok: true, error: null };
}

const proveedor = Object.freeze({
  nombre: 'simulado',
  /**
   * @param {{ tokens: string[], titulo: string, cuerpo: string, datos: Record<string, string> }} p
   * @returns {Promise<{ token: string, ok: boolean, error: string | null }[]>}
   */
  async enviar({ tokens, titulo, cuerpo, datos }) {
    return tokens.map((token) => {
      const r = respuestaPara(token);
      if (r.ok) enviados.push({ token, titulo, cuerpo, datos });
      return { token, ...r };
    });
  },
});

/** Vacía lo enviado (pruebas). */
function reiniciar() {
  enviados.length = 0;
}

module.exports = { proveedor, enviados, reiniciar };
