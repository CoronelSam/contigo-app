'use strict';

// Configuración del sistema: solo las claves conocidas de configuracion.claves.js, cada una con
// su esquema. Cada cambio queda en la bitácora con el antes y el después y en `actualizado_por`.

const { registrarBitacora } = require('../../core/auditoria');
const { validacion } = require('../../core/errores');
const { camposDesdeZod } = require('../../core/errores/zod');
const { serializarEstable } = require('../../core/http/idempotencia');
const { CLAVES, LISTA_CLAVES } = require('./configuracion.claves');
const errores = require('./admin.errores');

const modelos = () => require('../../models');

const nombreDe = (u) => `${u.nombres} ${u.apellidos}`.trim();

function formatear(clave, fila, autores) {
  const autor = fila?.actualizadoPor ? autores.get(fila.actualizadoPor) : null;
  return {
    clave,
    valor: fila ? fila.valor : null,
    descripcion: fila?.descripcion ?? null,
    actualizadoPor: autor ? { id: autor.id, nombre: nombreDe(autor) } : null,
    actualizadoEn: fila ? fila.updatedAt.toISOString() : null,
  };
}

async function autoresDe(filas, transaction) {
  const { Usuario } = modelos();
  const ids = [...new Set(filas.map((f) => f?.actualizadoPor).filter(Boolean))];
  if (!ids.length) return new Map();
  const usuarios = await Usuario.findAll({
    where: { id: ids },
    attributes: ['id', 'nombres', 'apellidos'],
    transaction,
  });
  return new Map(usuarios.map((u) => [u.id, u]));
}

/** GET /admin/configuracion: todas las claves conocidas, en orden alfabético. */
async function listar() {
  const { Configuracion } = modelos();
  const filas = await Configuracion.findAll({ where: { clave: LISTA_CLAVES } });
  const porClave = new Map(filas.map((f) => [f.clave, f]));
  const autores = await autoresDe(filas);
  return [...LISTA_CLAVES].sort().map((c) => formatear(c, porClave.get(c), autores));
}

/**
 * PATCH /admin/configuracion/:clave
 * @param {{ id: string }} actor
 * @param {string} clave
 * @param {unknown} valor
 */
async function cambiar(actor, clave, valor) {
  const definicion = Object.hasOwn(CLAVES, clave) ? CLAVES[clave] : null;
  if (!definicion) throw errores.claveNoEncontrada();
  const resultado = definicion.esquema.safeParse(valor);
  if (!resultado.success) {
    throw validacion(camposDesdeZod(resultado.error, { datos: valor, prefijo: 'valor' }));
  }
  const nuevo = resultado.data;

  const { sequelize, Configuracion } = modelos();
  return sequelize.transaction(async (transaction) => {
    let fila = await Configuracion.findByPk(clave, { lock: transaction.LOCK.UPDATE, transaction });
    const antes = fila ? fila.valor : null;
    if (fila && serializarEstable(antes) === serializarEstable(nuevo)) {
      return formatear(clave, fila, await autoresDe([fila], transaction));
    }
    if (fila) {
      await fila.update({ valor: nuevo, actualizadoPor: actor.id }, { transaction });
    } else {
      fila = await Configuracion.create(
        { clave, valor: nuevo, descripcion: definicion.quien, actualizadoPor: actor.id },
        { transaction },
      );
    }
    await registrarBitacora({
      accion: 'configuracion.actualizar',
      entidad: 'configuracion',
      entidadId: clave,
      antes: { valor: antes },
      despues: { valor: nuevo },
      transaction,
    });
    return formatear(clave, fila, await autoresDe([fila], transaction));
  });
}

module.exports = { listar, cambiar };
