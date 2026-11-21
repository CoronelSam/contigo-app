'use strict';

// Niños, tutores y responsable legal, y el resumen del inicio de la familia.

const { Router } = require('express');
const { requiereAuth, requierePermiso } = require('../../core/auth');
const { validar } = require('../../core/http/validar');
const { subidaEnMemoria } = require('../../core/archivos');
const { registrarRuta, respuestaPaginadaDe } = require('../../openapi/registro');
const { z } = require('../../openapi/zod');
const { entrada, salida } = require('./familias.schemas');
const c = require('./pacientes.controller');

const router = Router();
const leer = [requiereAuth, requierePermiso('paciente.leer')];
const gestionar = [requiereAuth, requierePermiso('paciente.gestionar')];

router.get('/me/resumen', ...leer, c.resumen);
registrarRuta({
  metodo: 'get',
  ruta: '/me/resumen',
  etiquetas: ['Familias'],
  resumen: 'Inicio de la familia',
  descripcion:
    'Contadores y el estado de la última solicitud de cada niño. Solo cuentas de familia.',
  respuestas: { 200: { descripcion: 'Resumen', esquema: salida.resumen } },
});

router.get('/pacientes', ...leer, validar({ query: entrada.listarPacientes }), c.listar);
registrarRuta({
  metodo: 'get',
  ruta: '/pacientes',
  etiquetas: ['Familias'],
  resumen: 'Lista de niños',
  descripcion: 'La familia ve sus niños. El coordinador busca por nombre con `q` (sin acentos).',
  query: entrada.listarPacientes,
  respuestas: {
    200: { descripcion: 'Niños', esquema: respuestaPaginadaDe(salida.pacienteResumen) },
  },
});

router.post('/pacientes', ...gestionar, validar({ body: entrada.crearPaciente }), c.crear);
registrarRuta({
  metodo: 'post',
  ruta: '/pacientes',
  etiquetas: ['Familias'],
  resumen: 'Registrar un niño',
  descripcion:
    'Solo familias. El niño queda vinculado a la cuenta. Si la cuenta ya tiene un niño con el mismo nombre y ' +
    'fecha de nacimiento responde 409; reenvía con `confirmarDuplicado: true` si es otro niño.',
  body: entrada.crearPaciente,
  respuestas: { 201: { descripcion: 'Niño registrado', esquema: salida.paciente } },
  errores: [409],
});

router.get('/pacientes/:id', ...leer, validar({ params: entrada.paramsPaciente }), c.obtener);
registrarRuta({
  metodo: 'get',
  ruta: '/pacientes/:id',
  etiquetas: ['Familias'],
  resumen: 'Detalle de un niño',
  params: entrada.paramsPaciente,
  respuestas: { 200: { descripcion: 'Niño con sus tutores', esquema: salida.paciente } },
});

router.patch(
  '/pacientes/:id',
  ...gestionar,
  validar({ params: entrada.paramsPaciente, body: entrada.cambiarPaciente }),
  c.actualizar,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/pacientes/:id',
  etiquetas: ['Familias'],
  resumen: 'Editar los datos de un niño',
  descripcion:
    'La familia puede editar mientras ninguna solicitud del niño pasó a revisión (409 PACIENTE_EDICION_BLOQUEADA). ' +
    'El coordinador siempre, y queda en la bitácora.',
  params: entrada.paramsPaciente,
  body: entrada.cambiarPaciente,
  respuestas: { 200: { descripcion: 'Niño actualizado', esquema: salida.paciente } },
  errores: [409],
});

router.put(
  '/pacientes/:id/foto',
  ...gestionar,
  validar({ params: entrada.paramsPaciente }),
  ...subidaEnMemoria({ campo: 'foto' }),
  c.foto,
);
registrarRuta({
  metodo: 'put',
  ruta: '/pacientes/:id/foto',
  etiquetas: ['Familias'],
  resumen: 'Subir la foto del niño',
  descripcion: 'Imagen JPEG, PNG o WebP en el campo `foto`. Se lee con GET /archivos/:id/url.',
  params: entrada.paramsPaciente,
  bodyMultipart: z.object({ foto: z.string().openapi({ format: 'binary' }) }),
  respuestas: { 200: { descripcion: 'Foto actualizada', esquema: salida.paciente } },
  errores: [413],
});

router.post(
  '/pacientes/:id/tutores',
  ...gestionar,
  validar({ params: entrada.paramsPaciente, body: entrada.agregarTutor }),
  c.agregarTutor,
);
registrarRuta({
  metodo: 'post',
  ruta: '/pacientes/:id/tutores',
  etiquetas: ['Familias'],
  resumen: 'Agregar un padre, madre o tutor',
  descripcion:
    'Con `esLaCuentaActual` completa el perfil de tutor de la cuenta. Para ser responsable legal hay que ' +
    'enviar `confirmoResponsableLegal: true`; se guarda la fecha y quién lo confirmó.',
  params: entrada.paramsPaciente,
  body: entrada.agregarTutor,
  respuestas: { 201: { descripcion: 'Tutor vinculado', esquema: salida.tutor } },
});

router.patch(
  '/tutores/:id',
  ...gestionar,
  validar({ params: entrada.paramsTutor, body: entrada.cambiarTutor }),
  c.actualizarTutor,
);
registrarRuta({
  metodo: 'patch',
  ruta: '/tutores/:id',
  etiquetas: ['Familias'],
  resumen: 'Editar los datos de un tutor',
  descripcion: 'La familia no puede editar el perfil de otra cuenta (409 TUTOR_DE_OTRA_CUENTA).',
  params: entrada.paramsTutor,
  body: entrada.cambiarTutor,
  respuestas: { 200: { descripcion: 'Tutor actualizado' } },
  errores: [409],
});

router.delete(
  '/pacientes/:id/tutores/:tutorId',
  ...gestionar,
  validar({ params: entrada.paramsVinculo }),
  c.quitarTutor,
);
registrarRuta({
  metodo: 'delete',
  ruta: '/pacientes/:id/tutores/:tutorId',
  etiquetas: ['Familias'],
  resumen: 'Quitar el vínculo de un tutor con el niño',
  descripcion:
    'No borra al tutor. Nunca deja al niño sin responsable legal, y la familia no puede quitar su propio ' +
    'vínculo ni el de otra cuenta.',
  params: entrada.paramsVinculo,
  respuestas: { 204: { descripcion: 'Vínculo quitado' } },
  errores: [409],
});

module.exports = router;
