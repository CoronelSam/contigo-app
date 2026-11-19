# Vanguardia · Backend

API REST y procesos en segundo plano de Vanguardia: reúne la información médica y los documentos de cada niño, sugiere una ruta de atención (Honduras, Hospital Shriners México o programa internacional en Tampa), registra la decisión y da seguimiento al caso.

Node.js 24 · Express 5 · PostgreSQL 17 o superior + Sequelize 6 · pg-boss · almacenamiento en disco (desarrollo) o Cloudflare R2 (servidores) · Zod + OpenAPI 3.1 · Jest.

## Requisitos

- Node.js 24 (ver `.node-version`).
- pnpm (la versión exacta está en `packageManager` de `package.json`). **No uses npm ni yarn.**
- PostgreSQL 17 o superior corriendo en local. Con Homebrew: `brew install postgresql@18` y `brew services start postgresql@18`.

El desarrollo local no usa Docker ni servicios externos: los archivos se guardan en `tmp/almacenamiento`, la cola usa la misma base de datos y el correo y el push son simulados.

## Arranque rápido

```bash
pnpm install
cp .env.example .env
pnpm db:crear
pnpm db:migrate
pnpm dev
```

`curl localhost:3000/health` debe responder `200` con `"estado": "operativo"`. En otra terminal, `pnpm worker` procesa los trabajos en cola.

`pnpm db:crear` crea en tu PostgreSQL el rol `vanguardia` y las bases `vanguardia` y `vanguardia_test` (se puede correr varias veces). Usa tu usuario del sistema como administrador; si no es superusuario, define `ADMIN_DATABASE_URL`.

| Pieza         | En desarrollo                                                                             | En servidores                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Base de datos | PostgreSQL local                                                                          | PostgreSQL 17 o superior                                                                                 |
| Archivos      | Carpeta `tmp/almacenamiento`; la API sirve las URL firmadas en `/archivos-locales/…`      | Bucket privado de Cloudflare R2 por su API S3 (`ALMACENAMIENTO_PROVEEDOR=s3`, obligatorio en producción) |
| Cola          | pg-boss en la misma base                                                                  | Igual                                                                                                    |
| Correo        | Simulado. Opcional: `brew install mailpit` y `CORREO_PROVEEDOR=smtp` con `localhost:1025` | Proveedor SMTP transaccional                                                                             |
| Push          | Simulado                                                                                  | Firebase Cloud Messaging                                                                                 |

Para probar desde un teléfono o emulador, ajusta `API_URL_PUBLICA` (por ejemplo `http://10.0.2.2:3000` en el emulador de Android): con ella se arman las URL firmadas de los archivos.

## Scripts

| Script                                                                  | Qué hace                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                              | API con recarga automática                                                                                            |
| `pnpm start`                                                            | API sin recarga                                                                                                       |
| `pnpm worker`                                                           | Proceso de trabajos en cola (OCR, paquete PDF, push, correo)                                                          |
| `pnpm test` / `pnpm test:watch`                                         | Pruebas con Jest contra `vanguardia_test` (se reinicia y migra en cada corrida)                                       |
| `pnpm lint` / `pnpm format` / `pnpm format:check`                       | ESLint y Prettier                                                                                                     |
| `pnpm db:crear`                                                         | Crea el rol y las bases locales si no existen                                                                         |
| `pnpm db:migrate` / `pnpm db:migrate:undo` / `pnpm db:migrate:undo:all` | Migraciones con sequelize-cli                                                                                         |
| `pnpm db:seed`                                                          | Seeders base (roles, permisos, municipios, catálogos, requisitos, configuración)                                      |
| `pnpm db:seed:demo`                                                     | Datos de demostración ficticios (`*.demo@vanguardia.test`, contraseña de `SEED_DEMO_CONTRASENA`); nunca en producción |
| `pnpm db:reset`                                                         | Borra la base local, migra y siembra (se niega en producción y con bases remotas)                                     |
| `pnpm openapi`                                                          | Genera `docs/openapi.json`                                                                                            |

## Procesos

- **API** (`src/server.js`): Express en `/api/v1`, más `/health`, `/openapi.json` y `/docs` (estos dos solo con `DOCS_HABILITADAS=true`). Encola trabajos con pg-boss en modo productor.
- **Worker** (`src/worker.js`): ejecuta los trabajos de `src/jobs.js` con 3 reintentos y espera exponencial.

Ambos comparten la base de datos; pg-boss usa el esquema `pgboss`.

## Estructura

```
src/
├── app.js · server.js · worker.js · routes.js · jobs.js
├── config/         # env.js (variables validadas con Zod) y database.js (sequelize-cli)
├── db/             # migrations/, seeders/ (+ data/), seeders-demo/ y semillas/ (carga reutilizable)
├── models/         # un modelo por tabla (43); asociaciones y sus alias en index.js
├── openapi/        # Zod extendido (zod.js) y registro de rutas (registro.js)
├── core/           # errores, http, logger, auth, almacenamiento, cola, salud…
└── modules/<modulo>/   # un router de Express por módulo de negocio
test/               # setup de Jest; helpers (limpiarBase, tokenPara) y factories
```

## Convenciones de la API

- JSON en camelCase; base de datos en snake_case.
- Errores: `{ "codigo": "UPPER_SNAKE", "mensaje": "…", "campos": { "campo": "CODIGO" } }`. La app traduce por `codigo`.
- Paginación: `?page=&limit=` (máximo 100) → `{ datos, paginacion: { page, limit, total } }`.
- Cada router define rutas completas relativas a `/api/v1`. Los middlewares de autenticación y permisos van en cada ruta, nunca con `router.use()`.
- Los esquemas importan `z` desde `src/openapi/zod.js` y cada endpoint se documenta con `registrarRuta()` de `src/openapi/registro.js`.
- Los logs nunca incluyen cuerpos de petición, query strings, tokens ni contraseñas.

## Núcleo compartido (`src/core`)

```js
router.get(
  '/solicitudes/:id/algo',
  requiereAuth,
  requierePermiso('solicitud.leer'),
  async (req, res) => {
    const solicitud = await obtenerSolicitudConAcceso(req.usuario, req.params.id); // 404 sin relación
    // ...
  },
);
```

| Pieza                    | Qué ofrece                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/auth`              | `requiereAuth` (JWT + sesión vigente + usuario activo → `req.usuario`) y `requierePermiso(...codigos)`                                                                                         |
| `core/acceso`            | `obtenerSolicitudConAcceso`, `obtenerPacienteConAcceso`, `filtroSolicitudesVisibles`, `puedeEditar` / `exigirEdicion`, `usuariosFamiliaDe`, `coordinadoresDe`                                  |
| `core/estados`           | `cambiarEstado` (única forma de cambiar el estado: valida transición y rol, historial, bitácora, notificaciones y evento), `registrarCreacion`, `actualizarCamposRuta`, `transicionesPosibles` |
| `core/expediente`        | Lista única de secciones y `estadoExpediente` (faltantes y `listoParaConfirmar` por etapa)                                                                                                     |
| `core/archivos`          | `guardarArchivo` (tipo por contenido, hash, dimensiones), `urlFirmada` (registra el acceso), `subidaEnMemoria` (multer)                                                                        |
| `core/notificaciones`    | `notificar` (bandeja en el idioma de cada usuario + push en cola) y las plantillas es/en                                                                                                       |
| `core/correo`            | `enviarCorreo`, `encolarCorreo` y plantillas es/en; en desarrollo los correos simulados quedan en `tmp/correos`                                                                                |
| `core/auditoria`         | `registrarBitacora`, `auditarCambio`, `registrarAcceso` (usuario e IP salen del contexto)                                                                                                      |
| `core/eventos`           | `emitirTrasCommit` y `suscribir` (lista cerrada de eventos)                                                                                                                                    |
| `core/http/idempotencia` | Middleware `idempotente()` para `Idempotency-Key`                                                                                                                                              |
| `core/contexto`          | Usuario, IP y dispositivo de la petición con AsyncLocalStorage                                                                                                                                 |

En pruebas: `appDePrueba(router)` de `test/helpers/app.js` monta un router con el mismo andamiaje que la API.

## Base de datos

- 43 tablas creadas con migraciones de sequelize-cli (`src/db/migrations`), todas reversibles. Llaves UUID con `gen_random_uuid()`, salvo departamentos y municipios (código oficial).
- Las listas cerradas son `VARCHAR` + `CHECK`; los valores permitidos están en `Modelo.VALORES` y en `src/core/estados/constantes.js`. Una prueba comprueba que coincidan con la base.
- Búsqueda de pacientes sin acentos: columna generada `pacientes.nombre_busqueda` con índice trigram (no está en el modelo; consúltala con `sequelize.col('nombre_busqueda')`).
- El código de caso sale de la secuencia `solicitud_codigo_seq`.
- Catálogo de 298 municipios en `src/db/seeders/data/municipios.csv`, pendiente de verificar contra la fuente oficial.

## Notas

- **Pruebas y ESM**: algunas dependencias (pg-boss) solo se distribuyen como módulos ES. `pnpm test` activa `--experimental-vm-modules` para que Jest pueda cargarlas con `require`.
- **Proveedores en pruebas**: cola, almacenamiento, correo, push y OCR usan adaptadores en memoria o simulados, sin importar el `.env`. La base de pruebas sí es PostgreSQL real.
- **Scripts de instalación**: pnpm solo permite compilar `argon2` (ver `allowBuilds` en `pnpm-workspace.yaml`).
- **Datos**: nunca uses datos reales de pacientes en seeders, pruebas ni demostraciones.
