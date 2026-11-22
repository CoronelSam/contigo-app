'use strict';

// Solicitud: creación (11), modalidad (12), resumen del expediente (21, 28) y envío (28–29).

const { Op } = require('sequelize');
const { obtenerSolicitudConAcceso, obtenerPacienteConAcceso } = require('../../core/acceso');
const { cambiarEstado, registrarCreacion } = require('../../core/estados');
const { ESTADOS_SOLICITUD: E, ETAPAS } = require('../../core/estados/constantes');
const { auditarCambio, registrarAcceso } = require('../../core/auditoria');
const { estadoExpediente, CODIGOS_SECCIONES_JSON } = require('../../core/expediente');
const { generarCodigo } = require('./codigo');
const errores = require('./solicitudes.errores');
const { tiposConFirma, formatearConsentimiento } = require('./consentimientos.service');
const {
  ESTADOS_CERRADOS,
  esPersonal,
  idiomaDe,
  leerConfiguracion,
  formatearSolicitud,
} = require('./solicitudes.util');

const modelos = () => require('../../models');

const nombreCompleto = (p) =>
  [p.nombres, p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' ');

/**
 * POST /solicitudes: nueva solicitud en BORRADOR con su código de caso.
 * @param {{ id: string, rol: string }} usuario
 * @param {{ pacienteId: string }} cuerpo
 */
async function crearSolicitud(usuario, { pacienteId }) {
  const { sequelize, Solicitud } = modelos();
  return sequelize.transaction(async (transaction) => {
    const paciente = await obtenerPacienteConAcceso(usuario, pacienteId, { transaction });
    // Serializa las creaciones del mismo niño para que la regla de solicitudes abiertas no falle
    // con 2 peticiones a la vez.
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:clave, 0))', {
      replacements: { clave: `solicitudes:paciente:${paciente.id}` },
      transaction,
    });
    const multiples = await leerConfiguracion(
      'solicitudes.permitir_multiples_abiertas',
      false,
      transaction,
    );
    if (multiples !== true) {
      const abierta = await Solicitud.findOne({
        where: { pacienteId: paciente.id, estado: { [Op.notIn]: ESTADOS_CERRADOS } },
        attributes: ['id'],
        transaction,
      });
      if (abierta) throw errores.abiertaExistente();
    }

    const solicitud = await Solicitud.create(
      {
        codigo: await generarCodigo({ transaction }),
        pacienteId: paciente.id,
        estado: E.BORRADOR,
        etapa: ETAPAS.EVALUACION,
        creadaPor: usuario.id,
      },
      { transaction },
    );
    await registrarCreacion({ solicitud, usuario, transaction });
    return formatearSolicitud(solicitud, usuario);
  });
}

/**
 * PUT /solicitudes/:id/modalidad. En BORRADOR la elige y pasa a CAPTURA; en CAPTURA la cambia sin
 * cambiar de estado. Ambos casos quedan en la bitácora.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 * @param {{ modalidad: 'app' | 'fotos' }} cuerpo
 */
async function elegirModalidad(usuario, solicitudId, { modalidad }) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (![E.BORRADOR, E.CAPTURA].includes(solicitud.estado)) {
      throw errores.modalidadBloqueada(solicitud.estado);
    }
    await auditarCambio(
      solicitud,
      { modalidad },
      { transaction, accion: 'solicitud.cambiar_modalidad', solicitudId: solicitud.id },
    );
    if (solicitud.estado === E.BORRADOR) {
      await cambiarEstado({ solicitud, a: E.CAPTURA, usuario, transaction });
    }
    return formatearSolicitud(solicitud, usuario);
  });
}

function formatearDocumentos(documentos, idioma) {
  return documentos.map((d) => ({
    codigo: d.codigo,
    nombre: idioma === 'en' ? d.nombreEn : d.nombreEs,
    ruta: d.ruta,
    obligatorio: d.obligatorio,
    orden: d.orden,
    estado: d.estado,
    documentoId: d.documentoId,
    version: d.version,
    cubiertoPorFormulario: d.cubiertoPorFormulario,
    cumplido: d.cumplido,
    extraccion: d.extraccion,
  }));
}

/**
 * GET /solicitudes/:id: resumen del expediente (21, 28). A la familia no se le devuelven la ruta
 * sugerida ni datos del personal. Para voluntario y coordinador registra el acceso.
 * @param {{ id: string, rol: string, idioma?: string }} usuario
 * @param {string} solicitudId
 */
async function obtenerResumen(usuario, solicitudId) {
  const { Paciente, SolicitudSeccion, ProfesionalSalud, Consentimiento } = modelos();
  const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId);
  const idioma = idiomaDe(usuario);

  const [expediente, paciente, filas, profesional, consentimientos, conFirma] = await Promise.all([
    estadoExpediente(solicitud.id),
    Paciente.findByPk(solicitud.pacienteId),
    SolicitudSeccion.findAll({
      where: { solicitudId: solicitud.id },
      attributes: ['seccion', 'version'],
    }),
    ProfesionalSalud.findOne({ where: { solicitudId: solicitud.id } }),
    Consentimiento.findAll({
      where: { solicitudId: solicitud.id },
      include: [{ association: 'texto', attributes: ['version', 'idioma'] }],
    }),
    tiposConFirma(),
  ]);
  if (esPersonal(usuario)) {
    await registrarAcceso({
      solicitudId: solicitud.id,
      recurso: 'expediente',
      recursoId: solicitud.id,
    });
  }

  const version = new Map(filas.map((f) => [f.seccion, f.version]));
  const porTipo = new Map(consentimientos.map((c) => [c.tipo, c]));

  const resumen = {
    ...formatearSolicitud(solicitud, usuario),
    paciente: {
      id: paciente.id,
      nombreCompleto: nombreCompleto(paciente),
      fechaNacimiento: paciente.fechaNacimiento,
      sexo: paciente.sexo,
    },
    secciones: expediente.secciones.map((s) => ({
      codigo: s.codigo,
      orden: s.orden,
      titulo: idioma === 'en' ? s.tituloEn : s.tituloEs,
      estado: s.estado,
      obligatoria: s.obligatoria,
      version: CODIGOS_SECCIONES_JSON.includes(s.codigo) ? (version.get(s.codigo) ?? 0) : null,
    })),
    documentos: formatearDocumentos(expediente.documentos, idioma),
    profesional: {
      nombre: profesional?.nombre ?? null,
      especialidad: profesional?.especialidad ?? null,
      telefono: profesional?.telefono ?? null,
      correo: profesional?.correo ?? null,
      documentoCertificacionId: profesional?.documentoCertificacionId ?? null,
      estado: expediente.profesional.estado,
      obligatorio: expediente.profesional.obligatorio,
    },
    consentimientos: expediente.consentimientos.map((c) => {
      const fila = porTipo.get(c.tipo);
      return fila
        ? formatearConsentimiento(fila, fila.texto, conFirma)
        : {
            tipo: c.tipo,
            decision: null,
            textoId: null,
            textoVersion: null,
            textoIdioma: null,
            textoAbiertoEn: null,
            decididoEn: null,
            estadoFirma: null,
            firmaPendiente: false,
            documentoFirmadoId: null,
          };
    }),
    faltantes: expediente.faltantes,
    faltantesAlEnviar: solicitud.faltantesAlEnviar ?? [],
    rutaDecidida: solicitud.rutaDecidida ?? null,
    paquete: solicitud.paquete ?? null,
  };
  if (esPersonal(usuario)) {
    resumen.rutaSugerida = solicitud.rutaSugerida ?? null;
    resumen.listoParaConfirmar = expediente.listoParaConfirmar;
  }
  return resumen;
}

/**
 * POST /solicitudes/:id/enviar: pasa a EN_REVISION. Se permite con faltantes: se guardan en
 * `faltantes_al_enviar` y se devuelven, pero eso no vuelve completo el expediente.
 * @param {{ id: string, rol: string }} usuario
 * @param {string} solicitudId
 */
async function enviar(usuario, solicitudId) {
  const { sequelize } = modelos();
  return sequelize.transaction(async (transaction) => {
    const solicitud = await obtenerSolicitudConAcceso(usuario, solicitudId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    // Con la solicitud bloqueada: los faltantes son los del momento exacto del envío.
    const { faltantes } = await estadoExpediente(solicitud.id, { transaction });
    await cambiarEstado({
      solicitud,
      a: E.EN_REVISION,
      usuario,
      campos: { faltantesAlEnviar: faltantes, enviadaEn: new Date() },
      transaction,
    });
    return { solicitud: formatearSolicitud(solicitud, usuario), faltantes };
  });
}

module.exports = { crearSolicitud, elegirModalidad, obtenerResumen, enviar };
