'use strict';

// Carga de los datos base. La usan los seeders de src/db/seeders y limpiarBase() en las pruebas.
// Cada función es idempotente (ON CONFLICT DO NOTHING) y recibe { queryInterface, transaction }.
// Solo usa queryInterface (no los modelos) para no depender de la configuración de la app.

const fs = require('node:fs');
const path = require('node:path');

const DATOS = path.resolve(__dirname, '..', 'seeders', 'data');

const leerJson = (archivo) => JSON.parse(fs.readFileSync(path.join(DATOS, archivo), 'utf8'));

function leerCsv(archivo) {
  const [encabezado, ...lineas] = fs
    .readFileSync(path.join(DATOS, archivo), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const columnas = encabezado.split(',');
  return lineas.map((linea) => {
    const valores = linea.split(',');
    return Object.fromEntries(columnas.map((c, i) => [c, valores[i]]));
  });
}

const PERMISOS = leerJson('permisos.json');
const CATALOGOS = leerJson('catalogos.json');
const REQUISITOS = leerJson('requisitos.json');
const CONFIGURACION = leerJson('configuracion.json');
const REGLAS = leerJson('reglas-ruta.json');

const TIPOS_CONSENTIMIENTO = Object.freeze({
  divulgacion_informacion_medica: {
    es: 'Autorización para divulgar información médica',
    en: 'Authorization to release medical information',
  },
  marketing: {
    es: 'Uso de fotografías e historias con fines de difusión',
    en: 'Use of photos and stories for outreach',
  },
  telesalud: { es: 'Consentimiento para atención por telesalud', en: 'Telehealth consent' },
  condiciones_atencion: { es: 'Condiciones de la atención', en: 'Conditions of treatment' },
});

const CUERPO_DE_PRUEBA = {
  es: 'TEXTO DE PRUEBA — reemplazar por el texto legal aprobado.',
  en: 'TEST TEXT — replace with the approved legal text.',
};

/** Arreglo de texto de PostgreSQL (`text[]`) como literal seguro. */
function arregloTexto(queryInterface, valores = []) {
  const s = queryInterface.sequelize;
  return s.literal(`ARRAY[${valores.map((v) => s.escape(v)).join(', ')}]::text[]`);
}

async function insertar(queryInterface, transaction, tabla, filas) {
  if (!filas.length) return;
  await queryInterface.bulkInsert(tabla, filas, { transaction, ignoreDuplicates: true });
}

async function idsPorCodigo(queryInterface, transaction, tabla) {
  const [filas] = await queryInterface.sequelize.query(`SELECT id, codigo FROM ${tabla}`, {
    transaction,
  });
  return new Map(filas.map((f) => [f.codigo, f.id]));
}

/** Roles fijos, permisos y su relación. */
async function sembrarRolesYPermisos({ queryInterface, transaction }) {
  await insertar(
    queryInterface,
    transaction,
    'roles',
    PERMISOS.roles.map((r) => ({
      codigo: r.codigo,
      nombre_es: r.nombre_es,
      nombre_en: r.nombre_en,
      descripcion: r.descripcion,
    })),
  );
  await insertar(
    queryInterface,
    transaction,
    'permisos',
    PERMISOS.permisos.map((p) => ({ codigo: p.codigo, descripcion: p.descripcion })),
  );
  const roles = await idsPorCodigo(queryInterface, transaction, 'roles');
  const permisos = await idsPorCodigo(queryInterface, transaction, 'permisos');
  await insertar(
    queryInterface,
    transaction,
    'rol_permiso',
    PERMISOS.permisos.flatMap((p) =>
      p.roles.map((rol) => ({ rol_id: roles.get(rol), permiso_id: permisos.get(p.codigo) })),
    ),
  );
}

/** 18 departamentos y 298 municipios con código oficial. */
async function sembrarDepartamentosYMunicipios({ queryInterface, transaction }) {
  await insertar(queryInterface, transaction, 'departamentos', leerCsv('departamentos.csv'));
  await insertar(queryInterface, transaction, 'municipios', leerCsv('municipios.csv'));
}

/** Catálogos bilingües (parentesco, tipos de atención, condiciones, etc.). */
async function sembrarCatalogos({ queryInterface, transaction }) {
  const filas = [];
  for (const [tipo, items] of Object.entries(CATALOGOS)) {
    if (tipo.startsWith('_')) continue;
    items.forEach((item, i) =>
      filas.push({
        tipo,
        codigo: item.codigo,
        etiqueta_es: item.es,
        etiqueta_en: item.en,
        orden: (i + 1) * 10,
        activo: true,
        metadatos: JSON.stringify(item.metadatos ?? {}),
      }),
    );
  }
  await insertar(queryInterface, transaction, 'catalogos_items', filas);
}

/** Tipos de documento y requisitos por ruta (sin las entradas "por confirmar"). */
async function sembrarTiposYRequisitos({ queryInterface, transaction }) {
  await insertar(
    queryInterface,
    transaction,
    'tipos_documento',
    REQUISITOS.tipos.map((t) => ({
      codigo: t.codigo,
      categoria: t.categoria,
      nombre_es: t.nombre_es,
      nombre_en: t.nombre_en,
      para_que_sirve_es: t.para_que_sirve_es,
      para_que_sirve_en: t.para_que_sirve_en,
      como_fotografiar_es: t.como_fotografiar_es,
      como_fotografiar_en: t.como_fotografiar_en,
      admite_varias_paginas: t.admite_varias_paginas,
    })),
  );
  const tipos = await idsPorCodigo(queryInterface, transaction, 'tipos_documento');
  const filas = [];
  for (const [ruta, requisitos] of Object.entries(REQUISITOS.requisitos)) {
    requisitos
      .filter((r) => !r.por_confirmar)
      .forEach((r, i) => {
        const tipoDocumentoId = tipos.get(r.tipo);
        if (!tipoDocumentoId) throw new Error(`Requisito ${ruta} con tipo desconocido: ${r.tipo}`);
        filas.push({
          ruta,
          tipo_documento_id: tipoDocumentoId,
          obligatorio: r.obligatorio,
          orden: (i + 1) * 10,
          cubierto_por_secciones: arregloTexto(queryInterface, r.cubierto_por_secciones),
          activo: true,
        });
      });
  }
  await insertar(queryInterface, transaction, 'requisitos_ruta', filas);
}

/** Textos de consentimiento de prueba, versión 1, en es y en. */
async function sembrarTextosConsentimiento({ queryInterface, transaction }) {
  const filas = Object.entries(TIPOS_CONSENTIMIENTO).flatMap(([tipo, titulos]) =>
    ['es', 'en'].map((idioma) => ({
      tipo,
      version: 1,
      idioma,
      titulo: titulos[idioma],
      cuerpo: CUERPO_DE_PRUEBA[idioma],
    })),
  );
  await insertar(queryInterface, transaction, 'textos_consentimiento', filas);
}

/** Configuración base (contactos de prueba, decisiones pendientes con su valor seguro). */
async function sembrarConfiguracion({ queryInterface, transaction }) {
  await insertar(
    queryInterface,
    transaction,
    'configuracion',
    Object.entries(CONFIGURACION).map(([clave, c]) => ({
      clave,
      valor: JSON.stringify(c.valor),
      descripcion: c.descripcion,
    })),
  );
}

/** Reglas de ruta de ejemplo (versión 1, activa). */
async function sembrarReglasRuta({ queryInterface, transaction }) {
  await insertar(
    queryInterface,
    transaction,
    'reglas_ruta',
    REGLAS.reglas.map((r) => ({
      version: REGLAS.version,
      prioridad: r.prioridad,
      nombre: r.nombre,
      condicion: JSON.stringify(r.condicion),
      ruta_sugerida: r.ruta_sugerida,
      motivo_es: r.motivo_es,
      motivo_en: r.motivo_en,
      activa: true,
    })),
  );
}

/** Datos base que las pruebas pueden modificar y que limpiarBase() vuelve a cargar. */
async function sembrarDatosEditables(opciones) {
  await sembrarCatalogos(opciones);
  await sembrarTiposYRequisitos(opciones);
  await sembrarTextosConsentimiento(opciones);
  await sembrarConfiguracion(opciones);
  await sembrarReglasRuta(opciones);
}

module.exports = {
  PERMISOS,
  CATALOGOS,
  REQUISITOS,
  CONFIGURACION,
  REGLAS,
  TIPOS_CONSENTIMIENTO,
  leerCsv,
  sembrarRolesYPermisos,
  sembrarDepartamentosYMunicipios,
  sembrarCatalogos,
  sembrarTiposYRequisitos,
  sembrarTextosConsentimiento,
  sembrarConfiguracion,
  sembrarReglasRuta,
  sembrarDatosEditables,
};
