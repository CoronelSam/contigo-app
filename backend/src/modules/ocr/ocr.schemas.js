'use strict';

// Esquemas Zod del módulo OCR (entrada y salida; también documentan OpenAPI).

const { z } = require('../../openapi/zod');

const uuid = z.uuid();
const fechaHora = z.string().openapi({ format: 'date-time' });

// --- Entrada

const paramsExtraccion = z.object({ id: uuid });
const paramsCampo = z.object({ id: uuid, campoId: uuid });

const revisarCampo = z
  .strictObject({
    valor: z
      .union([z.string().max(2000), z.number(), z.boolean(), z.null()])
      .optional()
      .openapi({
        description:
          'Valor corregido. Fechas en el formato de la zona; casillas `true` o `false`; `null` si ' +
          'el campo está en blanco',
      }),
    confirmar: z.literal(true).optional().openapi({ description: 'Confirma el valor leído' }),
  })
  .refine((v) => 'valor' in v !== 'confirmar' in v, {
    params: { codigo: 'VALOR_O_CONFIRMAR' },
    when: (p) => p.issues.length === 0,
  })
  .openapi('CampoRevision', { description: 'Envía `valor` o `confirmar: true`, no los dos' });

const confirmarEnBloque = z
  .strictObject({ campoIds: z.array(uuid).min(1).max(500) })
  .openapi('CamposConfirmar');

// --- Salida

const campo = z
  .object({
    id: uuid,
    campo: z.string(),
    seccion: z.string().nullable(),
    rutaDato: z.string().nullable(),
    tipo: z.enum(['texto', 'fecha', 'numero', 'casilla', 'opcion']),
    valorLeido: z.string().nullable(),
    confianza: z.number().nullable(),
    dudoso: z.boolean().openapi({ description: 'Confianza menor a `ocr.umbral_confianza`' }),
    pagina: z.number().int().nullable(),
    coordenadas: z
      .object({ x: z.number(), y: z.number(), ancho: z.number(), alto: z.number() })
      .nullable()
      .openapi({ description: 'Caja normalizada (0 a 1) para recortar la zona de la imagen' }),
    grupo: z.string().nullable(),
    valorCasilla: z.union([z.string(), z.number()]).nullable(),
    opciones: z.array(z.string()).nullable(),
    formato: z.string().nullable(),
    valorFinal: z.string().nullable(),
    estado: z.enum(['propuesto', 'confirmado', 'corregido']),
    revisadoEn: fechaHora.nullable(),
  })
  .openapi('CampoExtraido');

const extraccion = z
  .object({
    id: uuid,
    documentoId: uuid,
    estado: z.enum([
      'en_cola',
      'procesando',
      'por_confirmar',
      'confirmada',
      'fallida',
      'cancelada',
    ]),
    progreso: z.number().int(),
    confianzaPromedio: z.number().nullable(),
    umbralConfianza: z.number(),
    error: z.string().nullable(),
    revisadoEn: fechaHora.nullable(),
    paginas: z.array(z.object({ numero: z.number().int(), archivoId: uuid })),
    campos: z.array(campo),
  })
  .openapi('Extraccion');

module.exports = {
  entrada: { paramsExtraccion, paramsCampo, revisarCampo, confirmarEnBloque },
  salida: { campo, extraccion },
};
