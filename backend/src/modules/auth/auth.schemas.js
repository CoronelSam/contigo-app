'use strict';

// Esquemas Zod de entrada y salida del módulo auth (también documentan OpenAPI).

const { z } = require('../../openapi/zod');
const { LISTA_ROLES } = require('../../core/estados/constantes');

/** "+504 9999-0000", "9999 0000" o "50499990000" → "+50499990000". */
function normalizarTelefono(valor) {
  const limpio = valor.replace(/[\s().-]/g, '');
  if (/^\d{8}$/.test(limpio)) return `+504${limpio}`;
  if (/^504\d{8}$/.test(limpio)) return `+${limpio}`;
  return limpio;
}

const correo = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email())
  .openapi({ example: 'familia@ejemplo.test' });
const contrasenaNueva = z.string().min(10).max(128).openapi({ example: 'una-contrasena-larga' });
const telefono = z
  .string()
  .trim()
  .transform(normalizarTelefono)
  .refine((v) => /^\+504\d{8}$/.test(v), { params: { codigo: 'TELEFONO_INVALIDO' } })
  .openapi({ example: '+50499990000', description: 'Honduras: +504 y 8 dígitos (se normaliza)' });
const texto = (max) => z.string().trim().min(1).max(max);
const idioma = z.enum(['es', 'en']);
const token = z.string().trim().min(20).max(200);

const registro = z
  .strictObject({
    nombres: texto(120),
    apellidos: texto(120),
    telefono,
    correo,
    contrasena: contrasenaNueva,
    idioma: idioma.default('es'),
    aceptaTerminos: z.literal(true),
    terminosVersion: texto(20).openapi({ example: '2026-11' }),
  })
  .openapi('Registro');

const login = z
  .strictObject({
    correo,
    contrasena: z.string().min(1).max(128),
    dispositivo: z.string().trim().max(255).optional(),
  })
  .openapi('Login');

const refresh = z.strictObject({ refreshToken: token }).openapi('Refresh');

const logout = z
  .strictObject({ refreshToken: token.optional(), tokenFcm: z.string().trim().max(512).optional() })
  .openapi('Logout');

const olvido = z.strictObject({ correo }).openapi('OlvideContrasena');

const restablecer = z
  .strictObject({ token, contrasena: contrasenaNueva })
  .openapi('RestablecerContrasena');

const verificarCorreo = z.strictObject({ token }).openapi('VerificarCorreo');

const perfilParcial = z
  .strictObject({
    nombres: texto(120).optional(),
    apellidos: texto(120).optional(),
    telefono: telefono.optional(),
    idioma: idioma.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    params: { codigo: 'SIN_CAMBIOS' },
    // Solo si no hubo otros errores (por ejemplo, un campo no permitido).
    when: (p) => p.issues.length === 0,
  })
  .openapi('PerfilCambios');

const cambioContrasena = z
  .strictObject({ actual: z.string().min(1).max(128), nueva: contrasenaNueva })
  .openapi('CambioContrasena');

const CATEGORIAS_PUSH = ['mensajes', 'correcciones', 'estados', 'documentos', 'citas'];
const preferenciasPush = z.strictObject(
  Object.fromEntries(CATEGORIAS_PUSH.map((c) => [c, z.boolean()])),
);

const preferencias = z
  .strictObject({ push: preferenciasPush.partial() })
  .openapi('PreferenciasCambios', { description: 'Las categorías omitidas conservan su valor' });

const dispositivo = z
  .strictObject({
    tokenFcm: z.string().trim().min(10).max(512),
    plataforma: z.enum(['android', 'ios', 'web']),
  })
  .openapi('Dispositivo');

// --- Respuestas

const usuarioSesion = z
  .object({
    id: z.uuid(),
    nombres: z.string(),
    apellidos: z.string(),
    rol: z.enum(LISTA_ROLES),
    permisos: z.array(z.string()),
    idioma,
    correoVerificado: z.boolean(),
  })
  .openapi('UsuarioSesion');

const sesion = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiraEn: z.string().openapi({ description: 'Vencimiento del token de acceso (ISO 8601)' }),
    usuario: usuarioSesion,
  })
  .openapi('Sesion');

const perfil = z
  .object({
    id: z.uuid(),
    correo: z.string(),
    nombres: z.string(),
    apellidos: z.string(),
    telefono: z.string().nullable(),
    idioma,
    rol: z.enum(LISTA_ROLES),
    permisos: z.array(z.string()),
    correoVerificado: z.boolean(),
    terminosVersion: z.string().nullable(),
    creadoEn: z.string(),
  })
  .openapi('Perfil');

const preferenciasRespuesta = z.object({ push: preferenciasPush }).openapi('Preferencias');

const mensaje = z.object({ mensaje: z.string() }).openapi('Mensaje');

module.exports = {
  normalizarTelefono,
  CATEGORIAS_PUSH,
  entrada: {
    registro,
    login,
    refresh,
    logout,
    olvido,
    restablecer,
    verificarCorreo,
    perfilParcial,
    cambioContrasena,
    preferencias,
    dispositivo,
  },
  salida: { sesion, perfil, preferencias: preferenciasRespuesta, mensaje },
};
