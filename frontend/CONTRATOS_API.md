# Rutas API verificadas en el ZIP recibido

Fuente: rutas y esquemas existentes del backend del compañero. Base URL `/api/v1`.

| UI | Método/ruta | Campos enviados o respuesta relevante |
| -- | -- | -- |
| 03 | POST `/auth/login` | `correo`, `contrasena`, `dispositivo` opcional → `accessToken`, `refreshToken`, `usuario.rol` |
| 04 | POST `/auth/register` | `nombres`, `apellidos`, `telefono`, `correo`, `contrasena`, `idioma`, `aceptaTerminos`, `terminosVersion` |
| 05 | POST `/auth/password/forgot` | `correo` |
| Sesión | POST `/auth/refresh` | `refreshToken` |
| 06 | GET `/me` | perfil del usuario |
| 06 | PATCH `/me/password` | `actual`, `nueva` |
| 06 | POST `/auth/logout` | `refreshToken` opcional; requiere access token |
| 07 | GET `/me/resumen` | `contadores`, `ninos` |
| 08 | GET `/pacientes` | `{datos: [...], paginacion: {...}}` |
| 09 | POST `/pacientes` | `nombres`, `apellidoPaterno`, `apellidoMaterno`, `fechaNacimiento`, `sexo`, `departamentoCodigo`, `municipioCodigo`, `direccion` |
| 09 | GET `/catalogos/departamentos` | Lista `codigo`, `nombre` |
| 09 | GET `/catalogos/departamentos/:id/municipios` | Lista `codigo`, `nombre` |
| 10 | GET `/catalogos/parentesco` | Lista `codigo`, `etiqueta` |
| 10 | POST `/pacientes/:id/tutores` | `nombres`, `apellidos`, `parentesco`, `telefono`, `correo`, `direccion`, `esLaCuentaActual`, `esResponsableLegal`, `confirmoResponsableLegal` |
| 11 | POST `/solicitudes` | `pacienteId` UUID |
| 12 | PUT `/solicitudes/:id/modalidad` | `modalidad`: `app` o `fotos` |

Respuestas de error: `{codigo, mensaje, campos}`. Las rutas autenticadas requieren `Authorization: Bearer <accessToken>`.

**Observación de integración:** el backend de este ZIP sigue identificándose internamente como «vanguardia-backend» y algunos textos de respuesta mencionan Vanguardia. El frontend no lo modifica. Si se cambia esa denominación internamente, coordinar con la persona que mantiene el backend.

**Importante:** el backend incluye MÁS estados que los ocho del prototipo inicial (`EN_EVALUACION`, `PAQUETE_EXTERIOR`, `DERIVADA_HN`, `ATENDIDA_HN`). En etapas posteriores se debe leer el estado real del servidor y mapearlo correctamente, no asumir solo ocho.
