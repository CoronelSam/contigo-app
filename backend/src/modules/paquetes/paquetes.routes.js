'use strict';

// Paquete PDF (47, 48), envío a Shriners (49) y respuesta (50). Solo para la ruta al exterior.

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./paquetes.schemas');
const c = require('./paquetes.controller');

const router = Router();
const PAQUETE = ['Paquete PDF'];
const ENVIO = ['Envío a Shriners'];
const con = (permiso) => [requiereAuth, requierePermiso(permiso)];
const params = validar({ params: entrada.paramsId });

router.post(
  '/solicitudes/:id/paquetes',
  ...con('paquete.generar'),
  validar({ params: entrada.paramsId, body: entrada.generar }),
  c.solicitar,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/paquetes',
  etiquetas: PAQUETE,
  resumen: 'Generar el paquete PDF',
  descripcion:
    'Solo con ruta MEXICO o INTERNACIONAL (si no, `PAQUETE_NO_APLICA`). `borrador` en ' +
    'PAQUETE_EXTERIOR, EN_REVISION (etapa paquete) o COMPLETA; `final` exige COMPLETA y el ' +
    'expediente sin obligatorios pendientes (`PAQUETE_FALTANTES` con la lista). Crea el paquete ' +
    '`en_cola` y lo genera en segundo plano: consulta el avance con `GET /paquetes/{id}`.',
  body: entrada.generar,
  params: entrada.paramsId,
  respuestas: { 202: { descripcion: 'Paquete en cola', esquema: salida.paqueteEnCola } },
  errores: [409],
});

router.get('/paquetes/:id', ...con('paquete.generar'), params, c.obtener);
registrarRuta({
  metodo: 'get',
  ruta: '/paquetes/:id',
  etiquetas: PAQUETE,
  resumen: 'Estado del paquete',
  descripcion:
    'Estado y progreso, número de páginas, plantillas (con versión) y anexos incluidos, avisos ' +
    '(firmas pendientes, campos o anexos omitidos por consentimiento, anexos faltantes, campos ' +
    'recortados) y revisión.',
  params: entrada.paramsId,
  respuestas: { 200: { descripcion: 'Paquete', esquema: salida.paqueteSalida } },
});

router.get(
  '/paquetes/:id/paginas/:n',
  ...con('paquete.generar'),
  validar({ params: entrada.paramsPagina }),
  c.pagina,
);
registrarRuta({
  metodo: 'get',
  ruta: '/paquetes/:id/paginas/:n',
  etiquetas: PAQUETE,
  resumen: 'Ver una página del paquete',
  descripcion:
    'URL firmada (5 minutos) de un PDF con solo esa página, para la vista previa. Página fuera ' +
    'de rango → 404. El paquete debe estar `listo` (`PAQUETE_NO_LISTO`). Registra el acceso.',
  params: entrada.paramsPagina,
  respuestas: { 200: { descripcion: 'Página', esquema: salida.pagina } },
  errores: [409],
});

router.post(
  '/paquetes/:id/enlace',
  ...con('paquete.generar'),
  validar({ params: entrada.paramsId, body: entrada.enlace }),
  c.enlace,
);
registrarRuta({
  metodo: 'post',
  ruta: '/paquetes/:id/enlace',
  etiquetas: PAQUETE,
  resumen: 'Confirmar la revisión y compartir',
  descripcion:
    'Con `confirmoRevision: true` marca quién revisó y cuándo, y devuelve una URL firmada del ' +
    'PDF completo que vence en `PAQUETE_ENLACE_MINUTOS` (60 por defecto). Solo paquetes `final` ' +
    '(`PAQUETE_NO_FINAL`) y `listo` (`PAQUETE_NO_LISTO`). Registra el acceso.',
  params: entrada.paramsId,
  body: entrada.enlace,
  respuestas: { 200: { descripcion: 'Enlace firmado', esquema: salida.enlaceSalida } },
  errores: [409],
});

router.post(
  '/solicitudes/:id/envios',
  ...con('envio.registrar'),
  validar({ params: entrada.paramsId, body: entrada.envio }),
  c.registrarEnvio,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/envios',
  etiquetas: ENVIO,
  resumen: 'Registrar el envío a Shriners',
  descripcion:
    'Registro interno, sin integración con Shriners. Exige la solicitud en COMPLETA ' +
    '(`ENVIO_ESTADO_INVALIDO`) y un paquete `final`, `listo` y revisado de esta solicitud, ' +
    'generado en el estado COMPLETA actual (`ENVIO_SIN_PAQUETE_FINAL`); `destino` igual al ' +
    'paquete (`ENVIO_DESTINO_DISTINTO`). Pasa a ENVIADA y avisa a la familia que Shriners ' +
    'decidirá: no es una aceptación.',
  params: entrada.paramsId,
  body: entrada.envio,
  respuestas: { 201: { descripcion: 'Envío registrado', esquema: salida.envioRegistrado } },
  errores: [409],
});

router.post(
  '/solicitudes/:id/respuestas',
  ...con('respuesta.registrar'),
  validar({ params: entrada.paramsId, body: entrada.respuesta }),
  c.registrarRespuesta,
);
registrarRuta({
  metodo: 'post',
  ruta: '/solicitudes/:id/respuestas',
  etiquetas: ENVIO,
  resumen: 'Registrar la respuesta de Shriners',
  descripcion:
    'Exige ENVIADA (`RESPUESTA_ESTADO_INVALIDO`) y se guarda con el último envío. ' +
    '`informacion_adicional` → INFO_ADICIONAL, `aceptada` → ACEPTADA, `denegada` → DENEGADA con ' +
    '`acciones: ["reabrir_evaluacion"]`. La familia recibe un aviso neutral ' +
    '(RESPUESTA_REGISTRADA) que la invita a revisar los mensajes del coordinador.',
  params: entrada.paramsId,
  body: entrada.respuesta,
  respuestas: {
    201: { descripcion: 'Respuesta registrada', esquema: salida.respuestaRegistrada },
  },
  errores: [409],
});

module.exports = router;
