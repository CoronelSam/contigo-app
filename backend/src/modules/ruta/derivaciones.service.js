'use strict';

// Atención en Honduras (pantallas nuevas): proveedores locales, derivación con cita, reprogramación
// y seguimiento hasta que el niño es atendido.

const { Op } = require('sequelize');
const { obtenerSolicitudConAcceso, usuariosFamiliaDe, esUuid } = require('../../core/acceso');
const { registrarBitacora, auditarCambio } = require('../../core/auditoria');
const { cambiarEstado } = require('../../core/estados');
const { estadoExpediente } = require('../../core/expediente');
const { notificar } = require('../../core/notificaciones');
const { ESTADOS_SOLICITUD: E, RUTAS } = require('../../core/estados/constantes');
const errores = require('./ruta.errores');
const { reabrirEn } = require('./evaluaciones.service');
const { hoyIso, iso, horaCorta } = require('./ruta.util');

const modelos = () => require('../../models');

function formatearProveedor(p) {
  return {
    id: p.id,
    nombre: p.nombre,
    tipo: p.tipo,
    departamento: p.departamento
      ? { codigo: p.departamento.codigo, nombre: p.departamento.nombre }
      : { codigo: p.departamentoCodigo, nombre: p.departamentoCodigo },
    municipio: p.municipio ? { codigo: p.municipio.codigo, nombre: p.municipio.nombre } : null,
    especialidades: p.especialidades ?? [],
    contacto: p.contacto ?? {},
    activo: p.activo,
    notas: p.notas ?? null,
  };
}

const INCLUIR_LUGAR = [
  { association: 'departamento', attributes: ['codigo', 'nombre'] },
  { association: 'municipio', attributes: ['codigo', 'nombre'] },
];

/**
 * Proveedores con filtros. `soloActivos` para el coordinador; el administrador ve todos.
 * @param {{ especialidad?: string, departamento?: string, municipio?: string, activo?: boolean }} filtros
 */
async function buscarProveedores({ especialidad, departamento, municipio, activo }) {
  const { ProveedorLocal } = modelos();
  const proveedores = await ProveedorLocal.findAll({
    where: {
      ...(activo === undefined ? {} : { activo }),
      ...(especialidad ? { especialidades: { [Op.contains]: [especialidad] } } : {}),
      ...(departamento ? { departamentoCodigo: departamento } : {}),
      ...(municipio ? { municipioCodigo: municipio } : {}),
    },
    include: INCLUIR_LUGAR,
    order: [
      ['nombre', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return proveedores.map(formatearProveedor);
}

/** GET /proveedores-locales (coordinador): solo los activos. */
const proveedoresDisponibles = (filtros) => buscarProveedores({ ...filtros, activo: true });

function formatearDerivacion(d, proveedor) {
  return {
    id: d.id,
    solicitudId: d.solicitudId,
    proveedor: { id: proveedor.id, nombre: proveedor.nombre },
    especialidad: d.especialidad,
    fechaCita: d.fechaCita,
    horaCita: horaCorta(d.horaCita),
    estado: d.estado,
    observaciones: d.observaciones ?? null,
    reemplazaA: d.reemplazaA ?? null,
    creadaEn: iso(d.createdAt),
  };
}

/** Variables de las notificaciones de cita (proveedor y dirección, sin datos clínicos). */
function variablesCita(derivacion, proveedor) {
  return {
    fecha: derivacion.fechaCita,
    hora: horaCorta(derivacion.horaCita),
    proveedor: [proveedor.nombre, proveedor.contacto?.direccion].filter(Boolean).join(', '),
  };
}

async function avisarCambioDeCita({ solicitud, derivacion, proveedor, transaction }) {
  const { Paciente } = modelos();
  const paciente = await Paciente.findByPk(solicitud.pacienteId, {
    attributes: ['nombres'],
    transaction,
  });
  await notificar({
    usuarioIds: await usuariosFamiliaDe(solicitud.id, { transaction }),
    tipo: 'CITA_ACTUALIZADA',
    variables: {
      nombre: paciente?.nombres?.split(' ')[0] ?? null,
      codigo: solicitud.codigo,
      ...variablesCita(derivacion, proveedor),
    },
    solicitudId: solicitud.id,
    transaction,
  });
}

/** Proveedor activo que atiende la especialidad; si no, 409. */
async function proveedorValido(proveedorId, especialidad, transaction) {
  const { ProveedorLocal } = modelos();
  const proveedor = await ProveedorLocal.findByPk(proveedorId, { transaction });
  if (!proveedor?.activo || !(proveedor.especialidades ?? []).includes(especialidad)) {
    throw errores.proveedorInvalido();
  }
  return proveedor;
}

/**
 * POST /solicitudes/:id/derivaciones-locales.
 *
 * - En EN_EVALUACION con ruta Honduras: crea la cita y el caso pasa a DERIVADA_HN (aviso
 *   CITA_PROGRAMADA).
 * - En DERIVADA_HN: reprograma. La cita anterior queda cancelada (`reemplaza_a`) y se avisa
 *   CITA_ACTUALIZADA, sin cambiar el estado del caso.
 *
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {{ proveedorId: string, especialidad: string, fechaCita: string, horaCita?: string | null,
 *   observaciones?: string | null }} cuerpo
 */
async function derivar(usuario, solicitudId, cuerpo) {
  const { sequelize, DerivacionLocal, CatalogoItem } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const reprogramar = solicitud.estado === E.DERIVADA_HN;
    if (!reprogramar) {
      if (solicitud.estado !== E.EN_EVALUACION) {
        throw errores.derivacionNoPermitida(solicitud.estado);
      }
      if (solicitud.rutaDecidida !== RUTAS.HONDURAS) throw errores.sinRutaHonduras();
    }
    const especialidad = await CatalogoItem.findOne({
      where: { tipo: 'especialidad_medica', codigo: cuerpo.especialidad, activo: true },
      transaction,
    });
    if (!especialidad) throw errores.catalogoInvalido('especialidad');
    const proveedor = await proveedorValido(cuerpo.proveedorId, cuerpo.especialidad, transaction);
    if (cuerpo.fechaCita < hoyIso()) throw errores.fechaPasada();

    if (!reprogramar) {
      const { documentos } = await estadoExpediente(solicitud.id, { transaction });
      const pendientes = documentos
        .filter((d) => d.ruta === 'HONDURAS' && d.obligatorio && !d.cumplido)
        .map((d) => d.codigo);
      if (pendientes.length) throw errores.requisitosPendientes(pendientes);
    }

    const anterior = reprogramar
      ? await DerivacionLocal.findOne({
          where: { solicitudId: solicitud.id, estado: { [Op.ne]: 'atendida' } },
          order: [
            ['createdAt', 'DESC'],
            ['id', 'ASC'],
          ],
          lock: transaction.LOCK.UPDATE,
          transaction,
        })
      : null;
    if (anterior?.estado === 'programada') {
      await anterior.update({ estado: 'cancelada' }, { transaction });
    }

    const derivacion = await DerivacionLocal.create(
      {
        solicitudId: solicitud.id,
        proveedorId: proveedor.id,
        especialidad: cuerpo.especialidad,
        fechaCita: cuerpo.fechaCita,
        horaCita: cuerpo.horaCita ?? null,
        estado: 'programada',
        observaciones: cuerpo.observaciones ?? null,
        reemplazaA: anterior?.id ?? null,
        registradoPor: usuario.id,
      },
      { transaction },
    );
    await registrarBitacora({
      accion: reprogramar ? 'derivaciones.reprogramar' : 'derivaciones.crear',
      entidad: 'derivaciones_locales',
      entidadId: derivacion.id,
      solicitudId: solicitud.id,
      antes: anterior ? { derivacionId: anterior.id, fechaCita: anterior.fechaCita } : null,
      despues: {
        proveedorId: proveedor.id,
        especialidad: cuerpo.especialidad,
        fechaCita: cuerpo.fechaCita,
        horaCita: horaCorta(cuerpo.horaCita),
      },
      transaction,
    });

    if (reprogramar) {
      await avisarCambioDeCita({ solicitud, derivacion, proveedor, transaction });
    } else {
      await cambiarEstado({
        solicitud,
        a: E.DERIVADA_HN,
        usuario,
        notificacion: { tipo: 'CITA_PROGRAMADA', variables: variablesCita(derivacion, proveedor) },
        transaction,
      });
    }
    return {
      derivacion: formatearDerivacion(derivacion, proveedor),
      solicitud: { id: solicitud.id, estado: solicitud.estado },
    };
  });
}

/**
 * PATCH /derivaciones-locales/:id: cambia la fecha u hora (aviso CITA_ACTUALIZADA) o registra el
 * resultado: `atendida` → ATENDIDA_HN; `no_asistio` o `cancelada` dejan el caso en DERIVADA_HN
 * para reprogramar, salvo que se pida volver a evaluación.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} derivacionId
 * @param {object} cambios
 */
async function cambiarDerivacion(usuario, derivacionId, cambios) {
  if (!esUuid(derivacionId)) throw errores.derivacionNoEncontrada();
  const { sequelize, DerivacionLocal, ProveedorLocal } = modelos();
  return sequelize.transaction(async (transaction) => {
    const derivacion = await DerivacionLocal.findByPk(derivacionId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!derivacion) throw errores.derivacionNoEncontrada();
    const solicitud = await obtenerSolicitudConAcceso(usuario, derivacion.solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const reemplazada = await DerivacionLocal.count({
      where: { reemplazaA: derivacion.id },
      transaction,
    });
    if (reemplazada || solicitud.estado !== E.DERIVADA_HN) throw errores.derivacionNoVigente();
    if (derivacion.estado !== 'programada') throw errores.citaNoProgramada(derivacion.estado);
    const proveedor = await ProveedorLocal.findByPk(derivacion.proveedorId, { transaction });

    const { estado, volverAEvaluacion, fechaCita, horaCita, observaciones } = cambios;
    if (fechaCita && fechaCita < hoyIso()) throw errores.fechaPasada();

    const datos = {
      ...(fechaCita !== undefined ? { fechaCita } : {}),
      ...(horaCita !== undefined ? { horaCita } : {}),
      ...(observaciones !== undefined ? { observaciones } : {}),
      ...(estado ? { estado } : {}),
    };
    await auditarCambio(derivacion, datos, {
      transaction,
      accion: estado ? `derivaciones.${estado}` : 'derivaciones.actualizar',
      solicitudId: solicitud.id,
    });

    if (estado === 'atendida') {
      await cambiarEstado({ solicitud, a: E.ATENDIDA_HN, usuario, transaction });
    } else if (estado && volverAEvaluacion) {
      await reabrirEn({
        solicitud,
        usuario,
        motivo: estado === 'no_asistio' ? 'No asistió a la cita' : 'Cita cancelada',
        transaction,
      });
    } else if (!estado && (fechaCita !== undefined || horaCita !== undefined)) {
      await avisarCambioDeCita({ solicitud, derivacion, proveedor, transaction });
    }
    return {
      derivacion: formatearDerivacion(derivacion, proveedor),
      solicitud: { id: solicitud.id, estado: solicitud.estado },
    };
  });
}

module.exports = {
  buscarProveedores,
  proveedoresDisponibles,
  formatearProveedor,
  INCLUIR_LUGAR,
  derivar,
  cambiarDerivacion,
};
