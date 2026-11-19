'use strict';

const db = require('../../src/models');
const f = require('../factories');
const { limpiarBase } = require('../helpers/db');
const cola = require('../../src/core/cola');
const T = require('../../src/core/cola/trabajos');
const eventos = require('../../src/core/eventos');
const estados = require('../../src/core/estados');

const { sequelize } = db;
const { TRANSICIONES, cambiarEstado, transicionesPosibles } = estados;
const ROLES = ['familia', 'voluntario', 'coordinador', 'administrador'];
const como = (u) => ({ id: u.id, rol: u.rolCodigo });

/** Prepara una solicitud que cumpla las condiciones de la transición. */
async function solicitudPara(transicion, de) {
  const datos = { estado: de };
  if (transicion.etapa) datos.etapa = transicion.etapa;
  if (transicion.accion === 'derivar_honduras') datos.rutaDecidida = 'HONDURAS';
  if (transicion.accion === 'reabrir_evaluacion' && de !== 'DERIVADA_HN')
    datos.rutaDecidida = 'MEXICO';
  if (transicion.accion === 'reabrir_evaluacion' && de === 'DERIVADA_HN')
    datos.rutaDecidida = 'HONDURAS';
  return f.crearSolicitud(datos);
}

const camposPara = (transicion) =>
  transicion.accion === 'decidir_ruta_exterior' ? { rutaDecidida: 'INTERNACIONAL' } : {};

const enTransaccion = (fn) => sequelize.transaction((transaction) => fn(transaction));

describe('máquina de estados de la solicitud', () => {
  beforeEach(async () => {
    await limpiarBase();
    cola.vaciar();
  });

  describe('matriz de transiciones y roles', () => {
    const casos = TRANSICIONES.filter((t) => t.accion !== 'crear').flatMap((t) =>
      t.de.map((de) => [t.accion, de, t.a, t]),
    );

    test.each(casos)('%s: %s → %s', async (_accion, de, a, transicion) => {
      for (const rol of ROLES) {
        const solicitud = await solicitudPara(transicion, de);
        const usuario = como(await f.crearUsuario({ rol }));
        const intento = enTransaccion((transaction) =>
          cambiarEstado({ solicitud, a, usuario, campos: camposPara(transicion), transaction }),
        );
        if (transicion.roles.includes(rol)) {
          await expect(intento).resolves.toMatchObject({ estado: a });
        } else {
          await expect(intento).rejects.toMatchObject({
            status: 409,
            codigo: 'SOLICITUD_TRANSICION_INVALIDA',
          });
        }
      }
    });
  });

  test('una transición inexistente o en la etapa equivocada responde 409', async () => {
    const coordinador = como(await f.crearUsuario({ rol: 'coordinador' }));
    const borrador = await f.crearSolicitud();
    await expect(
      enTransaccion((transaction) =>
        cambiarEstado({ solicitud: borrador, a: 'ENVIADA', usuario: coordinador, transaction }),
      ),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_TRANSICION_INVALIDA' });

    const evaluacion = await f.crearSolicitud({ estado: 'EN_REVISION', etapa: 'evaluacion' });
    await expect(
      enTransaccion((transaction) =>
        cambiarEstado({ solicitud: evaluacion, a: 'COMPLETA', usuario: coordinador, transaction }),
      ),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_TRANSICION_INVALIDA' });
  });

  test('decidir una ruta al exterior fija el paquete y la etapa; sin ruta válida, 409', async () => {
    const coordinador = como(await f.crearUsuario({ rol: 'coordinador' }));
    const s = await f.crearSolicitud({ estado: 'EN_EVALUACION' });
    await expect(
      enTransaccion((transaction) =>
        cambiarEstado({
          solicitud: s,
          a: 'PAQUETE_EXTERIOR',
          usuario: coordinador,
          campos: { rutaDecidida: 'HONDURAS' },
          transaction,
        }),
      ),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_TRANSICION_INVALIDA' });

    await enTransaccion((transaction) =>
      cambiarEstado({
        solicitud: s,
        a: 'PAQUETE_EXTERIOR',
        usuario: coordinador,
        campos: { rutaDecidida: 'MEXICO' },
        transaction,
      }),
    );
    expect([s.estado, s.rutaDecidida, s.paquete, s.etapa]).toEqual([
      'PAQUETE_EXTERIOR',
      'MEXICO',
      'MEXICO',
      'paquete',
    ]);
  });

  test('reabrir la evaluación limpia la ruta, el paquete y vuelve a la etapa de evaluación', async () => {
    const coordinador = como(await f.crearUsuario({ rol: 'coordinador' }));
    const s = await f.crearSolicitud({ estado: 'DENEGADA', rutaDecidida: 'INTERNACIONAL' });
    expect(s.etapa).toBe('paquete');
    await enTransaccion((transaction) =>
      cambiarEstado({ solicitud: s, a: 'EN_EVALUACION', usuario: coordinador, transaction }),
    );
    expect([s.estado, s.rutaDecidida, s.paquete, s.etapa]).toEqual([
      'EN_EVALUACION',
      null,
      null,
      'evaluacion',
    ]);
  });

  test('escribe historial, bitácora y notificaciones, y encola el push tras el commit', async () => {
    const familia = await f.crearFamilia({ usuario: { idioma: 'en' } });
    const c1 = await f.crearUsuario({ rol: 'coordinador' });
    await f.crearUsuario({ rol: 'coordinador' });
    const s = await f.crearSolicitud({ paciente: familia.paciente, estado: 'CAPTURA' });

    await enTransaccion(async (transaction) => {
      await cambiarEstado({
        solicitud: s,
        a: 'EN_REVISION',
        usuario: como(familia.usuario),
        nota: 'Envío de prueba',
        campos: {
          faltantesAlEnviar: [{ tipo: 'documento', codigo: 'fotos_condicion', motivo: 'falta' }],
          enviadaEn: new Date(),
        },
        transaction,
      });
      expect(cola.pendientes()).toHaveLength(0);
    });

    const historial = await db.HistorialEstado.findAll({ where: { solicitudId: s.id } });
    expect(historial.map((h) => [h.estadoAnterior, h.estadoNuevo, h.nota, h.usuarioId])).toEqual([
      ['CAPTURA', 'EN_REVISION', 'Envío de prueba', familia.usuario.id],
    ]);
    const bitacora = await db.Bitacora.findOne({ where: { solicitudId: s.id } });
    expect(bitacora.accion).toBe('solicitud.enviar');
    expect(bitacora.antes.estado).toBe('CAPTURA');
    expect(bitacora.despues.estado).toBe('EN_REVISION');

    const aFamilia = await db.Notificacion.findAll({ where: { usuarioId: familia.usuario.id } });
    expect(aFamilia.map((n) => [n.tipo, n.idioma])).toEqual([['SOLICITUD_ENVIADA', 'en']]);
    expect(aFamilia[0].cuerpo).toContain('This is not a medical acceptance');
    expect(aFamilia[0].datos.enlace).toBe(`solicitudes/${s.id}/seguimiento`);
    const aCoordinadores = await db.Notificacion.findAll({
      where: { tipo: 'SOLICITUD_EN_REVISION' },
    });
    expect(aCoordinadores).toHaveLength(2);

    expect(cola.pendientes().filter((t) => t.nombre === T.NOTIFICACION_PUSH)).toHaveLength(3);

    // Con coordinador asignado solo se avisa a ese coordinador.
    cola.vaciar();
    await db.Notificacion.destroy({ where: {} });
    const s2 = await f.crearSolicitud({
      paciente: familia.paciente,
      estado: 'INFO_ADICIONAL',
      coordinadorId: c1.id,
    });
    await enTransaccion((transaction) =>
      cambiarEstado({
        solicitud: s2,
        a: 'EN_REVISION',
        usuario: como(familia.usuario),
        transaction,
      }),
    );
    expect(
      (await db.Notificacion.findAll({ where: { tipo: 'SOLICITUD_EN_REVISION' } })).map(
        (n) => n.usuarioId,
      ),
    ).toEqual([c1.id]);
  });

  test('si la transacción se revierte no queda rastro: ni estado, historial, bitácora, notificaciones, push ni eventos', async () => {
    const recibidos = [];
    const cancelar = eventos.suscribir(eventos.EVENTOS.SOLICITUD_ESTADO_CAMBIADO, (d) =>
      recibidos.push(d),
    );
    const familia = await f.crearFamilia();
    const s = await f.crearSolicitud({ paciente: familia.paciente, estado: 'CAPTURA' });
    const antes = {
      historial: await db.HistorialEstado.count(),
      bitacora: await db.Bitacora.count(),
      notificaciones: await db.Notificacion.count(),
    };

    await expect(
      enTransaccion(async (transaction) => {
        await cambiarEstado({
          solicitud: s,
          a: 'EN_REVISION',
          usuario: como(familia.usuario),
          transaction,
        });
        throw new Error('falla después del cambio');
      }),
    ).rejects.toThrow('falla después del cambio');
    await eventos.esperarEventos();
    cancelar();

    expect((await db.Solicitud.findByPk(s.id)).estado).toBe('CAPTURA');
    expect({
      historial: await db.HistorialEstado.count(),
      bitacora: await db.Bitacora.count(),
      notificaciones: await db.Notificacion.count(),
    }).toEqual(antes);
    expect(cola.pendientes()).toHaveLength(0);
    expect(recibidos).toEqual([]);
  });

  test('emite solicitud.estado_cambiado después del commit', async () => {
    const recibidos = [];
    const cancelar = eventos.suscribir(eventos.EVENTOS.SOLICITUD_ESTADO_CAMBIADO, (d) =>
      recibidos.push(d),
    );
    const familia = await f.crearFamilia();
    const s = await f.crearSolicitud({ paciente: familia.paciente });
    await enTransaccion((transaction) =>
      cambiarEstado({ solicitud: s, a: 'CAPTURA', usuario: como(familia.usuario), transaction }),
    );
    await eventos.esperarEventos();
    cancelar();
    expect(recibidos).toEqual([
      { solicitudId: s.id, de: 'BORRADOR', a: 'CAPTURA', accion: 'elegir_modalidad' },
    ]);
  });

  test('una instancia desactualizada no puede cambiar el estado (409)', async () => {
    const familia = await f.crearFamilia();
    const s = await f.crearSolicitud({ paciente: familia.paciente, estado: 'CAPTURA' });
    const copia = await db.Solicitud.findByPk(s.id);
    await enTransaccion((transaction) =>
      cambiarEstado({
        solicitud: s,
        a: 'EN_REVISION',
        usuario: como(familia.usuario),
        transaction,
      }),
    );
    await expect(
      enTransaccion((transaction) =>
        cambiarEstado({
          solicitud: copia,
          a: 'EN_REVISION',
          usuario: como(familia.usuario),
          transaction,
        }),
      ),
    ).rejects.toMatchObject({ status: 409, codigo: 'SOLICITUD_ESTADO_DESACTUALIZADO' });
  });

  test('las notificaciones se pueden apagar o reemplazar', async () => {
    const coordinador = como(await f.crearUsuario({ rol: 'coordinador' }));
    const familia = await f.crearFamilia();
    const s = await f.crearSolicitud({
      paciente: familia.paciente,
      estado: 'EN_EVALUACION',
      rutaDecidida: 'HONDURAS',
    });
    await enTransaccion((transaction) =>
      cambiarEstado({
        solicitud: s,
        a: 'DERIVADA_HN',
        usuario: coordinador,
        notificacion: {
          tipo: 'CITA_PROGRAMADA',
          variables: { fecha: '2026-12-03', hora: '09:00', proveedor: 'Clínica de prueba' },
        },
        transaction,
      }),
    );
    const [cita] = await db.Notificacion.findAll({ where: { usuarioId: familia.usuario.id } });
    expect(cita.tipo).toBe('CITA_PROGRAMADA');
    expect(cita.cuerpo).toContain('03/12/2026');

    await enTransaccion((transaction) =>
      cambiarEstado({
        solicitud: s,
        a: 'ATENDIDA_HN',
        usuario: coordinador,
        notificacion: false,
        transaction,
      }),
    );
    expect(await db.Notificacion.count({ where: { usuarioId: familia.usuario.id } })).toBe(1);
  });

  test('exige transacción y solo admite los campos permitidos', async () => {
    const familia = await f.crearFamilia();
    const s = await f.crearSolicitud({ paciente: familia.paciente });
    await expect(
      cambiarEstado({ solicitud: s, a: 'CAPTURA', usuario: como(familia.usuario) }),
    ).rejects.toThrow(/transacción/);
    await expect(
      enTransaccion((transaction) =>
        cambiarEstado({
          solicitud: s,
          a: 'CAPTURA',
          usuario: como(familia.usuario),
          campos: { codigo: 'X' },
          transaction,
        }),
      ),
    ).rejects.toThrow(/no admite/);
  });

  test('transicionesPosibles según rol, estado, etapa y ruta', async () => {
    const familia = { rol: 'familia' };
    const coordinador = { rol: 'coordinador' };
    expect(transicionesPosibles({ estado: 'CAPTURA', etapa: 'evaluacion' }, familia)).toEqual([
      { accion: 'enviar', a: 'EN_REVISION' },
    ]);
    expect(
      transicionesPosibles({ estado: 'EN_REVISION', etapa: 'evaluacion' }, coordinador).map(
        (t) => t.a,
      ),
    ).toEqual(['INFO_ADICIONAL', 'EN_EVALUACION']);
    expect(
      transicionesPosibles(
        { estado: 'EN_EVALUACION', etapa: 'evaluacion', rutaDecidida: null },
        coordinador,
      ).map((t) => t.accion),
    ).toEqual(['decidir_ruta_exterior']);
    expect(
      transicionesPosibles(
        { estado: 'EN_EVALUACION', etapa: 'evaluacion', rutaDecidida: 'HONDURAS' },
        coordinador,
      ).map((t) => t.accion),
    ).toEqual(['decidir_ruta_exterior', 'derivar_honduras']);
    expect(transicionesPosibles({ estado: 'ACEPTADA', etapa: 'paquete' }, coordinador)).toEqual([]);
  });

  test('registrarCreacion deja el historial inicial y solo la familia crea', async () => {
    const familia = await f.crearFamilia();
    const s = await f.crearSolicitud({ paciente: familia.paciente });
    await enTransaccion((transaction) =>
      estados.registrarCreacion({ solicitud: s, usuario: como(familia.usuario), transaction }),
    );
    const [h] = await db.HistorialEstado.findAll({ where: { solicitudId: s.id } });
    expect([h.estadoAnterior, h.estadoNuevo]).toEqual([null, 'BORRADOR']);
    const coordinador = como(await f.crearUsuario({ rol: 'coordinador' }));
    await expect(
      enTransaccion((transaction) =>
        estados.registrarCreacion({ solicitud: s, usuario: coordinador, transaction }),
      ),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_TRANSICION_INVALIDA' });
  });

  test('actualizarCamposRuta guarda la ruta Honduras sin cambiar el estado', async () => {
    const coordinador = como(await f.crearUsuario({ rol: 'coordinador' }));
    const familia = await f.crearFamilia();
    const s = await f.crearSolicitud({ paciente: familia.paciente, estado: 'EN_EVALUACION' });
    await enTransaccion((transaction) =>
      estados.actualizarCamposRuta({
        solicitud: s,
        usuario: coordinador,
        campos: { rutaSugerida: 'HONDURAS', rutaDecidida: 'HONDURAS' },
        notificacion: { tipo: 'RUTA_DECIDIDA' },
        transaction,
      }),
    );
    expect([s.estado, s.rutaDecidida, s.rutaSugerida]).toEqual([
      'EN_EVALUACION',
      'HONDURAS',
      'HONDURAS',
    ]);
    const [aviso] = await db.Notificacion.findAll({ where: { usuarioId: familia.usuario.id } });
    expect(aviso.tipo).toBe('RUTA_DECIDIDA');
    expect(aviso.cuerpo).toContain('atención en Honduras');
    expect(
      await db.Bitacora.count({ where: { solicitudId: s.id, accion: 'solicitud.registrar_ruta' } }),
    ).toBe(1);

    const enRevision = await f.crearSolicitud({ estado: 'EN_REVISION' });
    await expect(
      enTransaccion((transaction) =>
        estados.actualizarCamposRuta({
          solicitud: enRevision,
          usuario: coordinador,
          campos: { rutaDecidida: 'HONDURAS' },
          transaction,
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
