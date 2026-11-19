'use strict';

// Las migraciones copian los valores permitidos en sus CHECK. Esta prueba garantiza que la base,
// los modelos (VALORES) y las constantes de core/estados sigan diciendo lo mismo.

const db = require('../../src/models');
const C = require('../../src/core/estados/constantes');

const NOMBRES_MODELOS = Object.keys(db).filter(
  (k) => !['sequelize', 'Sequelize', 'DataTypes'].includes(k),
);

async function checksDeLaBase() {
  const filas = await db.sequelize.query(
    `SELECT conname AS nombre, pg_get_constraintdef(oid) AS definicion
       FROM pg_constraint
      WHERE contype = 'c' AND connamespace = 'public'::regnamespace`,
    { type: db.sequelize.QueryTypes.SELECT },
  );
  return new Map(filas.map((f) => [f.nombre, f.definicion]));
}

const valoresDe = (definicion) => [...definicion.matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();

describe('listas cerradas: base, modelos y constantes', () => {
  test('cada columna con VALORES tiene un CHECK con exactamente esos valores', async () => {
    const checks = await checksDeLaBase();
    let revisadas = 0;
    for (const nombre of NOMBRES_MODELOS) {
      const modelo = db[nombre];
      for (const [atributo, valores] of Object.entries(modelo.VALORES ?? {})) {
        const columna = modelo.rawAttributes[atributo].field;
        const restriccion = `${modelo.getTableName()}_${columna}_check`;
        expect({ restriccion, existe: checks.has(restriccion) }).toEqual({
          restriccion,
          existe: true,
        });
        expect({ restriccion, valores: valoresDe(checks.get(restriccion)) }).toEqual({
          restriccion,
          valores: [...valores].sort(),
        });
        revisadas += 1;
      }
    }
    expect(revisadas).toBeGreaterThan(50);
  });

  test('ningún CHECK de lista queda sin su VALORES en el modelo', async () => {
    const checks = await checksDeLaBase();
    const esperados = new Set();
    for (const nombre of NOMBRES_MODELOS) {
      const modelo = db[nombre];
      for (const atributo of Object.keys(modelo.VALORES ?? {})) {
        esperados.add(`${modelo.getTableName()}_${modelo.rawAttributes[atributo].field}_check`);
      }
    }
    const deLista = [...checks.keys()].filter((n) => /_check$/.test(n) && !/_check_\d+$/.test(n));
    expect(deLista.filter((n) => !esperados.has(n))).toEqual([]);
  });

  test('los modelos usan las constantes compartidas', () => {
    expect(db.Solicitud.VALORES.estado).toBe(C.LISTA_ESTADOS_SOLICITUD);
    expect(db.Solicitud.VALORES.etapa).toBe(C.LISTA_ETAPAS);
    expect(db.Solicitud.VALORES.rutaDecidida).toBe(C.LISTA_RUTAS);
    expect(db.Solicitud.VALORES.rutaSugerida).toBe(C.LISTA_RUTAS_SUGERIDAS);
    expect(db.Documento.VALORES.estado).toBe(C.LISTA_ESTADOS_DOCUMENTO);
    expect(db.RequisitoRuta.VALORES.ruta).toBe(C.LISTA_RUTAS_REQUISITO);
    expect(db.Rol.VALORES.codigo).toBe(C.LISTA_ROLES);
    expect(C.LISTA_ESTADOS_SOLICITUD).toHaveLength(12);
  });
});
