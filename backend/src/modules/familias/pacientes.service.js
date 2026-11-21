'use strict';

// Niños: alta (con vínculo a la cuenta y detección de duplicados), lista, detalle,
// edición con ventana para la familia, foto y resumen del inicio de la familia (07).

const { Op } = require('sequelize');
const { obtenerPacienteConAcceso } = require('../../core/acceso');
const { auditarCambio, registrarBitacora } = require('../../core/auditoria');
const { guardarArchivo, MIMES_IMAGEN } = require('../../core/archivos');
const { estadoExpediente } = require('../../core/expediente');
const { validacion } = require('../../core/errores');
const { respuestaPaginada } = require('../../core/http/paginar');
const { ROLES, ESTADOS_DOCUMENTO: D } = require('../../core/estados/constantes');
const errores = require('./familias.errores');
const { validarMunicipio } = require('./catalogos.service');
const {
  edadDe,
  hoyIso,
  nombreCompleto,
  estadoFamilia,
  ESTADOS_CERRADOS,
  ESTADOS_EDITABLES,
} = require('./familias.util');

const modelos = () => require('../../models');

const INCLUIR_LUGAR = [{ association: 'municipio', include: [{ association: 'departamento' }] }];

/** Subconsulta segura con los ids de los niños vinculados a una cuenta. */
function idsPacientesDe(usuarioId) {
  const { sequelize } = modelos();
  return sequelize.literal(
    `(SELECT pt.paciente_id FROM paciente_tutor pt JOIN tutores t ON t.id = pt.tutor_id WHERE t.usuario_id = ${sequelize.escape(usuarioId)})`,
  );
}

/** Perfil de tutor de la cuenta (el más antiguo, si hubiera varios). */
function tutorDeCuenta(usuarioId, { transaction } = {}) {
  return modelos().Tutor.findOne({
    where: { usuarioId },
    order: [['createdAt', 'ASC']],
    transaction,
  });
}

function validarFecha(fechaNacimiento) {
  if (fechaNacimiento > hoyIso()) {
    throw validacion(
      { fechaNacimiento: 'FECHA_FUTURA' },
      'La fecha de nacimiento no puede ser futura',
    );
  }
}

function lugarDe(paciente) {
  const m = paciente.municipio;
  return {
    municipio: { codigo: m.codigo, nombre: m.nombre },
    departamento: { codigo: m.departamento.codigo, nombre: m.departamento.nombre },
  };
}

function formatearTutor(tutor, vinculo, usuario) {
  return {
    id: tutor.id,
    nombres: tutor.nombres,
    apellidos: tutor.apellidos,
    parentesco: tutor.parentesco,
    telefono: tutor.telefono,
    correo: tutor.correo,
    direccion: tutor.direccion,
    esResponsableLegal: vinculo?.esResponsableLegal ?? false,
    confirmadoEn: vinculo?.confirmadoEn?.toISOString() ?? null,
    tieneCuenta: Boolean(tutor.usuarioId),
    esLaCuentaActual: Boolean(tutor.usuarioId) && tutor.usuarioId === usuario.id,
  };
}

async function formatearPaciente(paciente, usuario, { transaction } = {}) {
  const { PacienteTutor } = modelos();
  if (!paciente.municipio) await paciente.reload({ include: INCLUIR_LUGAR, transaction });
  const vinculos = await PacienteTutor.findAll({
    where: { pacienteId: paciente.id },
    include: [{ association: 'tutor' }],
    order: [['createdAt', 'ASC']],
    transaction,
  });
  return {
    id: paciente.id,
    nombres: paciente.nombres,
    apellidoPaterno: paciente.apellidoPaterno,
    apellidoMaterno: paciente.apellidoMaterno,
    nombreCompleto: nombreCompleto(paciente),
    fechaNacimiento: paciente.fechaNacimiento,
    edad: edadDe(paciente.fechaNacimiento),
    sexo: paciente.sexo,
    direccion: paciente.direccion,
    ...lugarDe(paciente),
    fotoArchivoId: paciente.fotoArchivoId,
    ...(usuario.rol === ROLES.COORDINADOR ? { posibleDuplicado: paciente.posibleDuplicado } : {}),
    tutores: vinculos.map((v) => formatearTutor(v.tutor, v, usuario)),
  };
}

/** Última solicitud de cada niño (por fecha de creación). */
async function ultimasSolicitudes(pacienteIds) {
  if (!pacienteIds.length) return new Map();
  const solicitudes = await modelos().Solicitud.findAll({
    where: { pacienteId: pacienteIds },
    order: [['createdAt', 'DESC']],
  });
  const ultimas = new Map();
  for (const s of solicitudes) if (!ultimas.has(s.pacienteId)) ultimas.set(s.pacienteId, s);
  return ultimas;
}

function formatearResumen(paciente, ultima) {
  return {
    id: paciente.id,
    nombreCompleto: nombreCompleto(paciente),
    edad: edadDe(paciente.fechaNacimiento),
    fotoArchivoId: paciente.fotoArchivoId,
    ...lugarDe(paciente),
    ultimaSolicitud: ultima
      ? {
          id: ultima.id,
          codigo: ultima.codigo,
          estado: ultima.estado,
          estadoFamilia: estadoFamilia(ultima.estado),
        }
      : null,
  };
}

/** Niños con el mismo nombre normalizado y la misma fecha, marcando si son de esta cuenta. */
async function buscarIguales(usuarioId, datos) {
  const { sequelize } = modelos();
  return sequelize.query(
    `SELECT p.id,
            EXISTS (SELECT 1 FROM paciente_tutor pt JOIN tutores t ON t.id = pt.tutor_id
                     WHERE pt.paciente_id = p.id AND t.usuario_id = :usuarioId) AS propio
       FROM pacientes p
      WHERE p.fecha_nacimiento = :fecha
        AND p.nombre_busqueda = lower(f_unaccent(:nombres || ' ' || :paterno || ' ' || coalesce(:materno, '')))`,
    {
      replacements: {
        usuarioId,
        fecha: datos.fechaNacimiento,
        nombres: datos.nombres,
        paterno: datos.apellidoPaterno,
        materno: datos.apellidoMaterno ?? null,
      },
      type: sequelize.QueryTypes.SELECT,
    },
  );
}

/**
 * POST /pacientes (solo familias). El niño queda vinculado a la cuenta desde el primer momento.
 * Un posible duplicado en otra cuenta no se revela: se marca para que el coordinador lo revise.
 */
async function crearPaciente(usuario, datos) {
  if (usuario.rol !== ROLES.FAMILIA) throw errores.soloFamilia();
  validarFecha(datos.fechaNacimiento);
  await validarMunicipio(datos.departamentoCodigo, datos.municipioCodigo);

  const iguales = await buscarIguales(usuario.id, datos);
  if (iguales.some((p) => p.propio) && !datos.confirmarDuplicado) throw errores.posibleDuplicado();

  const { sequelize, Paciente, Tutor, PacienteTutor, Usuario } = modelos();
  const paciente = await sequelize.transaction(async (transaction) => {
    const creado = await Paciente.create(
      {
        nombres: datos.nombres,
        apellidoPaterno: datos.apellidoPaterno,
        apellidoMaterno: datos.apellidoMaterno ?? null,
        fechaNacimiento: datos.fechaNacimiento,
        sexo: datos.sexo,
        municipioCodigo: datos.municipioCodigo,
        direccion: datos.direccion ?? null,
        posibleDuplicado: iguales.some((p) => !p.propio),
        creadoPor: usuario.id,
      },
      { transaction },
    );

    let tutor = await tutorDeCuenta(usuario.id, { transaction });
    if (!tutor) {
      const cuenta = await Usuario.findByPk(usuario.id, { transaction });
      tutor = await Tutor.create(
        {
          usuarioId: cuenta.id,
          nombres: cuenta.nombres,
          apellidos: cuenta.apellidos,
          telefono: cuenta.telefono,
          correo: cuenta.correo,
        },
        { transaction },
      );
    }
    await PacienteTutor.create(
      { pacienteId: creado.id, tutorId: tutor.id, esResponsableLegal: false },
      { transaction },
    );
    await registrarBitacora({
      accion: 'pacientes.crear',
      entidad: 'pacientes',
      entidadId: creado.id,
      despues: {
        nombres: creado.nombres,
        apellidoPaterno: creado.apellidoPaterno,
        fechaNacimiento: creado.fechaNacimiento,
        municipioCodigo: creado.municipioCodigo,
        posibleDuplicado: creado.posibleDuplicado,
      },
      transaction,
    });
    return creado;
  });
  return formatearPaciente(paciente, usuario);
}

/** GET /pacientes: la familia ve los suyos; el coordinador busca por nombre (sin acentos). */
async function listarPacientes(usuario, { q, page, limit }) {
  const { sequelize, Paciente } = modelos();
  const condiciones = [];
  if (usuario.rol === ROLES.FAMILIA)
    condiciones.push({ id: { [Op.in]: idsPacientesDe(usuario.id) } });
  if (q) {
    condiciones.push(
      sequelize.literal(
        `nombre_busqueda ILIKE '%' || lower(f_unaccent(${sequelize.escape(q)})) || '%'`,
      ),
    );
  }
  const { rows, count } = await Paciente.findAndCountAll({
    where: { [Op.and]: condiciones },
    include: INCLUIR_LUGAR,
    order: [
      [sequelize.col('nombre_busqueda'), 'ASC'],
      ['id', 'ASC'],
    ],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  const ultimas = await ultimasSolicitudes(rows.map((p) => p.id));
  return respuestaPaginada({
    datos: rows.map((p) => formatearResumen(p, ultimas.get(p.id))),
    total: count,
    page,
    limit,
  });
}

/** GET /pacientes/:id */
async function obtenerPaciente(usuario, id) {
  const paciente = await obtenerPacienteConAcceso(usuario, id, { include: INCLUIR_LUGAR });
  return formatearPaciente(paciente, usuario);
}

/**
 * PATCH /pacientes/:id. La familia edita solo mientras ninguna solicitud del niño pasó a
 * revisión; el coordinador siempre (y es el único que limpia `posibleDuplicado`).
 */
async function actualizarPaciente(usuario, id, cambios) {
  const { sequelize, Solicitud } = modelos();
  const paciente = await obtenerPacienteConAcceso(usuario, id);
  if (cambios.posibleDuplicado !== undefined && usuario.rol !== ROLES.COORDINADOR) {
    throw errores.campoSoloCoordinador('posibleDuplicado');
  }
  if (usuario.rol === ROLES.FAMILIA) {
    const enRevision = await Solicitud.count({
      where: { pacienteId: paciente.id, estado: { [Op.notIn]: ESTADOS_EDITABLES } },
    });
    if (enRevision) throw errores.edicionBloqueada();
  }
  if (cambios.fechaNacimiento) validarFecha(cambios.fechaNacimiento);
  if (cambios.municipioCodigo)
    await validarMunicipio(cambios.departamentoCodigo, cambios.municipioCodigo);

  const resto = { ...cambios };
  delete resto.departamentoCodigo; // se deduce del municipio
  await sequelize.transaction((transaction) =>
    auditarCambio(paciente, resto, { transaction, accion: 'pacientes.actualizar' }),
  );
  return formatearPaciente(paciente, usuario);
}

/** PUT /pacientes/:id/foto (imagen JPEG, PNG o WebP). */
async function actualizarFoto(usuario, id, archivoSubido) {
  const { sequelize } = modelos();
  const paciente = await obtenerPacienteConAcceso(usuario, id);
  if (!archivoSubido) throw validacion({ foto: 'REQUERIDO' }, 'Falta la imagen');
  await sequelize.transaction(async (transaction) => {
    const archivo = await guardarArchivo({
      buffer: archivoSubido.buffer,
      prefijo: 'pacientes',
      tipos: MIMES_IMAGEN,
      transaction,
    });
    await auditarCambio(
      paciente,
      { fotoArchivoId: archivo.id },
      { transaction, accion: 'pacientes.foto' },
    );
  });
  return formatearPaciente(paciente, usuario);
}

/** GET /me/resumen: contadores e hijos con el estado de su última solicitud. */
async function resumenFamilia(usuario) {
  if (usuario.rol !== ROLES.FAMILIA) throw errores.soloFamilia();
  const { Paciente, Notificacion } = modelos();
  const pacientes = await Paciente.findAll({
    where: { id: { [Op.in]: idsPacientesDe(usuario.id) } },
    include: INCLUIR_LUGAR,
    order: [['createdAt', 'ASC']],
  });
  const ids = pacientes.map((p) => p.id);
  const todas = ids.length
    ? await modelos().Solicitud.findAll({
        where: { pacienteId: ids },
        order: [['createdAt', 'DESC']],
      })
    : [];
  const ultimas = new Map();
  for (const s of todas) if (!ultimas.has(s.pacienteId)) ultimas.set(s.pacienteId, s);
  const abiertas = todas.filter((s) => !ESTADOS_CERRADOS.includes(s.estado));

  let documentosPendientes = 0;
  for (const s of abiertas) {
    const { documentos } = await estadoExpediente(s.id);
    documentosPendientes += documentos.filter(
      (d) => d.obligatorio && !d.cubiertoPorFormulario && [D.FALTA, D.RECHAZADO].includes(d.estado),
    ).length;
  }

  return {
    contadores: {
      ninos: pacientes.length,
      solicitudesAbiertas: abiertas.length,
      documentosPendientes,
      notificacionesNoLeidas: await Notificacion.count({
        where: { usuarioId: usuario.id, leidaEn: null },
      }),
    },
    ninos: pacientes.map((p) => formatearResumen(p, ultimas.get(p.id))),
  };
}

module.exports = {
  INCLUIR_LUGAR,
  idsPacientesDe,
  tutorDeCuenta,
  formatearTutor,
  crearPaciente,
  listarPacientes,
  obtenerPaciente,
  actualizarPaciente,
  actualizarFoto,
  resumenFamilia,
};
