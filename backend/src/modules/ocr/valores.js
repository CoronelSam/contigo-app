'use strict';

// Validación y normalización de los valores de un campo de OCR según su tipo y su zona.
// `valor_final` se guarda normalizado: fechas en ISO (AAAA, AAAA-MM o AAAA-MM-DD), números con
// punto decimal y casillas como "true" o "false".

const { FORMATO_FECHA_POR_DEFECTO } = require('./zonas');

/** Partes de una fecha según el formato de la zona. */
const LECTORES = Object.freeze({
  'DD/MM/AAAA': /^(?<d>\d{1,2})\/(?<m>\d{1,2})\/(?<a>\d{4})$/,
  'MM/DD/AAAA': /^(?<m>\d{1,2})\/(?<d>\d{1,2})\/(?<a>\d{4})$/,
  'AAAA-MM-DD': /^(?<a>\d{4})\/(?<m>\d{1,2})\/(?<d>\d{1,2})$/,
  'MM/AAAA': /^(?<m>\d{1,2})\/(?<a>\d{4})$/,
  AAAA: /^(?<a>\d{4})$/,
});

const dos = (n) => String(n).padStart(2, '0');

function fechaIso(texto, formato = FORMATO_FECHA_POR_DEFECTO) {
  // Se aceptan "/", "-" y "." como separadores.
  const limpio = String(texto).trim().replace(/[-.]/g, '/');
  const m = LECTORES[formato]?.exec(limpio);
  if (!m) return null;
  const a = Number(m.groups.a);
  if (a < 1900) return null;
  if (m.groups.m === undefined) return String(a);
  const mes = Number(m.groups.m);
  if (mes < 1 || mes > 12) return null;
  if (m.groups.d === undefined) return `${a}-${dos(mes)}`;
  const dia = Number(m.groups.d);
  const fecha = new Date(Date.UTC(a, mes - 1, dia));
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return `${a}-${dos(mes)}-${dos(dia)}`;
}

function numero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : null;
  const limpio = String(valor).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) return null;
  return String(Number(limpio));
}

function casilla(valor) {
  if (typeof valor === 'boolean') return String(valor);
  const t = String(valor).trim().toLowerCase();
  if (['true', 'si', 'sí', 'x', '1'].includes(t)) return 'true';
  if (['false', 'no', '0', ''].includes(t)) return 'false';
  return null;
}

/**
 * Valida y normaliza un valor.
 * @param {object} zona Zona del campo (tipo, formato, opciones).
 * @param {unknown} valor
 * @returns {{ ok: true, valor: string | null } | { ok: false, codigo: string }}
 */
function normalizarValor(zona, valor) {
  if (zona.tipo === 'casilla') {
    const v = valor === null || valor === undefined ? null : casilla(valor);
    return v === null ? { ok: false, codigo: 'CASILLA_INVALIDA' } : { ok: true, valor: v };
  }
  if (valor === null || valor === undefined || String(valor).trim() === '') {
    return { ok: true, valor: null };
  }
  switch (zona.tipo) {
    case 'fecha': {
      const v = fechaIso(valor, zona.formato);
      return v ? { ok: true, valor: v } : { ok: false, codigo: 'FECHA_INVALIDA' };
    }
    case 'numero': {
      const v = numero(valor);
      return v === null ? { ok: false, codigo: 'NUMERO_INVALIDO' } : { ok: true, valor: v };
    }
    case 'opcion': {
      const v = String(valor).trim();
      if (zona.opciones && !zona.opciones.includes(v)) {
        return { ok: false, codigo: 'VALOR_NO_PERMITIDO' };
      }
      return { ok: true, valor: v };
    }
    default: {
      const v = String(valor).trim();
      return v.length > 2000 ? { ok: false, codigo: 'MUY_LARGO' } : { ok: true, valor: v };
    }
  }
}

/** Valor efectivo del campo: el final si ya se revisó; el leído (normalizado) si no. */
function valorEfectivo(zona, campo) {
  if (campo.estado !== 'propuesto') return campo.valorFinal ?? null;
  const r = normalizarValor(zona, campo.valorLeido);
  return r.ok ? r.valor : null;
}

/** Valor que entra a la sección (tipos de JSON), a partir del valor final. */
function valorParaSeccion(zona, valorFinal) {
  if (valorFinal === null || valorFinal === undefined) return null;
  if (zona.tipo === 'numero') return Number(valorFinal);
  if (zona.tipo === 'casilla') return valorFinal === 'true';
  return valorFinal;
}

module.exports = { fechaIso, normalizarValor, valorEfectivo, valorParaSeccion };
