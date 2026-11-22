'use strict';

// Ayudantes de las pruebas del módulo solicitudes. Todos los datos son ficticios.

const crypto = require('node:crypto');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const { cambiarEstado } = require('../../../core/estados');

/** Datos completos (válidos) de cada sección, con valores visiblemente de prueba. */
const COMPLETAS = Object.freeze({
  informacion_medica: {
    diagnostico: 'Diagnóstico ficticio de prueba',
    fechaInicio: '2020-03',
    atencionSolicitada: 'pie_zambo',
    cirugias: [{ procedimiento: 'Procedimiento ficticio', fecha: '2021' }],
  },
  embarazo_nacimiento: {
    cuidadosPrenatales: 'si',
    pesoNacerKg: 3.1,
    momentoParto: 'en_fecha',
    tipoParto: 'vaginal',
    nacioDeNalgas: 'no',
    medicamentosEmbarazo: 'no',
    ucin: 'si',
    ucinDetalle: 'Dos días en observación (ficticio)',
  },
  antecedentes_medicos: {
    condiciones: ['asma'],
    antecedentesFamiliares: 'no_se',
    cirugiasHospitalizaciones: 'no',
    transfusiones: 'no',
    problemasAnestesia: 'no',
  },
  medicamentos_alergias: {
    usaMedicamentos: 'si',
    medicamentos: [{ tipo: 'medicamento', nombre: 'Medicamento ficticio', dosis: '5 ml' }],
    alergias: 'no',
  },
  crecimiento_movilidad: {
    sentarse: 'logrado',
    sentarseEdadMeses: 7,
    caminarConAyuda: 'logrado',
    caminarConAyudaEdadMeses: 14,
    caminarSolo: 'aun_no',
    ayudasTecnicas: ['andadera'],
  },
  educacion: { gradoEscolar: 'no_aplica' },
});

const conToken = (req, token) => req.set('Authorization', `Bearer ${token}`);

/**
 * Familia con un niño y una solicitud creada por la API (con historial), opcionalmente con la
 * modalidad elegida (CAPTURA).
 * @param {{ modalidad?: 'app' | 'fotos' | null }} [opciones]
 */
async function familiaConSolicitud({ modalidad = 'app' } = {}) {
  const familia = await f.crearFamilia();
  const token = await tokenPara(familia.usuario);
  const creada = await conToken(api().post('/api/v1/solicitudes'), token)
    .send({ pacienteId: familia.paciente.id })
    .expect(201);
  if (modalidad) {
    await conToken(api().put(`/api/v1/solicitudes/${creada.body.id}/modalidad`), token)
      .send({ modalidad })
      .expect(200);
  }
  const solicitud = await db.Solicitud.findByPk(creada.body.id);
  return { ...familia, token, solicitud };
}

/** Cambia el estado con core/estados, como lo harán los módulos 06, 09, 10 y 11. */
async function avanzar(solicitud, a, usuario, campos) {
  return db.sequelize.transaction(async (transaction) => {
    const fila = await db.Solicitud.findByPk(solicitud.id, { transaction });
    await cambiarEstado({
      solicitud: fila,
      a,
      usuario: { id: usuario.id, rol: usuario.rolCodigo ?? (await usuario.getRol()).codigo },
      campos,
      transaction,
    });
    return fila;
  });
}

/** Envía la solicitud por la API con una clave de idempotencia nueva. */
const enviar = (solicitud, token, clave = crypto.randomUUID()) =>
  conToken(api().post(`/api/v1/solicitudes/${solicitud.id}/enviar`), token).set(
    'Idempotency-Key',
    clave,
  );

module.exports = { COMPLETAS, conToken, familiaConSolicitud, avanzar, enviar };
