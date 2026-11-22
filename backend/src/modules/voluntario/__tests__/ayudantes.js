'use strict';

// Ayudantes de las pruebas del módulo voluntario. Todos los datos son ficticios.

const f = require('../../../../test/factories');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');

const con = (req, token) => req.set('Authorization', `Bearer ${token}`);

/** Caso de una familia (en CAPTURA por defecto) con un voluntario asignado. */
async function casoAsignado({ estado = 'CAPTURA', voluntario, paciente } = {}) {
  const familia = paciente ? null : await f.crearFamilia();
  const solicitud = await f.crearSolicitud({
    paciente: paciente ?? familia.paciente,
    estado,
    modalidad: 'fotos',
  });
  const v = voluntario ?? (await f.crearUsuario({ rol: 'voluntario' }));
  const asignacion = await f.crearAsignacion({ solicitud, voluntario: v });
  return { familia, solicitud, voluntario: v, asignacion };
}

const resumen = async (voluntario) =>
  (await con(api().get('/api/v1/voluntario/resumen'), await tokenPara(voluntario)).expect(200))
    .body;

const casos = async (voluntario, query = '') =>
  (
    await con(api().get(`/api/v1/voluntario/casos${query}`), await tokenPara(voluntario)).expect(
      200,
    )
  ).body;

module.exports = { con, casoAsignado, resumen, casos };
