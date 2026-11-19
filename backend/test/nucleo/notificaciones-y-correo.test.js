'use strict';

const db = require('../../src/models');
const f = require('../factories');
const { limpiarBase } = require('../helpers/db');
const cola = require('../../src/core/cola');
const T = require('../../src/core/cola/trabajos');
const { notificar, renderizar, TIPOS, CATEGORIAS } = require('../../src/core/notificaciones');
const correo = require('../../src/core/correo');
const {
  renderizarCorreo,
  PLANTILLAS: PLANTILLAS_CORREO,
} = require('../../src/core/correo/plantillas');

const { sequelize } = db;

const VARIABLES = {
  nombre: 'Ana',
  codigo: 'HN-0001',
  solicitudId: '7d4f3c0e-6f1a-4b8e-9a51-2a3c4d5e6f70',
  estado: 'ENVIADA',
  ruta: 'INTERNACIONAL',
  fecha: '2026-12-03',
  hora: '09:00',
  proveedor: 'Clínica de prueba',
};

describe('plantillas de notificación', () => {
  test.each(TIPOS)('%s existe en es y en, con categoría y enlace', (tipo) => {
    for (const idioma of ['es', 'en']) {
      const r = renderizar(tipo, idioma, VARIABLES);
      expect(r.titulo.length).toBeGreaterThan(3);
      expect(r.cuerpo.length).toBeGreaterThan(10);
      expect(Object.values(CATEGORIAS)).toContain(r.categoria);
      expect(r.enlace).toMatch(/^solicitudes\//);
      expect(r.cuerpo).not.toMatch(/undefined|null/);
    }
  });

  test('ninguna presenta algo como aceptado ni promete plazos', () => {
    const estados = ['EN_EVALUACION', 'COMPLETA', 'ENVIADA', 'DERIVADA_HN', 'ATENDIDA_HN', 'OTRO'];
    const rutas = ['HONDURAS', 'MEXICO', 'INTERNACIONAL'];
    for (const tipo of TIPOS) {
      for (const idioma of ['es', 'en']) {
        for (const estado of estados) {
          for (const ruta of rutas) {
            const { titulo, cuerpo } = renderizar(tipo, idioma, { ...VARIABLES, estado, ruta });
            const texto = `${titulo} ${cuerpo}`;
            expect({ tipo, idioma, texto }).not.toEqual(
              expect.objectContaining({
                texto: expect.stringMatching(
                  /aceptad|accepted|\bplazo|días hábiles|business days/i,
                ),
              }),
            );
          }
        }
      }
    }
  });

  test('el envío a revisión aclara que no es una aceptación médica', () => {
    expect(renderizar('SOLICITUD_ENVIADA', 'es', VARIABLES).cuerpo).toContain(
      'no es una aceptación médica',
    );
    expect(renderizar('SOLICITUD_ENVIADA', 'en', VARIABLES).cuerpo).toContain(
      'not a medical acceptance',
    );
  });

  test('la ruta al exterior aclara que Shriners decide', () => {
    expect(renderizar('RUTA_DECIDIDA', 'es', { ...VARIABLES, ruta: 'MEXICO' }).cuerpo).toContain(
      'Shriners decidirá',
    );
    expect(
      renderizar('RUTA_DECIDIDA', 'en', { ...VARIABLES, ruta: 'INTERNACIONAL' }).cuerpo,
    ).toContain('Shriners will decide');
  });

  test('un tipo desconocido es un error de programación', () => {
    expect(() => renderizar('INVENTADO', 'es', {})).toThrow(/desconocido/);
  });
});

describe('notificar', () => {
  beforeEach(async () => {
    await limpiarBase();
    cola.vaciar();
  });

  test('crea una notificación por usuario activo, en su idioma, y encola el push tras el commit', async () => {
    const es = await f.crearUsuario({ idioma: 'es' });
    const en = await f.crearUsuario({ idioma: 'en' });
    const inactivo = await f.crearUsuario({ estado: 'inactivo' });
    const { id: solicitudId } = await f.crearSolicitud();

    const creadas = await sequelize.transaction(async (transaction) => {
      const r = await notificar({
        usuarioIds: [es.id, en.id, inactivo.id, es.id],
        tipo: 'DOCUMENTOS_PENDIENTES',
        variables: { nombre: 'Ana' },
        solicitudId,
        transaction,
      });
      expect(cola.pendientes()).toHaveLength(0);
      return r;
    });

    expect(creadas.map((n) => [n.usuarioId, n.idioma]).sort()).toEqual(
      [
        [en.id, 'en'],
        [es.id, 'es'],
      ].sort(),
    );
    const [espanol] = creadas.filter((n) => n.idioma === 'es');
    expect(espanol.titulo).toBe('Documentos pendientes');
    expect(espanol.datos).toEqual({
      enlace: `solicitudes/${solicitudId}/documentos`,
      categoria: 'documentos',
      solicitudId,
    });
    expect(
      cola
        .pendientes()
        .map((t) => [t.nombre, t.datos.notificacionId])
        .sort(),
    ).toEqual(creadas.map((n) => [T.NOTIFICACION_PUSH, n.id]).sort());
  });

  test('por rol notifica a todos los usuarios activos de ese rol', async () => {
    await f.crearUsuario({ rol: 'coordinador' });
    await f.crearUsuario({ rol: 'coordinador' });
    await f.crearUsuario({ rol: 'voluntario' });
    const creadas = await notificar({
      rol: 'coordinador',
      tipo: 'SOLICITUD_EN_REVISION',
      variables: { codigo: 'HN-0001' },
    });
    expect(creadas).toHaveLength(2);
  });

  test('si la transacción se revierte no queda notificación ni push', async () => {
    const u = await f.crearUsuario();
    await expect(
      sequelize.transaction(async (transaction) => {
        await notificar({
          usuarioIds: [u.id],
          tipo: 'MENSAJE_NUEVO',
          variables: { codigo: 'HN-1' },
          transaction,
        });
        throw new Error('revertir');
      }),
    ).rejects.toThrow('revertir');
    expect(await db.Notificacion.count()).toBe(0);
    expect(cola.pendientes()).toHaveLength(0);
  });
});

describe('correo', () => {
  beforeEach(() => {
    correo.limpiarEnviados();
    cola.vaciar();
  });

  test.each(Object.keys(PLANTILLAS_CORREO))(
    '%s existe en es y en con asunto, texto y html',
    (plantilla) => {
      for (const idioma of ['es', 'en']) {
        const r = renderizarCorreo(plantilla, idioma, {
          nombre: 'Ana',
          enlace: 'vanguardia://x?t=1',
          rol: 'voluntario',
        });
        expect(r.asunto).toBeTruthy();
        expect(r.texto).toContain('vanguardia://x?t=1');
        expect(r.html).toContain('href="vanguardia://x?t=1"');
      }
    },
  );

  test('el html escapa las variables', () => {
    const { html } = renderizarCorreo('verificar_correo', 'es', {
      nombre: '<script>alert(1)</script>',
      enlace: 'vanguardia://v',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('enviarCorreo con el proveedor simulado lo guarda en memoria', async () => {
    await correo.enviarCorreo({
      plantilla: 'recuperar_contrasena',
      para: 'familia@pruebas.test',
      idioma: 'en',
      variables: { nombre: 'Ana', enlace: 'vanguardia://r' },
    });
    expect(correo.enviados).toHaveLength(1);
    expect(correo.enviados[0]).toMatchObject({
      plantilla: 'recuperar_contrasena',
      para: 'familia@pruebas.test',
      asunto: 'Reset your Vanguardia password',
    });
  });

  test('encolarCorreo usa el trabajo correo.enviar y el worker lo envía', async () => {
    await correo.encolarCorreo({
      plantilla: 'invitacion',
      para: 'nuevo@pruebas.test',
      variables: { nombre: 'Luis', enlace: 'vanguardia://i', rol: 'coordinador' },
    });
    expect(cola.pendientes().map((t) => t.nombre)).toEqual([T.CORREO_ENVIAR]);
    await cola.procesarPendientes();
    expect(correo.enviados.map((c) => c.plantilla)).toEqual(['invitacion']);
    await expect(
      correo.encolarCorreo({ plantilla: 'inventada', para: 'x@pruebas.test' }),
    ).rejects.toThrow(/desconocida/);
  });

  test('enmascara el destinatario para los logs', () => {
    expect(correo.enmascarar('familia@pruebas.test')).toBe('fa***@pruebas.test');
  });
});
