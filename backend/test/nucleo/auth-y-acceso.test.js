'use strict';

const { Router } = require('express');
const sharp = require('sharp');
const db = require('../../src/models');
const f = require('../factories');
const { limpiarBase } = require('../helpers/db');
const { tokenPara } = require('../helpers/auth');
const { appDePrueba } = require('../helpers/app');
const { requiereAuth, requierePermiso, invalidarCachePermisos } = require('../../src/core/auth');
const contexto = require('../../src/core/contexto');
const { subidaEnMemoria } = require('../../src/core/archivos');
const acceso = require('../../src/core/acceso');

const { obtenerSolicitudConAcceso } = acceso;
const como = (u) => ({ id: u.id, rol: u.rolCodigo });

// Módulo de ejemplo: proteger una ruta toma 3 líneas.
const router = Router();
router.get(
  '/ejemplo/solicitudes/:id',
  requiereAuth,
  requierePermiso('solicitud.leer'),
  async (req, res) => {
    const solicitud = await obtenerSolicitudConAcceso(req.usuario, req.params.id);
    res.json({ codigo: solicitud.codigo });
  },
);
router.get('/ejemplo/contexto', requiereAuth, async (req, res) => {
  const ctx = contexto.actual();
  res.json({
    usuarioId: ctx.usuario?.id,
    tieneIp: Boolean(ctx.ip),
    requestId: ctx.requestId ?? null,
  });
});
router.post('/ejemplo/subida', requiereAuth, ...subidaEnMemoria(), async (req, res) => {
  res.json({ usuarioId: contexto.actual().usuario?.id, bytes: req.file?.size });
});
const cliente = appDePrueba(router);

describe('requiereAuth, requierePermiso y acceso al caso', () => {
  let familia;
  let solicitud;

  beforeEach(async () => {
    await limpiarBase();
    invalidarCachePermisos();
    familia = await f.crearFamilia();
    solicitud = await f.crearSolicitud({ paciente: familia.paciente, estado: 'CAPTURA' });
  });

  const pedir = async (usuario, id = solicitud.id) =>
    cliente
      .get(`/ejemplo/solicitudes/${id}`)
      .set('Authorization', `Bearer ${await tokenPara(usuario)}`);

  test('sin token o con un token mal formado responde 401', async () => {
    const sinToken = await cliente.get(`/ejemplo/solicitudes/${solicitud.id}`).expect(401);
    expect(sinToken.body.codigo).toBe('NO_AUTENTICADO');
    const malo = await cliente
      .get(`/ejemplo/solicitudes/${solicitud.id}`)
      .set('Authorization', 'Bearer no.es.un.jwt')
      .expect(401);
    expect(malo.body.codigo).toBe('NO_AUTENTICADO');
    await cliente
      .get(`/ejemplo/solicitudes/${solicitud.id}`)
      .set('Authorization', 'Basic abc')
      .expect(401);
  });

  test('una sesión revocada o vencida, o un usuario inactivo, responden 401 SESION_INVALIDA', async () => {
    const token = await tokenPara(familia.usuario);
    await db.Sesion.update(
      { revocadaEn: new Date() },
      { where: { usuarioId: familia.usuario.id } },
    );
    const revocada = await cliente
      .get(`/ejemplo/solicitudes/${solicitud.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(revocada.body.codigo).toBe('SESION_INVALIDA');

    const token2 = await tokenPara(familia.usuario);
    await db.Sesion.update(
      { expiraEn: new Date(Date.now() - 1000) },
      { where: { revocadaEn: null } },
    );
    await cliente
      .get(`/ejemplo/solicitudes/${solicitud.id}`)
      .set('Authorization', `Bearer ${token2}`)
      .expect(401);

    const token3 = await tokenPara(familia.usuario);
    await familia.usuario.update({ estado: 'inactivo' });
    await cliente
      .get(`/ejemplo/solicitudes/${solicitud.id}`)
      .set('Authorization', `Bearer ${token3}`)
      .expect(401);
  });

  test('sin el permiso de la acción responde 403 (el administrador no lee expedientes)', async () => {
    const admin = await f.crearUsuario({ rol: 'administrador' });
    const res = await pedir(admin);
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe('SIN_PERMISO');
  });

  test('un cambio de rol aplica en la siguiente petición', async () => {
    const coordinador = await f.crearUsuario({ rol: 'coordinador' });
    const token = await tokenPara(coordinador);
    const ruta = `/ejemplo/solicitudes/${solicitud.id}`;
    await cliente.get(ruta).set('Authorization', `Bearer ${token}`).expect(200);
    await coordinador.update({ rolId: await f.idRol('administrador') });
    await cliente.get(ruta).set('Authorization', `Bearer ${token}`).expect(403);
  });

  test('familia vinculada 200; familia ajena, id inexistente o inválido 404', async () => {
    expect((await pedir(familia.usuario)).body).toEqual({ codigo: solicitud.codigo });
    const ajena = await f.crearFamilia();
    const res = await pedir(ajena.usuario);
    expect(res.status).toBe(404);
    expect(res.body.codigo).toBe('NO_ENCONTRADO');
    expect((await pedir(familia.usuario, '7d4f3c0e-6f1a-4b8e-9a51-2a3c4d5e6f70')).status).toBe(404);
    expect((await pedir(familia.usuario, 'no-es-uuid')).status).toBe(404);
  });

  test('voluntario: 200 con asignación activa, 404 sin ella o con la asignación cerrada', async () => {
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    expect((await pedir(voluntario)).status).toBe(404);
    const asignacion = await f.crearAsignacion({ solicitud, voluntario });
    expect((await pedir(voluntario)).status).toBe(200);
    await asignacion.update({ activa: false });
    expect((await pedir(voluntario)).status).toBe(404);
  });

  test('el coordinador ve todos los casos; el administrador ninguno (404 directo)', async () => {
    const coordinador = await f.crearUsuario({ rol: 'coordinador' });
    expect((await pedir(coordinador)).status).toBe(200);
    const admin = await f.crearUsuario({ rol: 'administrador' });
    await expect(obtenerSolicitudConAcceso(como(admin), solicitud.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  test('el contexto lleva usuario, IP e id de petición, también después de multer', async () => {
    const token = await tokenPara(familia.usuario);
    const res = await cliente
      .get('/ejemplo/contexto')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ usuarioId: familia.usuario.id, tieneIp: true, requestId: null });

    const imagen = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#888' } })
      .jpeg()
      .toBuffer();
    const subida = await cliente
      .post('/ejemplo/subida')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', imagen, 'foto.jpg')
      .expect(200);
    expect(subida.body).toEqual({ usuarioId: familia.usuario.id, bytes: imagen.length });
  });

  test('fuera de una petición el contexto es el de sistema', () => {
    expect(contexto.actual()).toMatchObject({ usuario: null, sistema: true });
    expect(contexto.ejecutarCon({ ip: '1.2.3.4' }, () => contexto.actual().ip)).toBe('1.2.3.4');
  });
});

describe('core/acceso', () => {
  beforeEach(() => limpiarBase());

  test('obtenerPacienteConAcceso: familia vinculada y coordinador sí; otros 404', async () => {
    const familia = await f.crearFamilia();
    const ajena = await f.crearFamilia();
    const coordinador = await f.crearUsuario({ rol: 'coordinador' });
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    const id = familia.paciente.id;
    await expect(acceso.obtenerPacienteConAcceso(como(familia.usuario), id)).resolves.toBeDefined();
    await expect(acceso.obtenerPacienteConAcceso(como(coordinador), id)).resolves.toBeDefined();
    await expect(acceso.obtenerPacienteConAcceso(como(ajena.usuario), id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(acceso.obtenerPacienteConAcceso(como(voluntario), id)).rejects.toMatchObject({
      status: 404,
    });
  });

  test('filtroSolicitudesVisibles devuelve solo lo que cada rol puede ver', async () => {
    const familia = await f.crearFamilia({ hijos: 2 });
    const propias = [
      await f.crearSolicitud({ paciente: familia.pacientes[0] }),
      await f.crearSolicitud({ paciente: familia.pacientes[1] }),
    ];
    const ajena = await f.crearSolicitud();
    const voluntario = await f.crearUsuario({ rol: 'voluntario' });
    await f.crearAsignacion({ solicitud: ajena, voluntario });
    await f.crearAsignacion({ solicitud: propias[0], voluntario, activa: false });

    const visibles = async (usuario) =>
      (await db.Solicitud.findAll({ where: acceso.filtroSolicitudesVisibles(como(usuario)) }))
        .map((s) => s.id)
        .sort();
    expect(await visibles(familia.usuario)).toEqual(propias.map((s) => s.id).sort());
    expect(await visibles(voluntario)).toEqual([ajena.id]);
    expect(await visibles(await f.crearUsuario({ rol: 'coordinador' }))).toHaveLength(3);
    expect(await visibles(await f.crearUsuario({ rol: 'administrador' }))).toEqual([]);
  });

  test('usuariosFamiliaDe y coordinadoresDe', async () => {
    const familia = await f.crearFamilia();
    const otraCuenta = await f.crearUsuario();
    const tutor2 = await f.crearTutor({ usuarioId: otraCuenta.id });
    await f.vincularTutor({ paciente: familia.paciente, tutor: tutor2 });
    const sinCuenta = await f.crearTutor();
    await f.vincularTutor({ paciente: familia.paciente, tutor: sinCuenta });
    const solicitud = await f.crearSolicitud({ paciente: familia.paciente });

    expect((await acceso.usuariosFamiliaDe(solicitud.id)).sort()).toEqual(
      [familia.usuario.id, otraCuenta.id].sort(),
    );
    await otraCuenta.update({ estado: 'inactivo' });
    expect(await acceso.usuariosFamiliaDe(solicitud.id)).toEqual([familia.usuario.id]);

    const c1 = await f.crearUsuario({ rol: 'coordinador' });
    const c2 = await f.crearUsuario({ rol: 'coordinador' });
    expect((await acceso.coordinadoresDe(solicitud)).sort()).toEqual([c1.id, c2.id].sort());
    await solicitud.update({ coordinadorId: c2.id });
    expect(await acceso.coordinadoresDe(solicitud)).toEqual([c2.id]);
  });

  describe('ventanas de edición', () => {
    let familia;
    const editar = (solicitud, objetivo) =>
      acceso.puedeEditar(como(familia.usuario), solicitud, objetivo);

    beforeEach(async () => {
      familia = await f.crearFamilia();
    });

    test('familia: todo en BORRADOR y CAPTURA; nada en revisión, evaluación sin ruta ni estados finales', async () => {
      for (const estado of ['BORRADOR', 'CAPTURA']) {
        const s = await f.crearSolicitud({ estado });
        expect(await editar(s, { seccion: 'informacion_medica' })).toBe(true);
      }
      for (const estado of [
        'EN_REVISION',
        'EN_EVALUACION',
        'COMPLETA',
        'ENVIADA',
        'ACEPTADA',
        'DENEGADA',
        'DERIVADA_HN',
        'ATENDIDA_HN',
      ]) {
        const s = await f.crearSolicitud({ estado });
        expect({ estado, puede: await editar(s, { seccion: 'informacion_medica' }) }).toEqual({
          estado,
          puede: false,
        });
      }
    });

    test('familia en INFO_ADICIONAL: solo lo que tiene una corrección abierta', async () => {
      const s = await f.crearSolicitud({ estado: 'INFO_ADICIONAL' });
      await f.crearCorreccion({ solicitud: s, seccion: 'educacion' });
      const rechazado = await f.crearDocumento({
        solicitud: s,
        tipo: 'fotos_condicion',
        estado: 'RECHAZADO',
      });
      await f.crearCorreccion({ solicitud: s, documento: rechazado });
      expect(await editar(s, { seccion: 'educacion' })).toBe(true);
      expect(await editar(s, { seccion: 'informacion_medica' })).toBe(false);
      expect(await editar(s, { tipoDocumentoId: rechazado.tipoDocumentoId })).toBe(true);
      expect(
        await editar(s, { tipoDocumentoId: await f.idTipoDocumento('radiografias_informes') }),
      ).toBe(false);
    });

    test('familia en PAQUETE_EXTERIOR: documentos del paquete fijado y secciones de la etapa de paquete', async () => {
      const s = await f.crearSolicitud({ estado: 'PAQUETE_EXTERIOR', rutaDecidida: 'MEXICO' });
      expect(
        await editar(s, { tipoDocumentoId: await f.idTipoDocumento('informacion_financiera') }),
      ).toBe(true);
      expect(
        await editar(s, { tipoDocumentoId: await f.idTipoDocumento('solicitud_internacional') }),
      ).toBe(false);
      expect(await editar(s, { tipoDocumentoId: await f.idTipoDocumento('fotos_condicion') })).toBe(
        false,
      );
      expect(await editar(s, { seccion: 'educacion' })).toBe(true);
      expect(await editar(s, { seccion: 'consentimientos' })).toBe(true);
      expect(await editar(s, { seccion: 'informacion_medica' })).toBe(false);
    });

    test('familia en EN_EVALUACION con ruta Honduras: solo requisitos de Honduras', async () => {
      const s = await f.crearSolicitud({ estado: 'EN_EVALUACION', rutaDecidida: 'HONDURAS' });
      const tipo = await f.idTipoDocumento('inmunizaciones');
      expect(await editar(s, { tipoDocumentoId: tipo })).toBe(false);
      await db.RequisitoRuta.create({ ruta: 'HONDURAS', tipoDocumentoId: tipo });
      expect(await editar(s, { tipoDocumentoId: tipo })).toBe(true);
      expect(await editar(s, { seccion: 'informacion_medica' })).toBe(false);
    });

    test('voluntario asignado y coordinador', async () => {
      const voluntario = await f.crearUsuario({ rol: 'voluntario' });
      const coordinador = await f.crearUsuario({ rol: 'coordinador' });
      const enCaptura = await f.crearSolicitud({ estado: 'CAPTURA' });
      expect(await acceso.puedeEditar(como(voluntario), enCaptura)).toBe(false);
      await f.crearAsignacion({ solicitud: enCaptura, voluntario });
      expect(await acceso.puedeEditar(como(voluntario), enCaptura)).toBe(true);
      const evaluando = await f.crearSolicitud({ estado: 'EN_EVALUACION' });
      await f.crearAsignacion({ solicitud: evaluando, voluntario });
      expect(await acceso.puedeEditar(como(voluntario), evaluando)).toBe(false);

      expect(
        await acceso.puedeEditar(como(coordinador), await f.crearSolicitud({ estado: 'DENEGADA' })),
      ).toBe(true);
      const aceptada = await f.crearSolicitud({ estado: 'ACEPTADA' });
      expect(await acceso.puedeEditar(como(coordinador), aceptada)).toBe(false);
      await expect(acceso.exigirEdicion(como(coordinador), aceptada)).rejects.toMatchObject({
        status: 409,
        codigo: 'SOLICITUD_EDICION_BLOQUEADA',
      });
    });
  });
});
