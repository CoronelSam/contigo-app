'use strict';

// Plantillas oficiales (55): registro por API (la app no es un editor visual), listado y
// activación. Una versión nueva no modifica los paquetes ya generados: cada paquete guarda su
// PDF y las versiones que usó. Sin borrado: se desactivan.

const { guardarArchivo, detectarTipo } = require('../../core/archivos');
const { registrarBitacora, auditarCambio } = require('../../core/auditoria');
const { AppError, noEncontrado } = require('../../core/errores');
const errores = require('./paquetes.errores');
const pdf = require('./pdf');
const { iso } = require('./paquetes.util');

const modelos = () => require('../../models');

function formatear(p) {
  return {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    version: p.version,
    paquete: p.paquete ?? null,
    metodo: p.metodo,
    archivoPdfId: p.archivoPdfId,
    numeroCampos: Array.isArray(p.mapaCampos) ? p.mapaCampos.length : 0,
    mapaCampos: p.mapaCampos ?? [],
    zonasOcr: p.zonasOcr ?? [],
    orden: p.orden,
    activa: p.activa,
    creadoEn: iso(p.createdAt),
    actualizadoEn: iso(p.updatedAt),
  };
}

/**
 * Compara el mapa de campos y las zonas de OCR con el PDF: con `campo`, cada campo existe y es del
 * tipo correcto (nunca uno de firma); con `coordenadas`, cada página existe.
 * @returns {Record<string, string>} Problemas por ruta del dato (vacío si todo coincide).
 */
function problemasContraPdf({ metodo, mapaCampos, zonasOcr = [] }, info) {
  const campos = {};
  const usados = new Set();
  mapaCampos.forEach((el, i) => {
    const base = `mapaCampos.${i}`;
    if (metodo === 'campo') {
      if (!el.destino) {
        campos[`${base}.destino`] = 'REQUERIDO';
        return;
      }
      const nombre = el.destino.campoPdf;
      const tipo = info.campos.get(nombre);
      const clave = `${base}.destino.campoPdf`;
      if (!tipo) campos[clave] = 'CAMPO_INEXISTENTE';
      else if (tipo === 'firma') campos[clave] = 'CAMPO_DE_FIRMA';
      else if (tipo !== (el.tipo === 'casilla' ? 'casilla' : 'texto')) {
        campos[clave] = 'TIPO_DE_CAMPO_DISTINTO';
      } else if (usados.has(nombre)) campos[clave] = 'REPETIDO';
      usados.add(nombre);
    } else {
      if (!el.destinoCoordenadas) {
        campos[`${base}.destinoCoordenadas`] = 'REQUERIDO';
        return;
      }
      if (el.destinoCoordenadas.pagina > info.paginas) {
        campos[`${base}.destinoCoordenadas.pagina`] = 'PAGINA_INEXISTENTE';
      }
    }
  });
  zonasOcr.forEach((zona, i) => {
    if (zona.pagina > info.paginas) campos[`zonasOcr.${i}.pagina`] = 'PAGINA_INEXISTENTE';
  });
  return campos;
}

/**
 * Registra una plantilla oficial. La versión nueva queda activa y desactiva las demás versiones
 * del mismo código.
 * @param {Buffer | undefined} buffer PDF oficial.
 * @param {object} cuerpo Campos validados del multipart.
 */
async function registrar(buffer, cuerpo) {
  if (!buffer?.length) {
    throw new AppError(400, 'VALIDACION', 'Falta el PDF de la plantilla', { archivo: 'REQUERIDO' });
  }
  if (detectarTipo(buffer)?.mime !== 'application/pdf') {
    throw new AppError(400, 'ARCHIVO_TIPO_NO_PERMITIDO', 'La plantilla debe ser un PDF', {
      archivo: 'TIPO_NO_PERMITIDO',
    });
  }
  let info;
  try {
    info = await pdf.inspeccionar(buffer);
  } catch {
    throw errores.plantillaPdfInvalido();
  }
  const problemas = problemasContraPdf(cuerpo, info);
  if (Object.keys(problemas).length) throw errores.plantillaMapa(problemas);

  const { sequelize, PlantillaFormulario } = modelos();
  try {
    return await sequelize.transaction(async (transaction) => {
      const existe = await PlantillaFormulario.count({
        where: { codigo: cuerpo.codigo, version: cuerpo.version },
        transaction,
      });
      if (existe) throw errores.plantillaVersionExiste();
      const archivo = await guardarArchivo({
        buffer,
        prefijo: 'plantillas',
        tipos: ['application/pdf'],
        transaction,
      });
      const anteriores = await PlantillaFormulario.findAll({
        where: { codigo: cuerpo.codigo, activa: true },
        attributes: ['id'],
        transaction,
      });
      if (anteriores.length) {
        await PlantillaFormulario.update(
          { activa: false },
          { where: { id: anteriores.map((a) => a.id) }, transaction },
        );
      }
      const plantilla = await PlantillaFormulario.create(
        {
          codigo: cuerpo.codigo,
          nombre: cuerpo.nombre,
          version: cuerpo.version,
          paquete: cuerpo.paquete,
          metodo: cuerpo.metodo,
          archivoPdfId: archivo.id,
          mapaCampos: cuerpo.mapaCampos,
          zonasOcr: cuerpo.zonasOcr ?? [],
          orden: cuerpo.orden,
          activa: true,
        },
        { transaction },
      );
      await registrarBitacora({
        accion: 'plantilla.registrar',
        entidad: 'plantillas_formulario',
        entidadId: plantilla.id,
        despues: {
          codigo: plantilla.codigo,
          version: plantilla.version,
          paquete: plantilla.paquete,
          metodo: plantilla.metodo,
          desactivadas: anteriores.map((a) => a.id),
        },
        transaction,
      });
      return formatear(plantilla);
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') throw errores.plantillaVersionExiste();
    throw err;
  }
}

/** Plantillas con filtros, por paquete, orden, código y versión (la más nueva primero). */
async function listar({ paquete, codigo, activa } = {}) {
  const { PlantillaFormulario } = modelos();
  const where = {};
  if (paquete) where.paquete = paquete;
  if (codigo) where.codigo = codigo;
  if (activa !== undefined) where.activa = activa;
  const filas = await PlantillaFormulario.findAll({
    where,
    order: [
      ['paquete', 'ASC'],
      ['orden', 'ASC'],
      ['codigo', 'ASC'],
      ['version', 'DESC'],
    ],
  });
  return filas.map(formatear);
}

/**
 * Activa o desactiva una plantilla, o cambia su nombre u orden. Activar una versión desactiva las
 * demás versiones del mismo código.
 */
async function cambiar(id, cambios) {
  const { sequelize, PlantillaFormulario } = modelos();
  return sequelize.transaction(async (transaction) => {
    const plantilla = await PlantillaFormulario.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!plantilla) throw noEncontrado();
    if (cambios.activa === true && !plantilla.activa) {
      const otras = await PlantillaFormulario.findAll({
        where: { codigo: plantilla.codigo, activa: true },
        transaction,
      });
      for (const otra of otras) {
        await auditarCambio(otra, { activa: false }, { transaction, accion: 'plantilla.cambiar' });
      }
    }
    await auditarCambio(plantilla, cambios, { transaction, accion: 'plantilla.cambiar' });
    return formatear(plantilla);
  });
}

module.exports = { registrar, listar, cambiar, problemasContraPdf };
