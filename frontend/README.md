# CONTIGO — Frontend móvil (Flutter)

**Etapa inicial basada en los prototipos 01–12.** La carpeta `frontend/` es independiente del backend del compañero. Se revisó su contrato real de API antes de conectar formularios.

## 1. Integración sin tocar el backend

En tu repositorio clonado de GitHub `contigo-app/` deben quedar **dos carpetas hermanas**:

```text
contigo-app/
├── backend/          ← EXISTENTE, NO MODIFICAR
├── frontend/         ← COPIAR ESTA CARPETA AQUÍ
└── .github/          ← EXISTENTE, NO MODIFICAR
```

Extrae el ZIP recibido y coloca **solo la carpeta `frontend/`** junto a `backend/`. No reemplaces la carpeta backend ni el `.git` del repositorio.

## 2. Requisitos

- macOS o Windows, Flutter SDK estable, Android Studio y su Android SDK; para iOS en Mac, Xcode.
- Un emulador Android o teléfono real; conexión al backend en ejecución.
- Backend configurado previamente por el compañero. **No ejecutes migraciones ni `db:reset` para probar el frontend**.

En una terminal en la raíz de `contigo-app`:

```bash
flutter doctor
cd frontend
flutter create --project-name contigo_frontend --platforms=android,ios .
flutter pub get
flutter devices
```

`flutter create` agrega las carpetas de plataforma Android/iOS y recursos generados que no se incluyeron en el ZIP, para evitar fijar versiones de herramientas ajenas a tu equipo. **No uses `--overwrite`** si ya existe código propio.

### Android y backend HTTP en desarrollo

El backend local de tu compañero usa `http://...:3000`. Android puede bloquear tráfico HTTP no cifrado. Solo para el **emulador de desarrollo**, en `frontend/android/app/src/main/AndroidManifest.xml`, coloca `android:usesCleartextTraffic="true"` dentro de `<application ...>` y asegúrate de tener:

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

en el elemento `<manifest>` (fuera de `<application>`). En producción se debe usar **HTTPS** y quitar el permiso de tráfico no cifrado. Para iOS se debe configurar temporalmente una excepción ATS de desarrollo, o preferir una URL HTTPS de pruebas.

## 3. Ejecutar

**Emulador Android:**

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

**Teléfono Android por Wi-Fi:** usa la dirección IP local del equipo que ejecuta el backend; `localhost` en el teléfono apunta al teléfono, NO a tu Mac.

```bash
flutter run --dart-define=API_BASE_URL=http://IP_DE_TU_COMPUTADORA:3000/api/v1
```

El equipo y el teléfono deben estar en la misma red; asegúrate de que la API escucha en una interfaz accesible, que el firewall permite el puerto y de que el backend está levantado. No cambies archivos del backend sin coordinarlo.

**Teléfono Android por USB (cuando `adb reverse` está configurado):**

```bash
adb reverse tcp:3000 tcp:3000
flutter run --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

El valor se configura en la ejecución; **no** guardes URL ni contraseñas reales en código fuente. La API del backend monta todos sus módulos en `/api/v1`.

## 4. Estado honesto de implementación

| Pantallas | Estado de esta entrega |
| --- | --- |
| 01 Bienvenida | Implementada |
| 02 Idiomas | Selector mostrado; español activo, versión inglesa pendiente (se avisa al elegirla) |
| 03 Iniciar sesión | Conecta `POST /auth/login` y guarda el refresh token en almacenamiento seguro |
| 04 Crear cuenta | Conecta `POST /auth/register`; los términos deben publicarse legalmente antes de producción |
| 05 Recuperar contraseña | Solicita correo con `POST /auth/password/forgot`; el enlace y la pantalla de restablecimiento quedan para etapa posterior |
| 06 Perfil | Carga datos con `GET /me`, cambia contraseña con `PATCH /me/password` y cierra sesión |
| 07 Inicio familiar | `GET /me/resumen` y accesos familiares; Documentos y Seguimiento se identifican como próximos módulos |
| 08 Mis niños | `GET /pacientes` |
| 09 Registrar niño | `POST /pacientes`, departamentos y municipios oficiales desde API |
| 10 Responsable legal | `POST /pacientes/:id/tutores` y catálogo de parentescos |
| 11 Nueva solicitud | `POST /solicitudes` (si existe, muestra la registrada) |
| 12 Modalidad | `PUT /solicitudes/:id/modalidad` con `app` o `fotos` |
| 13–56 | Pendientes: ver `PLAN_DE_TRABAJO.md` |

**Los endpoints posteriores existen en el backend, pero sus interfaces NO están implementadas aún.** Las tarjetas sin función muestran un aviso en vez de simular acciones.

## 5. Estructura

```text
frontend/
├── pubspec.yaml
├── analysis_options.yaml
├── README.md
├── PLAN_DE_TRABAJO.md
├── CONTRATOS_API.md
├── lib/
│   ├── main.dart
│   ├── core/
│   │   ├── api/api_client.dart
│   │   ├── auth/session.dart
│   │   ├── theme/contigo_theme.dart
│   │   └── widgets/ui.dart
│   └── features/
│       ├── access/access_screen.dart
│       ├── home/family_home.dart
│       ├── pacientes/patients_page.dart
│       ├── solicitudes/new_request_page.dart
│       └── perfil/profile_page.dart
└── test/theme_test.dart
```

Se organiza por funcionalidades para crecer con `features/documentos`, `features/ocr`, `features/voluntario`, `features/coordinador` y `features/admin`, manteniendo separados el API client, autenticación y componentes comunes.

## 6. Pruebas iniciales

```bash
flutter analyze
flutter test
```

La prueba incluida comprueba el tema y el color principal. No se afirma que los tests se hayan ejecutado aquí: este entorno no cuenta con Flutter SDK. Antes de subir a GitHub, ejecuta ambos comandos en tu computadora y revisa cualquier aviso.

Pasos de prueba manual: abrir app → seleccionar español → crear cuenta o entrar → abrir Mis niños → registrar niño → registrar tutor → crear solicitud → guardar modalidad → cerrar e iniciar sesión → verificar que los datos persisten en el backend.

## 7. Seguridad y limitaciones para producción

- Los datos de salud de niños son sensibles: usa exclusivamente datos ficticios para desarrollo.
- El refresh token se guarda con `flutter_secure_storage`; access token permanece en memoria. La API renueva sesión cuando responde 401. Validar y robustecer la gestión de renovaciones concurrentes antes de producción.
- No incluyas la versión de términos inventada: `2026-11` procede del ejemplo de las pruebas del backend, y **debe ser reemplazada por la versión legal vigente** antes del despliegue. El frontend debe incorporar los documentos íntegros de términos y privacidad, actualmente pendientes.
- Para un despliegue real se requiere HTTPS, política de privacidad publicada, pruebas funcionales, manejo de errores de red y validación legal y de seguridad.
- No se modificó ninguna ruta, migración, modelo o configuración del backend.
