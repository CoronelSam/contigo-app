'use strict';

// Adaptador FCM con firebase-admin simulado (sin red ni credenciales reales).

const mockEnviar = jest.fn();

jest.mock('firebase-admin/app', () => ({
  getApps: jest.fn(() => []),
  initializeApp: jest.fn((opciones, nombre) => ({ name: nombre, opciones })),
  cert: jest.fn((c) => ({ proyecto: c.project_id })),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ sendEachForMulticast: (...a) => mockEnviar(...a) })),
}));

const app = require('firebase-admin/app');
const { crearProveedorFcm } = require('../push/fcm');

const credencialesBase64 = Buffer.from(
  JSON.stringify({ project_id: 'proyecto-ficticio', client_email: 'x@ficticio.test' }),
).toString('base64');

beforeEach(() => {
  mockEnviar.mockReset();
  mockEnviar.mockImplementation(async ({ tokens }) => ({
    responses: tokens.map((t) =>
      t.startsWith('malo')
        ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
        : { success: true, messageId: `id-${t}` },
    ),
  }));
});

test('envía en lotes de 500 con notificación y data, y traduce los códigos de error', async () => {
  const fcm = crearProveedorFcm({ credencialesBase64 });
  const tokens = [...Array.from({ length: 500 }, (_, i) => `token-${i}`), 'malo-1'];
  const datos = { tipo: 'MENSAJE_NUEVO', enlace: 'notificaciones', notificacionId: 'n-1' };
  const resultados = await fcm.enviar({ tokens, titulo: 'Mensaje nuevo', cuerpo: 'Texto', datos });

  expect(mockEnviar).toHaveBeenCalledTimes(2);
  expect(mockEnviar.mock.calls[0][0]).toMatchObject({
    notification: { title: 'Mensaje nuevo', body: 'Texto' },
    data: datos,
  });
  expect(mockEnviar.mock.calls[0][0].tokens).toHaveLength(500);
  expect(mockEnviar.mock.calls[1][0].tokens).toEqual(['malo-1']);
  expect(resultados).toHaveLength(501);
  expect(resultados[0]).toEqual({ token: 'token-0', ok: true, error: null });
  expect(resultados.at(-1)).toEqual({
    token: 'malo-1',
    ok: false,
    error: 'registration-token-not-registered',
  });

  // Se inicializa una sola vez, con la cuenta de servicio decodificada.
  await fcm.enviar({ tokens: ['token-x'], titulo: 'T', cuerpo: 'C', datos });
  expect(app.initializeApp).toHaveBeenCalledTimes(1);
  expect(app.cert).toHaveBeenCalledWith(
    expect.objectContaining({ project_id: 'proyecto-ficticio' }),
  );
});
