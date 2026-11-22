'use strict';

// Ayudantes de las pruebas del módulo documentos. Todos los datos son ficticios.

const crypto = require('node:crypto');
const sharp = require('sharp');
const db = require('../../../models');
const f = require('../../../../test/factories');
const { api } = require('../../../../test/helpers/app');
const { tokenPara } = require('../../../../test/helpers/auth');
const ocr = require('../../ocr/contratos');

const conToken = (req, token) => req.set('Authorization', `Bearer ${token}`);
const conClave = (req, clave = crypto.randomUUID()) => req.set('Idempotency-Key', clave);

/** Imagen PNG pequeña; cada `n` da una imagen (y un hash) distinta. */
async function imagen(n = 1) {
  return sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: (n * 37) % 256, g: (n * 91) % 256, b: (n * 53) % 256 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Simula los contratos del OCR (agente 07). Con `conOcr`, encolarExtraccion crea una extracción
 * `en_cola`; sin él, se comporta como un tipo sin plantilla de OCR (no hace nada).
 */
function simularOcr({ conOcr = false } = {}) {
  const encolar = jest
    .spyOn(ocr, 'encolarExtraccion')
    .mockImplementation(async ({ documentoId, transaction }) =>
      conOcr
        ? db.Extraccion.create(
            { documentoId, motor: 'simulado', estado: 'en_cola', progreso: 0 },
            { transaction },
          )
        : null,
    );
  const cancelar = jest
    .spyOn(ocr, 'cancelarExtraccion')
    .mockImplementation(async ({ documentoId, transaction }) => {
      const [n] = await db.Extraccion.update(
        { estado: 'cancelada' },
        { where: { documentoId, estado: ['en_cola', 'procesando'] }, transaction },
      );
      return n > 0;
    });
  return { encolar, cancelar };
}

/**
 * Familia con un niño y una solicitud en el estado pedido.
 * @param {{ estado?: string } & Record<string, unknown>} [datos]
 */
async function casoDeFamilia({ estado = 'CAPTURA', ...datos } = {}) {
  const familia = await f.crearFamilia();
  const solicitud = await f.crearSolicitud({ paciente: familia.paciente, estado, ...datos });
  return { ...familia, solicitud, token: await tokenPara(familia.usuario) };
}

const idTipo = (codigo) => f.idTipoDocumento(codigo);

/** POST /solicitudes/:id/documentos con una clave nueva. */
const crearDocumento = (solicitud, token, cuerpo) =>
  conClave(conToken(api().post(`/api/v1/solicitudes/${solicitud.id}/documentos`), token)).send(
    cuerpo,
  );

/** POST /documentos/:id/paginas con una clave nueva (o la indicada). */
const subirPagina = (documentoId, token, buffer, { orden, clave } = {}) => {
  const req = conClave(
    conToken(api().post(`/api/v1/documentos/${documentoId}/paginas`), token),
    clave,
  ).attach('archivo', buffer, 'pagina.png');
  return orden ? req.field('orden', String(orden)) : req;
};

/** Crea el documento, sube `paginas` imágenes distintas y lo finaliza. */
async function capturar(solicitud, token, tipo = 'fotos_condicion', paginas = 1) {
  const creado = await crearDocumento(solicitud, token, {
    tipoDocumentoId: await idTipo(tipo),
  }).expect(201);
  for (let i = 1; i <= paginas; i += 1) {
    await subirPagina(creado.body.id, token, await imagen(i)).expect(201);
  }
  const final = await conToken(api().post(`/api/v1/documentos/${creado.body.id}/finalizar`), token)
    .send({ paginasDeclaradas: paginas })
    .expect(200);
  return final.body;
}

module.exports = {
  conToken,
  conClave,
  imagen,
  simularOcr,
  casoDeFamilia,
  idTipo,
  crearDocumento,
  subirPagina,
  capturar,
};
