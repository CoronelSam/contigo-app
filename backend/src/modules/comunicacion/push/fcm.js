'use strict';

// Push con Firebase Cloud Messaging (firebase-admin). Se inicializa al primer envío con la cuenta
// de servicio de FCM_CREDENCIALES_JSON_BASE64.

const NOMBRE_APP = 'vanguardia-push';
/** FCM acepta hasta 500 tokens por envío. */
const LOTE = 500;

/**
 * @param {{ credencialesBase64: string }} cfg
 */
function crearProveedorFcm({ credencialesBase64 }) {
  let mensajeria;

  function obtener() {
    if (!mensajeria) {
      const { initializeApp, cert, getApps } = require('firebase-admin/app');
      const { getMessaging } = require('firebase-admin/messaging');
      const credenciales = JSON.parse(Buffer.from(credencialesBase64, 'base64').toString('utf8'));
      const app =
        getApps().find((a) => a.name === NOMBRE_APP) ??
        initializeApp({ credential: cert(credenciales) }, NOMBRE_APP);
      mensajeria = getMessaging(app);
    }
    return mensajeria;
  }

  return Object.freeze({
    nombre: 'fcm',
    /**
     * @param {{ tokens: string[], titulo: string, cuerpo: string, datos: Record<string, string> }} p
     * @returns {Promise<{ token: string, ok: boolean, error: string | null }[]>}
     */
    async enviar({ tokens, titulo, cuerpo, datos }) {
      const resultados = [];
      for (let i = 0; i < tokens.length; i += LOTE) {
        const lote = tokens.slice(i, i + LOTE);
        const respuesta = await obtener().sendEachForMulticast({
          tokens: lote,
          notification: { title: titulo, body: cuerpo },
          data: datos,
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default' } } },
        });
        respuesta.responses.forEach((r, j) => {
          resultados.push({
            token: lote[j],
            ok: r.success,
            error: r.success
              ? null
              : String(r.error?.code ?? 'unknown-error').replace(/^messaging\//, ''),
          });
        });
      }
      return resultados;
    },
  });
}

module.exports = { crearProveedorFcm };
