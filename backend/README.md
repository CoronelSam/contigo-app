# Vanguardia · Backend

API REST y procesos en segundo plano de Vanguardia: reúne la información médica y los documentos de cada niño, sugiere una ruta de atención (Honduras, Hospital Shriners México o programa internacional en Tampa), registra la decisión y da seguimiento al caso.

Node.js 24 · Express 5 · PostgreSQL 17 + Sequelize 6 · pg-boss · S3 compatible · Zod + OpenAPI 3.1 · Jest.

## Requisitos

- Node.js 24 (ver `.node-version`).
- pnpm (la versión exacta está en `packageManager` de `package.json`). **No uses npm ni yarn.**
- Docker con Compose (`docker compose` o `docker-compose`).

## Arranque rápido

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm dev
```

`curl localhost:3000/health` debe responder `200` con `"estado": "operativo"`. En otra terminal, `pnpm worker` procesa los trabajos en cola.

Servicios locales de `pnpm infra:up`:

| Servicio                  | Dirección                                          | Uso                                                               |
| ------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| PostgreSQL 17             | `localhost:5432`                                   | Bases `vanguardia` y `vanguardia_test`                            |
| S3 compatible (SeaweedFS) | `localhost:9000`                                   | Bucket privado `vanguardia-dev` con cifrado del lado del servidor |
| Mailpit                   | SMTP `localhost:1025`, web <http://localhost:8025> | Correos de desarrollo                                             |

## Scripts

| Script                                                                  | Qué hace                                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev`                                                              | API con recarga automática                                                        |
| `pnpm start`                                                            | API sin recarga                                                                   |
| `pnpm worker`                                                           | Proceso de trabajos en cola (OCR, paquete PDF, push, correo)                      |
| `pnpm test` / `pnpm test:watch`                                         | Pruebas con Jest contra `vanguardia_test` (se reinicia y migra en cada corrida)   |
| `pnpm lint` / `pnpm format` / `pnpm format:check`                       | ESLint y Prettier                                                                 |
| `pnpm db:migrate` / `pnpm db:migrate:undo` / `pnpm db:migrate:undo:all` | Migraciones con sequelize-cli                                                     |
| `pnpm db:seed`                                                          | Seeders                                                                           |
| `pnpm db:reset`                                                         | Borra la base local, migra y siembra (se niega en producción y con bases remotas) |
| `pnpm openapi`                                                          | Genera `docs/openapi.json`                                                        |
| `pnpm infra:up` / `pnpm infra:down`                                     | Levanta o baja la infraestructura local                                           |

## Procesos

- **API** (`src/server.js`): Express en `/api/v1`, más `/health`, `/openapi.json` y `/docs` (estos dos solo con `DOCS_HABILITADAS=true`). Encola trabajos con pg-boss en modo productor.
- **Worker** (`src/worker.js`): ejecuta los trabajos de `src/jobs.js` con 3 reintentos y espera exponencial.

Ambos comparten la base de datos; pg-boss usa el esquema `pgboss`.

## Estructura

```
src/
├── app.js · server.js · worker.js · routes.js · jobs.js
├── config/         # env.js (variables validadas con Zod) y database.js (sequelize-cli)
├── db/             # migraciones y seeders
├── models/         # modelos de Sequelize; asociaciones en index.js
├── openapi/        # Zod extendido (zod.js) y registro de rutas (registro.js)
├── core/           # errores, http, logger, auth, almacenamiento, cola, salud…
└── modules/<modulo>/   # un router de Express por módulo de negocio
test/               # setup de Jest, helpers y factories
```

## Convenciones de la API

- JSON en camelCase; base de datos en snake_case.
- Errores: `{ "codigo": "UPPER_SNAKE", "mensaje": "…", "campos": { "campo": "CODIGO" } }`. La app traduce por `codigo`.
- Paginación: `?page=&limit=` (máximo 100) → `{ datos, paginacion: { page, limit, total } }`.
- Cada router define rutas completas relativas a `/api/v1`. Los middlewares de autenticación y permisos van en cada ruta, nunca con `router.use()`.
- Los esquemas importan `z` desde `src/openapi/zod.js` y cada endpoint se documenta con `registrarRuta()` de `src/openapi/registro.js`.
- Los logs nunca incluyen cuerpos de petición, query strings, tokens ni contraseñas.

## Notas

- **Pruebas y ESM**: algunas dependencias (pg-boss) solo se distribuyen como módulos ES. `pnpm test` activa `--experimental-vm-modules` para que Jest pueda cargarlas con `require`.
- **Proveedores en pruebas**: cola, almacenamiento, correo, push y OCR usan adaptadores en memoria o simulados, sin importar el `.env`. La base de pruebas sí es PostgreSQL real.
- **Scripts de instalación**: pnpm solo permite compilar `argon2` (ver `allowBuilds` en `pnpm-workspace.yaml`).
- **Datos**: nunca uses datos reales de pacientes en seeders, pruebas ni demostraciones.
