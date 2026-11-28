'use strict';

// Chat por caso entre la familia y el equipo (31).

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { subidaEnMemoria } = require('../../core/archivos');
const { idempotente } = require('../../core/http/idempotencia');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./comunicacion.schemas');
const c = require('./comunicacion.controller');

const router = Router();
const ETIQUETA = ['Mensajes'];
const participantes = [requiereAuth, requierePermiso('mensaje.enviar')];
const params = validar({ params: entrada.paramsId });

const PARTICIPANTES =
  'Participan la familia vinculada al niño y los coordinadores; el voluntario no participa ' +
  '(403 `MENSAJE_ROL_NO_PARTICIPA` o `SIN_PERMISO`). Sin relación con el caso → 404.';

router.get(
  '/solicitudes/:id/mensajes',
  ...participantes,
  validar({ params: entrada.paramsId, query: entrada.filtrosMensajes }),
  c.listarMensajes,
);
registrarRuta({
  metodo: 'get',
  ruta: '/solicitudes/:id/mensajes',
  etiquetas: ETIQUETA,
  resumen: 'Mensajes del caso',
  descripcion:
    `Del más reciente al más antiguo; \`antesDe\` pide los anteriores. ${PARTICIPANTES} ` +
    'Ante la familia, el personal aparece como "Coordinador del caso / Equipo Vanguardia".',
  params: entrada.paramsId,
  query: entrada.filtrosMensajes,
  respuestas: { 200: { descripcion: 'Mensajes', esquema: salida.listaMensajes } },
});

router.post(
  '/solicitudes/:id/mensajes',
  ...participantes,
  params,
  ...subidaEnMemoria({ campo: 'archivo' }),
  idempotente({ obligatorio: false }),
  validar({ body: entrada.mensaje }),
  c.enviarMensaje,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/mensajes',
  etiquetas: ETIQUETA,
  resumen: 'Enviar un mensaje',
  descripcion:
    'JSON `{ cuerpo }` o multipart con `cuerpo` y `archivo` (imagen o PDF, mismos límites que ' +
    'los documentos). Sin texto ni adjunto → 400. No se editan ni se borran. Avisa ' +
    '`MENSAJE_NUEVO` a la otra parte. `Idempotency-Key` recomendado. ' +
    PARTICIPANTES,
  params: entrada.paramsId,
  headers: entrada.cabeceraIdempotencia,
  // registrarRuta documenta un solo tipo de cuerpo: el multipart cubre los dos campos; el JSON
  // `{ cuerpo }` (esquema MensajeNuevo) también se acepta.
  bodyMultipart: entrada.mensajeMultipart,
  respuestas: { 201: { descripcion: 'Mensaje enviado', esquema: salida.mensajeSalida } },
  errores: [409, 413, 422],
});

router.post(
  '/solicitudes/:id/mensajes/leidos',
  ...participantes,
  validar({ params: entrada.paramsId, body: entrada.leidos }),
  c.marcarLeidos,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/mensajes/leidos',
  etiquetas: ETIQUETA,
  resumen: 'Marcar mensajes como leídos',
  descripcion:
    'Marca los mensajes de la otra parte hasta `hastaId` (incluido). Los propios no cambian. ' +
    PARTICIPANTES,
  params: entrada.paramsId,
  body: entrada.leidos,
  respuestas: { 200: { descripcion: 'Resultado', esquema: salida.leidosSalida } },
});

module.exports = router;
