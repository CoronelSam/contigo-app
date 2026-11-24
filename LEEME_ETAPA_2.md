# CONTIGO – Etapa 2: familia y solicitudes (pantallas 07–12)

Este paquete es una **actualización localizada del frontend** basada en el código del archivo `contigo-app 2.zip`.
**No incluye ni modifica `backend/`**; preserva la Etapa 1.

## Archivos incluidos

- `frontend/lib/features/home/family_home.dart` — 07. Inicio familiar, datos reales de `/me/resumen`.
- `frontend/lib/features/pacientes/patients_page.dart` — 08. Lista, 09. Registro del niño, 10. Responsable legal.
- `frontend/lib/features/solicitudes/new_request_page.dart` — 11. Crear solicitud, 12. Seleccionar modalidad.
- `frontend/lib/features/familia/widgets/step_header.dart` — Encabezado compartido con identidad CONTIGO.

## Instalar sin perder archivos

1. Haz un respaldo o commit de los cambios actuales de `frontend/`.
2. Descomprime este paquete.
3. Copia **solo el directorio `frontend/lib/`** dentro de `contigo-app/frontend/lib/`, fusionando las carpetas.
4. Acepta reemplazar **solamente** los tres archivos Dart existentes señalados arriba. El cuarto es nuevo.
5. No reemplaces `pubspec.yaml`, `pubspec.lock`, `ios/`, `.env`, `backend/` ni tus demás pantallas.

## Ejecutar en simulador iOS

Desde `contigo-app/frontend`:

```bash
flutter pub get
dart format lib/features/home/family_home.dart lib/features/pacientes/patients_page.dart lib/features/solicitudes/new_request_page.dart lib/features/familia/widgets/step_header.dart
flutter analyze
flutter run -d 2CBBDF73-BFD5-4B07-8384-AA72787FC321 --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

La URL, el puerto y el identificador del simulador deben coincidir con tu entorno. El backend debe estar encendido y configurado con PostgreSQL.

## Comprobaciones funcionales

1. Inicia sesión con una cuenta de familia. En Inicio se cargan los contadores reales.
2. Abre Mis niños. Debe mostrar la lista real o una indicación de que aún no hay registros.
3. Registra un niño; comprueba fecha, sexo, departamento y municipio desde la API.
4. Completa el responsable legal y confirma la casilla.
5. Crea una solicitud para el niño; el backend devuelve un código de caso.
6. Selecciona «Llenar en la aplicación» o «Fotografiar formularios llenos» y pulsa Guardar modalidad.
7. Vuelve a Mis niños y entra al mismo niño; debe cargar la solicitud existente sin crear otra.
8. Comprueba que una solicitud en revisión no permita cambiar su modalidad.
9. Prueba la recuperación ante error de red. No debe mostrar datos ficticios ni afirmar que se guardó algo sin respuesta de la API.

## API verificada del proyecto

`GET /me/resumen`, `GET /pacientes`, `GET /pacientes/:id`, `POST /pacientes`,
`GET /catalogos/departamentos`, `GET /catalogos/departamentos/:id/municipios`,
`GET /catalogos/parentesco`, `POST /pacientes/:id/tutores`, `POST /solicitudes`,
`GET /solicitudes/:id`, `PUT /solicitudes/:id/modalidad`.

Las etapas 3 (formulario médico) y 4 (cámara/OCR) **aún no quedan implementadas** con este paquete. Los accesos muestran mensajes claros.

## Nota de verificación

Este paquete se elaboró a partir del código y contratos de tu ZIP. **No se ejecutó `flutter analyze` ni una compilación iOS en el entorno de preparación**; debes comprobarlos en tu Mac antes de hacer un commit.
