'use strict';

// Padres, madres y tutores de cada niño, y la confirmación del responsable legal (10).

const { obtenerPacienteConAcceso, esUuid } = require('../../core/acceso');
const { auditarCambio, registrarBitacora } = require('../../core/auditoria');
const { ROLES } = require('../../core/estados/constantes');
const errores = require('./familias.errores');
const { validarParentesco } = require('./catalogos.service');
const { tutorDeCuenta, formatearTutor } = require('./pacientes.service');

const modelos = () => require('../../models');

const CAMPOS_TUTOR = ['nombres', 'apellidos', 'parentesco', 'telefono', 'correo', 'direccion'];
const soloCampos = (datos) =>
  Object.fromEntries(CAMPOS_TUTOR.filter((c) => datos[c] !== undefined).map((c) => [c, datos[c]]));

/**
 * POST /pacientes/:id/tutores. Con `esLaCuentaActual` completa el perfil de tutor de la cuenta
 * en lugar de crear otro. Ser responsable legal exige la confirmación, que se guarda con fecha y
 * usuario porque respalda los consentimientos.
 */
async function agregarTutor(usuario, pacienteId, datos) {
  const { sequelize, Tutor, PacienteTutor } = modelos();
  const paciente = await obtenerPacienteConAcceso(usuario, pacienteId);
  if (datos.esLaCuentaActual && usuario.rol !== ROLES.FAMILIA)
    throw errores.cuentaActualSoloFamilia();
  await validarParentesco(datos.parentesco);

  return sequelize.transaction(async (transaction) => {
    let tutor;
    if (datos.esLaCuentaActual) {
      tutor = await tutorDeCuenta(usuario.id, { transaction });
      if (tutor)
        await auditarCambio(tutor, soloCampos(datos), {
          transaction,
          accion: 'tutores.actualizar',
        });
      else
        tutor = await Tutor.create(
          { ...soloCampos(datos), usuarioId: usuario.id },
          { transaction },
        );
    } else {
      tutor = await Tutor.create({ ...soloCampos(datos), usuarioId: null }, { transaction });
    }

    const ahora = new Date();
    const datosVinculo = {
      esResponsableLegal: datos.esResponsableLegal,
      confirmadoEn: datos.esResponsableLegal ? ahora : null,
      confirmadoPor: datos.esResponsableLegal ? usuario.id : null,
    };
    let vinculo = await PacienteTutor.findOne({
      where: { pacienteId: paciente.id, tutorId: tutor.id },
      transaction,
    });
    if (vinculo) await vinculo.update(datosVinculo, { transaction });
    else {
      vinculo = await PacienteTutor.create(
        { pacienteId: paciente.id, tutorId: tutor.id, ...datosVinculo },
        { transaction },
      );
    }

    await registrarBitacora({
      accion: 'pacientes.vincular_tutor',
      entidad: 'paciente_tutor',
      entidadId: tutor.id,
      despues: {
        pacienteId: paciente.id,
        tutorId: tutor.id,
        esResponsableLegal: vinculo.esResponsableLegal,
        confirmadoEn: vinculo.confirmadoEn,
      },
      transaction,
    });
    return formatearTutor(tutor, vinculo, usuario);
  });
}

/** Un tutor visible para el usuario: el coordinador ve todos; la familia, los de sus niños. */
async function obtenerTutorConAcceso(usuario, tutorId, { transaction } = {}) {
  const { sequelize, Tutor } = modelos();
  if (!esUuid(tutorId)) throw errores.tutorNoEncontrado();
  const tutor = await Tutor.findByPk(tutorId, { transaction });
  if (!tutor) throw errores.tutorNoEncontrado();
  if (usuario.rol === ROLES.COORDINADOR) return tutor;
  if (usuario.rol !== ROLES.FAMILIA) throw errores.tutorNoEncontrado();
  const [{ visible }] = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1 FROM paciente_tutor pt
        WHERE pt.tutor_id = :tutorId
          AND pt.paciente_id IN (SELECT pt2.paciente_id FROM paciente_tutor pt2
                                   JOIN tutores t2 ON t2.id = pt2.tutor_id
                                  WHERE t2.usuario_id = :usuarioId)
     ) AS visible`,
    {
      replacements: { tutorId, usuarioId: usuario.id },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  if (!visible) throw errores.tutorNoEncontrado();
  return tutor;
}

/** PATCH /tutores/:id. La familia no puede cambiar el perfil de otra cuenta. */
async function actualizarTutor(usuario, tutorId, cambios) {
  const { sequelize } = modelos();
  const tutor = await obtenerTutorConAcceso(usuario, tutorId);
  if (usuario.rol === ROLES.FAMILIA && tutor.usuarioId && tutor.usuarioId !== usuario.id) {
    throw errores.tutorDeOtraCuenta();
  }
  if (cambios.parentesco) await validarParentesco(cambios.parentesco);
  await sequelize.transaction((transaction) =>
    auditarCambio(tutor, cambios, { transaction, accion: 'tutores.actualizar' }),
  );
  const datos = formatearTutor(tutor, null, usuario);
  delete datos.esResponsableLegal; // depende de cada niño, no del tutor
  delete datos.confirmadoEn;
  return datos;
}

/**
 * DELETE /pacientes/:id/tutores/:tutorId: quita el vínculo, no borra al tutor.
 * Nunca deja al niño sin responsable legal, y la familia no puede quitar su propio vínculo
 * ni el de otra cuenta.
 */
async function quitarVinculo(usuario, pacienteId, tutorId) {
  const { sequelize, PacienteTutor } = modelos();
  const paciente = await obtenerPacienteConAcceso(usuario, pacienteId);
  if (!esUuid(tutorId)) throw errores.tutorNoEncontrado();
  await sequelize.transaction(async (transaction) => {
    const vinculo = await PacienteTutor.findOne({
      where: { pacienteId: paciente.id, tutorId },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!vinculo) throw errores.tutorNoEncontrado();
    const tutor = await vinculo.getTutor({ transaction });
    if (usuario.rol === ROLES.FAMILIA) {
      if (tutor.usuarioId === usuario.id) throw errores.vinculoPropio();
      if (tutor.usuarioId) throw errores.tutorDeOtraCuenta();
    }
    if (vinculo.esResponsableLegal) {
      const otros = await PacienteTutor.count({
        where: { pacienteId: paciente.id, esResponsableLegal: true },
        transaction,
      });
      if (otros <= 1) throw errores.ultimoResponsable();
    }
    await vinculo.destroy({ transaction });
    await registrarBitacora({
      accion: 'pacientes.desvincular_tutor',
      entidad: 'paciente_tutor',
      entidadId: tutorId,
      antes: { pacienteId: paciente.id, tutorId, esResponsableLegal: vinculo.esResponsableLegal },
      transaction,
    });
  });
}

module.exports = { agregarTutor, actualizarTutor, quitarVinculo };
