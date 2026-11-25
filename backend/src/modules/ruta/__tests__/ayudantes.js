'use strict';

// Ayudantes de las pruebas del módulo ruta. Todos los datos son ficticios.

const f = require('../../../../test/factories');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

const DIA_MS = 24 * 60 * 60 * 1000;
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' });
const enDias = (n) =>
  new Date(Date.now() + n * DIA_MS).toLocaleDateString('en-CA', {
    timeZone: 'America/Tegucigalpa',
  });

const EVALUACION = Object.freeze({
  justificacion: 'Justificación ficticia de prueba, escrita solo para las pruebas automáticas.',
  evaluadorNombre: 'Médica Evaluadora Ficticia',
  evaluadorCargo: 'Ortopedia pediátrica (prueba)',
  tipoDictamen: 'medico_evaluador',
});

const con = (req, token) => req.set('Authorization', `Bearer ${token}`);

/** Familia con un niño y un caso en el estado pedido (por defecto, EN_EVALUACION). */
async function caso({ estado = 'EN_EVALUACION', paciente = {}, ...datos } = {}) {
  const familia = await f.crearFamilia({ paciente });
  const solicitud = await f.crearSolicitud({ paciente: familia.paciente, estado, ...datos });
  return { familia, solicitud, tokenFamilia: await tokenPara(familia.usuario) };
}

async function coordinador() {
  const usuario = await f.crearUsuario({ rol: 'coordinador' });
  return { usuario, token: await tokenPara(usuario) };
}

const evaluar = (solicitud, token, cuerpo) =>
  con(api().post(`/api/v1/solicitudes/${solicitud.id}/evaluaciones`), token).send({
    ...EVALUACION,
    fechaDictamen: hoy(),
    ...cuerpo,
  });

const derivar = (solicitud, token, cuerpo) =>
  con(api().post(`/api/v1/solicitudes/${solicitud.id}/derivaciones-locales`), token).send({
    especialidad: 'ortopedia_pediatrica',
    fechaCita: enDias(7),
    ...cuerpo,
  });

module.exports = { EVALUACION, hoy, enDias, con, caso, coordinador, evaluar, derivar };
