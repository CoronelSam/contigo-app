'use strict';

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { limpiarBase } = require('../../../../test/helpers/db');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { registrarBitacora } = require('../../../core/auditoria');

let coordinador;
let tc;

beforeEach(async () => {
  await limpiarBase();
  coordinador = await f.crearUsuario({
    rol: 'coordinador',
    nombres: 'Coordinación',
    apellidos: 'Prueba',
  });
  tc = await tokenPara(coordinador);
});

const get = (ruta, t = tc) => api().get(`/api/v1${ruta}`).set('Authorization', `Bearer ${t}`);
const DIA_MS = 24 * 60 * 60 * 1000;

/** Solicitud con un último cambio de estado hace `dias` días. */
async function caso(estado, { dias = 1, paciente, ...datos } = {}) {
  const s = await f.crearSolicitud({ estado, paciente, ...datos });
  await s.update({ ultimoCambioEstado: new Date(Date.now() - dias * DIA_MS) });
  return s;
}

describe('GET /coordinador/resumen y /actividad', () => {
  test('contadores por estado y actividad reciente con descripción, código y autor', async () => {
    for (const estado of ['EN_REVISION', 'EN_REVISION', 'COMPLETA', 'ENVIADA', 'INFO_ADICIONAL']) {
      await caso(estado);
    }
    await caso('EN_EVALUACION');
    await caso('DERIVADA_HN', { rutaDecidida: 'HONDURAS' });
    await caso('CAPTURA');
    const s = await caso('EN_REVISION');
    await registrarBitacora({
      accion: 'solicitud.enviar',
      entidad: 'solicitudes',
      entidadId: s.id,
      solicitudId: s.id,
    });
    await registrarBitacora({
      accion: 'documentos.agregar_pagina',
      entidad: 'documentos',
      solicitudId: s.id,
    });
    await registrarBitacora({ accion: 'usuarios.actualizar', entidad: 'usuarios' });

    const res = await get('/coordinador/resumen').expect(200);
    expect(res.body.contadores).toEqual({
      EN_REVISION: 3,
      COMPLETA: 1,
      ENVIADA: 1,
      INFO_ADICIONAL: 1,
      EN_EVALUACION: 1,
      DERIVADA_HN: 1,
    });
    expect(res.body.actividad).toEqual([
      expect.objectContaining({
        accion: 'solicitud.enviar',
        descripcion: 'Solicitud enviada a revisión',
        codigoCaso: s.codigo,
        solicitudId: s.id,
      }),
    ]);

    const ingles = await tokenPara(await f.crearUsuario({ rol: 'coordinador', idioma: 'en' }));
    const actividad = await get('/actividad?limit=5', ingles).expect(200);
    expect(actividad.body.paginacion).toEqual({ page: 1, limit: 5, total: 1 });
    expect(actividad.body.datos[0].descripcion).toBe('Request sent for review');
  });
});

describe('GET /solicitudes (tablero)', () => {
  test('por defecto, casos en curso con más tiempo esperando primero', async () => {
    const reciente = await caso('EN_REVISION', { dias: 1 });
    const viejo = await caso('INFO_ADICIONAL', { dias: 12 });
    const medio = await caso('CAPTURA', { dias: 5 });
    await caso('BORRADOR', { dias: 30 });
    await caso('ACEPTADA', { dias: 40 });
    await caso('ATENDIDA_HN', { dias: 40, rutaDecidida: 'HONDURAS' });

    const res = await get('/solicitudes').expect(200);
    expect(res.body.datos.map((s) => s.id)).toEqual([viejo.id, medio.id, reciente.id]);
    expect(res.body.datos.map((s) => s.diasEnEstado)).toEqual([12, 5, 1]);
    expect(res.body.paginacion).toEqual({ page: 1, limit: 20, total: 3 });

    const cerrados = await get('/solicitudes?estado=ACEPTADA,ATENDIDA_HN').expect(200);
    expect(cerrados.body.paginacion.total).toBe(2);
  });

  test('cada fila trae paciente, ruta, faltantes, voluntarios, coordinador y posible duplicado', async () => {
    const familia = await f.crearFamilia({
      paciente: { nombres: 'José Ángel', apellidoPaterno: 'Núñez', municipioCodigo: '0801' },
    });
    await familia.paciente.update({ posibleDuplicado: true });
    const s = await caso('EN_REVISION', {
      paciente: familia.paciente,
      coordinadorId: coordinador.id,
      faltantesAlEnviar: [{ tipo: 'documento', codigo: 'fotos_condicion', motivo: 'falta' }],
      rutaSugerida: 'POR_EVALUAR',
    });
    const voluntario = await f.crearUsuario({
      rol: 'voluntario',
      nombres: 'Voluntaria',
      apellidos: 'Uno',
    });
    await f.crearAsignacion({ solicitud: s, voluntario });
    await f.crearAsignacion({ solicitud: s, activa: false });

    const [fila] = (await get('/solicitudes').expect(200)).body.datos;
    expect(fila).toMatchObject({
      id: s.id,
      codigo: s.codigo,
      paciente: {
        nombreCompleto: expect.stringContaining('José Ángel Núñez'),
        edad: { anios: expect.any(Number), meses: expect.any(Number) },
        departamento: { codigo: '08', nombre: 'Francisco Morazán' },
      },
      estado: 'EN_REVISION',
      etapa: 'evaluacion',
      rutaSugerida: 'POR_EVALUAR',
      rutaDecidida: null,
      faltantesAlEnviar: [{ tipo: 'documento', codigo: 'fotos_condicion', motivo: 'falta' }],
      voluntarios: [{ id: voluntario.id, nombre: 'Voluntaria Uno' }],
      coordinador: { id: coordinador.id, nombre: 'Coordinación Prueba' },
      posibleDuplicado: true,
    });
  });

  test('filtros combinados: estado, destino, etapa, casos propios y búsqueda', async () => {
    const familia = await f.crearFamilia({
      paciente: { nombres: 'María', apellidoPaterno: 'López' },
    });
    const maria = await caso('EN_REVISION', {
      paciente: familia.paciente,
      coordinadorId: coordinador.id,
    });
    const hn = await caso('EN_EVALUACION', { rutaDecidida: 'HONDURAS' });
    const mx = await caso('PAQUETE_EXTERIOR', { rutaDecidida: 'MEXICO' });
    const intl = await caso('EN_REVISION', { rutaDecidida: 'INTERNACIONAL', etapa: 'paquete' });

    const ids = async (query) =>
      (await get(`/solicitudes?${query}`).expect(200)).body.datos.map((s) => s.id).sort();
    expect(await ids('destino=HONDURAS')).toEqual([hn.id]);
    expect(await ids('destino=sin_decidir')).toEqual([maria.id]);
    expect(await ids('destino=MEXICO&etapa=paquete')).toEqual([mx.id]);
    expect(await ids('estado=EN_REVISION&etapa=paquete')).toEqual([intl.id]);
    expect(await ids('estado=EN_REVISION,PAQUETE_EXTERIOR')).toEqual(
      [maria.id, mx.id, intl.id].sort(),
    );
    expect(await ids('mios=true')).toEqual([maria.id]);
    expect(await ids('q=maria%20lopez')).toEqual([maria.id]);
    expect(await ids(`q=${hn.codigo.toLowerCase()}`)).toEqual([hn.id]);
    expect(await ids(`q=${mx.codigo.slice(3)}`)).toEqual([mx.id]);
    expect(await ids('q=maria&destino=HONDURAS')).toEqual([]);

    const malo = await get('/solicitudes?estado=EN_REVISION,TERMINADA').expect(400);
    expect(Object.values(malo.body.campos)).toContain('VALOR_NO_PERMITIDO');
  });

  test('paginación', async () => {
    for (let i = 0; i < 5; i += 1) await caso('EN_REVISION', { dias: i + 1 });
    const res = await get('/solicitudes?limit=2&page=2').expect(200);
    expect(res.body.paginacion).toEqual({ page: 2, limit: 2, total: 5 });
    expect(res.body.datos.map((s) => s.diasEnEstado)).toEqual([3, 2]);
  });
});

describe('permisos del módulo', () => {
  test('familia, voluntario y administrador → 403 en los 7 endpoints', async () => {
    const s = await caso('EN_REVISION');
    const rutas = [
      ['get', '/coordinador/resumen'],
      ['get', '/actividad'],
      ['get', '/solicitudes'],
      ['get', `/solicitudes/${s.id}/historia-clinica`],
      ['get', `/solicitudes/${s.id}/bitacora`],
      ['get', `/solicitudes/${s.id}/validacion`],
      ['post', `/solicitudes/${s.id}/confirmar-completo`],
    ];
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud: s, voluntario });
    for (const rol of ['familia', 'voluntario', 'administrador']) {
      const usuario = rol === 'voluntario' ? voluntario : await f.crearUsuario({ rol });
      const t = await tokenPara(usuario);
      for (const [metodo, ruta] of rutas) {
        const res = await api()
          [metodo](`/api/v1${ruta}`)
          .set('Authorization', `Bearer ${t}`)
          .send({});
        expect([rol, ruta, res.status]).toEqual([rol, ruta, 403]);
      }
    }
    await api().get('/api/v1/solicitudes').expect(401);
    await get(`/solicitudes/${crypto.randomUUID()}/validacion`).expect(404);
    expect(await db.RegistroAcceso.count()).toBe(0);
  });
});
