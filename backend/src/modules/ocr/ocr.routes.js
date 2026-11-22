'use strict';

// Revisión de OCR (38–40): voluntario asignado o coordinador.

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { registrarRuta } = require('../../openapi/registro');
const { entrada, salida } = require('./ocr.schemas');
const c = require('./ocr.controller');

const router = Router();
const ETIQUETA = ['OCR'];
const revisar = [requiereAuth, requierePermiso('ocr.revisar')];

router.get(
  '/extracciones/:id',
  ...revisar,
  validar({ params: entrada.paramsExtraccion }),
  c.obtener,
);
registrarRuta({
  metodo: 'get',
  ruta: '/extracciones/:id',
  etiquetas: ETIQUETA,
  resumen: 'Revisión de OCR de un documento',
  descripcion:
    'Progreso, páginas y campos propuestos con su confianza. `dudoso` marca los de confianza ' +
    'menor al umbral; las coordenadas permiten recortar la zona de la imagen (39). El acceso ' +
    'queda registrado.',
  params: entrada.paramsExtraccion,
  respuestas: { 200: { descripcion: 'Extracción', esquema: salida.extraccion } },
});

router.patch(
  '/extracciones/:id/campos/:campoId',
  ...revisar,
  validar({ params: entrada.paramsCampo, body: entrada.revisarCampo }),
  c.revisarCampo,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/extracciones/:id/campos/:campoId',
  etiquetas: ETIQUETA,
  resumen: 'Confirmar o corregir un campo',
  descripcion:
    '`{ valor }` lo corrige (o lo confirma si es igual al leído); `{ confirmar: true }` confirma ' +
    'el valor leído. Valida fechas, números, opciones y que haya una sola casilla marcada por ' +
    'grupo. Guarda el revisor y la fecha.',
  params: entrada.paramsCampo,
  body: entrada.revisarCampo,
  respuestas: { 200: { descripcion: 'Campo revisado', esquema: salida.campo } },
  errores: [409],
});

router.post(
  '/extracciones/:id/campos/confirmar',
  ...revisar,
  validar({ params: entrada.paramsExtraccion, body: entrada.confirmarEnBloque }),
  c.confirmarEnBloque,
);
registrarRuta({
  metodo: 'post',
  ruta: '/extracciones/:id/campos/confirmar',
  etiquetas: ETIQUETA,
  resumen: 'Confirmar en bloque los campos confiables',
  descripcion:
    'Solo campos no dudosos. Si la lista incluye uno dudoso responde 409 ' +
    '`OCR_CAMPO_DUDOSO_EN_BLOQUE` y no confirma ninguno.',
  params: entrada.paramsExtraccion,
  body: entrada.confirmarEnBloque,
  respuestas: { 200: { descripcion: 'Extracción', esquema: salida.extraccion } },
  errores: [409],
});

router.post(
  '/extracciones/:id/confirmar',
  ...revisar,
  validar({ params: entrada.paramsExtraccion }),
  c.confirmar,
);
registrarRuta({
  metodo: 'post',
  ruta: '/extracciones/:id/confirmar',
  etiquetas: ETIQUETA,
  resumen: 'Marcar como revisado',
  descripcion:
    'Exige que todos los campos estén confirmados o corregidos (409 `OCR_CAMPOS_SIN_VERIFICAR`). ' +
    'Pasa los valores a las secciones del formulario y avisa al coordinador. Si el formulario ' +
    'rechaza un valor, no se confirma nada y responde 400 con esos campos. El documento sigue ' +
    'CAPTURADO: solo el coordinador lo valida.',
  params: entrada.paramsExtraccion,
  respuestas: { 200: { descripcion: 'Revisión confirmada', esquema: salida.extraccion } },
  errores: [409],
});

module.exports = router;
