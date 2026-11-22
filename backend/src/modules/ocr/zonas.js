'use strict';

// Zonas de OCR de una plantilla (`plantillas_formulario.zonas_ocr`). El agente 11 valida con
// `esquemaZonasOcr` al registrar plantillas. No existe un tipo `firma`: el OCR nunca lee ni
// reproduce firmas.

const { z } = require('../../openapi/zod');
const { CODIGOS_SECCIONES_JSON } = require('../../core/expediente');

const TIPOS = Object.freeze(['texto', 'fecha', 'numero', 'casilla', 'opcion']);
const FORMATOS_FECHA = Object.freeze(['DD/MM/AAAA', 'MM/DD/AAAA', 'AAAA-MM-DD', 'MM/AAAA', 'AAAA']);
const FORMATO_FECHA_POR_DEFECTO = 'DD/MM/AAAA';

const fraccion = z.number().min(0).max(1);

const zona = z
  .strictObject({
    campo: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
    seccion: z.enum(CODIGOS_SECCIONES_JSON),
    rutaDato: z
      .string()
      .regex(/^(\/[A-Za-z0-9_]+)+$/)
      .max(200)
      .openapi({ description: 'JSON Pointer dentro de la sección, por ejemplo `/diagnostico`' }),
    tipo: z.enum(TIPOS),
    pagina: z.number().int().min(1).max(50),
    caja: z
      .strictObject({ x: fraccion, y: fraccion, ancho: fraccion.gt(0), alto: fraccion.gt(0) })
      .refine((c) => c.x + c.ancho <= 1 && c.y + c.alto <= 1, {
        params: { codigo: 'FUERA_DE_LA_PAGINA' },
      })
      .openapi({ description: 'Coordenadas normalizadas de 0 a 1 sobre la página' }),
    grupo: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,59}$/)
      .optional()
      .openapi({ description: 'Casillas excluyentes: solo una marca por grupo' }),
    valor: z
      .union([z.string().min(1).max(100), z.number()])
      .optional()
      .openapi({ description: 'Valor que aporta la casilla marcada (por ejemplo `cesarea`)' }),
    formato: z.enum(FORMATOS_FECHA).optional(),
    opciones: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  })
  .superRefine((v, ctx) => {
    const problema = (path, codigo) => ctx.addIssue({ code: 'custom', path, params: { codigo } });
    if (v.formato && v.tipo !== 'fecha') problema(['formato'], 'SOLO_PARA_FECHAS');
    if (v.opciones && v.tipo !== 'opcion') problema(['opciones'], 'SOLO_PARA_OPCIONES');
    if ((v.grupo || v.valor !== undefined) && v.tipo !== 'casilla') {
      problema([v.grupo ? 'grupo' : 'valor'], 'SOLO_PARA_CASILLAS');
    }
    if (v.grupo && v.valor === undefined) problema(['valor'], 'REQUERIDO');
  });

/** Formato de `plantillas_formulario.zonas_ocr`. */
const esquemaZonasOcr = z
  .array(zona)
  .max(500)
  .superRefine((zonas, ctx) => {
    const vistos = new Set();
    const grupos = new Map();
    zonas.forEach((zn, i) => {
      if (vistos.has(zn.campo)) {
        ctx.addIssue({ code: 'custom', path: [i, 'campo'], params: { codigo: 'REPETIDO' } });
      }
      vistos.add(zn.campo);
      if (!zn.grupo) return;
      const destino = `${zn.seccion}${zn.rutaDato}`;
      if (!grupos.has(zn.grupo)) grupos.set(zn.grupo, destino);
      else if (grupos.get(zn.grupo) !== destino) {
        // Las casillas de un grupo responden la misma pregunta: van al mismo dato.
        ctx.addIssue({
          code: 'custom',
          path: [i, 'rutaDato'],
          params: { codigo: 'GRUPO_MEZCLADO' },
        });
      }
    });
  })
  .openapi('ZonasOcr');

/**
 * Zona de cada campo de una extracción: la copia guardada al procesar o, si no hay (extracciones
 * antiguas o de prueba), lo que dice el propio campo.
 * @param {object} extraccion
 * @param {object} campo
 */
function zonaDe(extraccion, campo) {
  const guardadas = extraccion.respuestaCruda?.zonas ?? [];
  return (
    guardadas.find((zn) => zn.campo === campo.campo) ?? {
      campo: campo.campo,
      seccion: campo.seccion,
      rutaDato: campo.rutaDato,
      tipo: campo.tipo,
      pagina: campo.pagina,
    }
  );
}

module.exports = {
  TIPOS,
  FORMATOS_FECHA,
  FORMATO_FECHA_POR_DEFECTO,
  esquemaZonasOcr,
  zonaDe,
};
