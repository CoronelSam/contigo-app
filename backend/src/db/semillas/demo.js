'use strict';

// Datos de demostración: SOLO desarrollo. Todo es ficticio y se ve ficticio.
// Usuarios *.demo@vanguardia.test con la contraseña de SEED_DEMO_CONTRASENA.
// Idempotente: si ya existe la familia de demostración, no hace nada.

const { randomUUID } = require('node:crypto');
const argon2 = require('argon2');
const { ESTADOS_SOLICITUD: E } = require('../../core/estados/constantes');

const CORREO_CONTROL = 'familia.demo@vanguardia.test';
const DIA_MS = 24 * 60 * 60 * 1000;

const USUARIOS = [
  {
    clave: 'familia1',
    correo: CORREO_CONTROL,
    nombres: 'Familia Demo',
    apellidos: 'Uno',
    rol: 'familia',
  },
  {
    clave: 'familia2',
    correo: 'familia2.demo@vanguardia.test',
    nombres: 'Familia Demo',
    apellidos: 'Dos',
    rol: 'familia',
  },
  {
    clave: 'familia3',
    correo: 'familia3.demo@vanguardia.test',
    nombres: 'Familia Demo',
    apellidos: 'Tres',
    rol: 'familia',
  },
  {
    clave: 'voluntario',
    correo: 'voluntario.demo@vanguardia.test',
    nombres: 'Voluntario',
    apellidos: 'Demo',
    rol: 'voluntario',
  },
  {
    clave: 'coordinador',
    correo: 'coordinador.demo@vanguardia.test',
    nombres: 'Coordinador',
    apellidos: 'Demo',
    rol: 'coordinador',
  },
  {
    clave: 'admin',
    correo: 'admin.demo@vanguardia.test',
    nombres: 'Administrador',
    apellidos: 'Demo',
    rol: 'administrador',
  },
];

/** Un niño ficticio por solicitud (cada niño tiene una sola solicitud abierta). */
const CASOS = [
  {
    familia: 'familia1',
    nombres: 'Ana Demo',
    materno: 'Ficticia',
    nacimiento: '2017-03-14',
    sexo: 'femenino',
    municipio: '0801',
    estado: E.BORRADOR,
  },
  {
    familia: 'familia1',
    nombres: 'Luis Demo',
    materno: 'Ficticio',
    nacimiento: '2015-08-02',
    sexo: 'masculino',
    municipio: '0801',
    estado: E.CAPTURA,
    modalidad: 'fotos',
    voluntario: true,
  },
  {
    familia: 'familia2',
    nombres: 'Sofía Demo',
    materno: 'Ficticia',
    nacimiento: '2019-11-21',
    sexo: 'femenino',
    municipio: '0501',
    estado: E.EN_REVISION,
    voluntario: true,
  },
  {
    familia: 'familia2',
    nombres: 'Mateo Demo',
    materno: 'Ficticio',
    nacimiento: '2012-05-30',
    sexo: 'masculino',
    municipio: '0501',
    estado: E.EN_EVALUACION,
  },
  {
    familia: 'familia3',
    nombres: 'Valeria Demo',
    materno: 'Ficticia',
    nacimiento: '2016-01-09',
    sexo: 'femenino',
    municipio: '0601',
    estado: E.DERIVADA_HN,
    ruta: 'HONDURAS',
  },
  {
    familia: 'familia3',
    nombres: 'Diego Demo',
    materno: 'Ficticio',
    nacimiento: '2014-07-17',
    sexo: 'masculino',
    municipio: '1801',
    estado: E.ENVIADA,
    ruta: 'INTERNACIONAL',
  },
];

/** Recorrido de estados hasta el estado del caso (para historial_estados). */
const RECORRIDOS = {
  [E.BORRADOR]: [E.BORRADOR],
  [E.CAPTURA]: [E.BORRADOR, E.CAPTURA],
  [E.EN_REVISION]: [E.BORRADOR, E.CAPTURA, E.EN_REVISION],
  [E.EN_EVALUACION]: [E.BORRADOR, E.CAPTURA, E.EN_REVISION, E.EN_EVALUACION],
  [E.DERIVADA_HN]: [E.BORRADOR, E.CAPTURA, E.EN_REVISION, E.EN_EVALUACION, E.DERIVADA_HN],
  [E.ENVIADA]: [
    E.BORRADOR,
    E.CAPTURA,
    E.EN_REVISION,
    E.EN_EVALUACION,
    E.PAQUETE_EXTERIOR,
    E.EN_REVISION,
    E.COMPLETA,
    E.ENVIADA,
  ],
};

const PROVEEDORES = [
  {
    nombre: 'Clínica Demo Tegucigalpa',
    tipo: 'clinica',
    departamento: '08',
    municipio: '0801',
    especialidades: ['ortopedia_pediatrica'],
  },
  {
    nombre: 'Hospital Demo San Pedro Sula',
    tipo: 'hospital_publico',
    departamento: '05',
    municipio: '0501',
    especialidades: ['ortopedia_pediatrica', 'cirugia_plastica'],
  },
  {
    nombre: 'Jornada Médica Demo Choluteca',
    tipo: 'jornada_medica',
    departamento: '06',
    municipio: '0601',
    especialidades: ['medicina_fisica_rehabilitacion', 'ortopedia_pediatrica'],
  },
];

const fechaIso = (fecha) => fecha.toISOString().slice(0, 10);

/**
 * Carga los datos de demostración.
 * @param {{ queryInterface: import('sequelize').QueryInterface, transaction: import('sequelize').Transaction, contrasena?: string }} p
 * @returns {Promise<{ creado: boolean }>}
 */
async function sembrarDemo({ queryInterface, transaction, contrasena }) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Los datos de demostración no se cargan en producción');
  }
  if (!contrasena || contrasena.length < 10) {
    throw new Error(
      'Define SEED_DEMO_CONTRASENA (al menos 10 caracteres) para los usuarios de demostración',
    );
  }
  const s = queryInterface.sequelize;
  const consultar = (sql, replacements) =>
    s.query(sql, { replacements, transaction, type: 'SELECT' });
  const insertar = (tabla, filas) => queryInterface.bulkInsert(tabla, filas, { transaction });

  const [existe] = await consultar('SELECT 1 AS uno FROM usuarios WHERE lower(correo) = :correo', {
    correo: CORREO_CONTROL,
  });
  if (existe) return { creado: false };

  const roles = new Map(
    (await consultar('SELECT id, codigo FROM roles')).map((r) => [r.codigo, r.id]),
  );
  const hash = await argon2.hash(contrasena, { type: argon2.argon2id });
  const ahora = new Date();

  const usuarios = {};
  await insertar(
    'usuarios',
    USUARIOS.map((u) => {
      usuarios[u.clave] = randomUUID();
      return {
        id: usuarios[u.clave],
        correo: u.correo,
        hash_contrasena: hash,
        nombres: u.nombres,
        apellidos: u.apellidos,
        telefono: '+50400000000',
        idioma: 'es',
        estado: 'activo',
        rol_id: roles.get(u.rol),
        terminos_version: 'demo',
        terminos_aceptados_en: ahora,
        correo_verificado_en: ahora,
      };
    }),
  );

  const tutores = {};
  await insertar(
    'tutores',
    USUARIOS.filter((u) => u.rol === 'familia').map((u) => {
      tutores[u.clave] = randomUUID();
      return {
        id: tutores[u.clave],
        usuario_id: usuarios[u.clave],
        nombres: u.nombres,
        apellidos: u.apellidos,
        parentesco: 'madre',
        telefono: '+50400000000',
        correo: u.correo,
      };
    }),
  );

  const proveedores = PROVEEDORES.map((p) => ({
    id: randomUUID(),
    nombre: p.nombre,
    tipo: p.tipo,
    departamento_codigo: p.departamento,
    municipio_codigo: p.municipio,
    especialidades: s.literal(
      `ARRAY[${p.especialidades.map((e) => s.escape(e)).join(', ')}]::text[]`,
    ),
    contacto: JSON.stringify({ telefono: '+504 0000-0000', correo: 'proveedor@vanguardia.test' }),
    activo: true,
    notas: 'Proveedor ficticio de demostración',
  }));
  await insertar('proveedores_locales', proveedores);

  for (const caso of CASOS) {
    const pacienteId = randomUUID();
    await insertar('pacientes', [
      {
        id: pacienteId,
        nombres: caso.nombres,
        apellido_paterno: 'Prueba',
        apellido_materno: caso.materno,
        fecha_nacimiento: caso.nacimiento,
        sexo: caso.sexo,
        municipio_codigo: caso.municipio,
        direccion: 'Dirección ficticia de demostración',
        creado_por: usuarios[caso.familia],
      },
    ]);
    await insertar('paciente_tutor', [
      {
        paciente_id: pacienteId,
        tutor_id: tutores[caso.familia],
        es_responsable_legal: true,
        confirmado_en: ahora,
        confirmado_por: usuarios[caso.familia],
      },
    ]);

    const [{ n }] = await consultar("SELECT nextval('solicitud_codigo_seq') AS n");
    const recorrido = RECORRIDOS[caso.estado];
    const inicio = ahora.getTime() - recorrido.length * DIA_MS;
    const momento = (i) => new Date(inicio + i * DIA_MS);
    const etapaFinal = caso.ruta === 'INTERNACIONAL' ? 'paquete' : 'evaluacion';
    const solicitudId = randomUUID();
    const enviada = recorrido.indexOf(E.EN_REVISION);

    await insertar('solicitudes', [
      {
        id: solicitudId,
        codigo: `HN-${String(n).padStart(4, '0')}`,
        paciente_id: pacienteId,
        modalidad: caso.estado === E.BORRADOR ? null : (caso.modalidad ?? 'app'),
        estado: caso.estado,
        etapa: etapaFinal,
        ruta_sugerida: caso.ruta ? 'POR_EVALUAR' : null,
        ruta_decidida: caso.ruta ?? null,
        paquete: caso.ruta === 'INTERNACIONAL' ? 'INTERNACIONAL' : null,
        faltantes_al_enviar: JSON.stringify([]),
        enviada_en: enviada >= 0 ? momento(enviada) : null,
        coordinador_id: enviada >= 0 ? usuarios.coordinador : null,
        creada_por: usuarios[caso.familia],
        ultimo_cambio_estado: momento(recorrido.length - 1),
      },
    ]);

    await insertar(
      'historial_estados',
      recorrido.map((estado, i) => ({
        id: randomUUID(),
        solicitud_id: solicitudId,
        estado_anterior: i === 0 ? null : recorrido[i - 1],
        estado_nuevo: estado,
        etapa:
          i > recorrido.indexOf(E.PAQUETE_EXTERIOR) && caso.ruta === 'INTERNACIONAL'
            ? 'paquete'
            : 'evaluacion',
        usuario_id: [E.BORRADOR, E.CAPTURA, E.EN_REVISION].includes(estado)
          ? usuarios[caso.familia]
          : usuarios.coordinador,
        nota: 'Historial de demostración',
        created_at: momento(i),
      })),
    );

    if (caso.voluntario) {
      await insertar('asignaciones', [
        {
          id: randomUUID(),
          solicitud_id: solicitudId,
          voluntario_id: usuarios.voluntario,
          estado: caso.estado === E.CAPTURA ? 'pendiente_captura' : 'en_revision',
          activa: true,
          asignado_por: usuarios.coordinador,
        },
      ]);
    }

    if (caso.ruta) {
      await insertar('evaluaciones', [
        {
          id: randomUUID(),
          solicitud_id: solicitudId,
          ruta_sugerida: 'POR_EVALUAR',
          motivos: JSON.stringify([]),
          hechos: JSON.stringify({}),
          version_reglas: 1,
          ruta_decidida: caso.ruta,
          justificacion: 'Justificación ficticia de demostración, sin valor clínico.',
          evaluador_nombre: 'Médico Evaluador Demo',
          evaluador_cargo: 'Cargo de demostración',
          tipo_dictamen: 'medico_evaluador',
          fecha_dictamen: fechaIso(momento(recorrido.indexOf(E.EN_EVALUACION))),
          registrado_por: usuarios.coordinador,
          vigente: true,
        },
      ]);
    }

    if (caso.estado === E.DERIVADA_HN) {
      await insertar('derivaciones_locales', [
        {
          id: randomUUID(),
          solicitud_id: solicitudId,
          proveedor_id: proveedores[2].id,
          especialidad: 'ortopedia_pediatrica',
          fecha_cita: fechaIso(new Date(ahora.getTime() + 14 * DIA_MS)),
          hora_cita: '09:00',
          estado: 'programada',
          observaciones: 'Cita ficticia de demostración',
          registrado_por: usuarios.coordinador,
        },
      ]);
    }
  }

  return { creado: true };
}

module.exports = { sembrarDemo, CORREO_CONTROL, USUARIOS, CASOS };
