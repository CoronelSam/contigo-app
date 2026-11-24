# Plan de construcción — CONTIGO (56 prototipos)

Cada etapa se conecta al backend existente, **sin modificarlo**, y se valida con emulador Android. Conserva paleta vino #941638, vino oscuro #75102C, crema #FFF9F5, rosa #FBE8ED, azul #E9F2FC, amarillo #FFF2DE y lila #F1EBFC; botones y tarjetas redondeadas.

## Etapa 1 — Acceso y sesión (01–06)

Implementado inicialmente: bienvenida, español, acceso, registro, recuperación inicial, perfil, cambio de contraseña y cerrar sesión. Para terminar: enlace de recuperación y verificación de correo, preferencias de notificaciones y traducción real al inglés. Probar que no hay acceso libre a funciones privilegiadas.

## Etapa 2 — Familia y datos iniciales (07–12)

Implementado inicialmente: resumen, lista de niños, registro, padre/madre/tutor, alta de solicitud y elección de modalidad. Para completar: edición de tutor/niño, fotos de perfil, estado visual de solicitudes previas, control de duplicados, carga del expediente previo y prueba de todas las validaciones.

## Etapa 3 — Cuestionario médico (13–21)

Conectar `GET/PUT /solicitudes/:id/secciones/:seccion`; respetar esquema JSON real por sección, versión y encabezado `If-Match` (optimistic locking). Pantallas: información inicial, embarazo/parto, antecedentes, medicamentos/alergias, desarrollo motor, educación, profesional y certificación, consentimientos oficiales con apertura registrada, resumen editable. No afirmar que un consentimiento está firmado si no hay hoja válida.

## Etapa 4 — Documentación (22–29)

Checklist específico del paquete asignado, anexos, cámara, páginas, OCR, revisión, almacenamiento local/offline, sincronización y envío a revisión. Contrato real `/documentos`, `/ocr` y `/solicitudes/:id/enviar`. La extracción de OCR exige revisión humana. `Idempotency-Key` es obligatorio para el envío.

## Etapa 5 — Seguimiento (30–34)

Línea del tiempo basada en `/solicitudes/:id/seguimiento`, mensajería, notificaciones, contacto/ayuda desde API y recaptura de documentos rechazados. Distinguir `CAPTURADO` de `VALIDADO`. No mostrar decisiones médicas ficticias.

## Etapa 6 — Voluntariado (35–41)

Inicio, casos asignados, captura en jornada, revisión de OCR con el original, corrección de campos con confianza baja, confirmación humana y solicitud de nueva captura. Solo casos asignados por backend.

## Etapa 7 — Coordinación (42–50)

Tablero, expediente, validación, ruta sugerida sujeta a confirmación, PDFs oficiales, envío y respuesta comunicada por Shriners. No atribuir una aceptación médica al coordinador.

## Etapa 8 — Administración (51–56)

Usuarios, roles/permisos, catálogos, versiones de plantillas y métricas. Prohibir cambio arbitrario de rol en cliente: permisos exigidos por servidor.

## Secuencia segura en GitHub

1. Confirma la rama de tu compañero con `git branch -a` y `git status`.
2. Crea tu rama: `git switch -c feature/frontend-contigo`.
3. Coloca `frontend/` como carpeta hermana de `backend/`.
4. Genera carpetas de plataforma con `flutter create` dentro de `frontend/`.
5. Ejecuta `flutter analyze`, `flutter test`, y pruebas manuales con API real.
6. `git add frontend/` (NO uses `git add .` si hay otros cambios sin revisar).
7. `git commit -m "feat(frontend): iniciar app movil CONTIGO"`.
8. `git push -u origin feature/frontend-contigo` y abre un Pull Request para revisión conjunta.

**Nunca** agregues `.env`, claves, tokens ni datos médicos reales.
