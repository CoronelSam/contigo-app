'use strict';

// Ayudantes de las pruebas del módulo OCR. Todos los datos son ficticios.

const sharp = require('sharp');
const db = require('../../../models');
const f = require('../../../../test/factories');
const cola = require('../../../core/cola');
const { guardarArchivo } = require('../../../core/archivos');
const { encolarExtraccion } = require('../contratos');

const caja = (y) => ({ x: 0.1, y, ancho: 0.4, alto: 0.05 });

/** Zonas de ejemplo: 2 campos en la página 1 y una pregunta con 3 casillas en la página 2. */
const ZONAS = Object.freeze([
  {
    campo: 'diagnostico',
    seccion: 'informacion_medica',
    rutaDato: '/diagnostico',
    tipo: 'texto',
    pagina: 1,
    caja: caja(0.1),
  },
  {
    campo: 'fecha_inicio',
    seccion: 'informacion_medica',
    rutaDato: '/fechaInicio',
    tipo: 'fecha',
    formato: 'DD/MM/AAAA',
    pagina: 1,
    caja: caja(0.2),
  },
  {
    campo: 'peso_nacer',
    seccion: 'embarazo_nacimiento',
    rutaDato: '/pesoNacerKg',
    tipo: 'numero',
    pagina: 2,
    caja: caja(0.1),
  },
  ...['vaginal', 'cesarea', 'no_se'].map((valor, i) => ({
    campo: `tipo_parto_${valor}`,
    seccion: 'embarazo_nacimiento',
    rutaDato: '/tipoParto',
    tipo: 'casilla',
    grupo: 'tipo_parto',
    valor,
    pagina: 2,
    caja: { x: 0.1 + i * 0.2, y: 0.3, ancho: 0.05, alto: 0.05 },
  })),
]);

/** Imagen PNG distinta para cada `n`. */
const imagen = (n = 1) =>
  sharp({
    create: { width: 40, height: 60, channels: 3, background: { r: 250, g: 250 - n, b: 250 } },
  })
    .png()
    .toBuffer();

/** Plantilla con zonas de OCR asociada al tipo de documento. */
async function plantillaPara(tipo = 'radiografias_informes', zonas = ZONAS) {
  const plantilla = await f.crearPlantilla({ zonasOcr: zonas });
  await db.TipoDocumento.update({ plantillaId: plantilla.id }, { where: { codigo: tipo } });
  return plantilla;
}

/** Documento CAPTURADO con `paginas` imágenes guardadas de verdad en el almacenamiento. */
async function documentoConPaginas({ solicitud, tipo = 'radiografias_informes', paginas = 2 }) {
  const documento = await f.crearDocumento({
    solicitud,
    tipo,
    paginas: 0,
    paginasDeclaradas: paginas,
  });
  for (let orden = 1; orden <= paginas; orden += 1) {
    const archivo = await guardarArchivo({ buffer: await imagen(orden), prefijo: 'documentos' });
    await db.DocumentoPagina.create({ documentoId: documento.id, orden, archivoId: archivo.id });
  }
  return documento;
}

/** Encola la extracción del documento (como el agente 06 al finalizar). */
const encolar = (documento) =>
  db.sequelize.transaction((transaction) =>
    encolarExtraccion({ documentoId: documento.id, transaction }),
  );

/**
 * Caso con voluntario asignado, documento con plantilla y extracción ya procesada.
 * @param {{ estado?: string }} [opciones]
 */
async function extraccionProcesada({ estado = 'EN_REVISION' } = {}) {
  const familia = await f.crearFamilia();
  const solicitud = await f.crearSolicitud({
    paciente: familia.paciente,
    estado,
    modalidad: 'fotos',
  });
  const voluntario = await f.crearUsuario({ rol: 'voluntario' });
  await f.crearAsignacion({ solicitud, voluntario });
  await plantillaPara();
  const documento = await documentoConPaginas({ solicitud });
  const extraccion = await encolar(documento);
  await cola.procesarPendientes();
  await extraccion.reload();
  const campos = await db.CampoExtraido.findAll({ where: { extraccionId: extraccion.id } });
  const campo = (nombre) => campos.find((c) => c.campo === nombre);
  return { familia, solicitud, voluntario, documento, extraccion, campos, campo };
}

module.exports = {
  ZONAS,
  imagen,
  plantillaPara,
  documentoConPaginas,
  encolar,
  extraccionProcesada,
};
