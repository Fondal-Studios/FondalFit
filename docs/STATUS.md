# Estado y reanudación

## Hecho (con tests)
- **Motor** (41 tests): plan híbrido fuerza+cardio, reglas de interferencia, 8 objetivos, volumen por músculo, doble progresión, nutrición explicada, 30 menús con filtros, GPS (filtros de precisión y velocidad), suplementos con evidencia, FC estimada.
- **API** (26 tests, en SQLite y PostgreSQL): auth, roles, consentimientos, evaluación editable, perfil, menús, suplementos, actividades GPS, coach IA (con modelo simulado), aprobaciones, vínculos revocables, exportar/borrar.
- **Web** (3 tests + E2E en navegador): asistente de 6 pasos con Atrás, Inicio/Entrenar/Cardio GPS/Comida/Más, Coach, Ciencia. E2E verificó GPS simulado (0,11 km, ritmo 6:27) y menús vegetarianos.

## No hecho / honesto
- El coach con IA **no se probó contra la API real de Anthropic** (no hay clave en esta sesión). Se activa al definir `ANTHROPIC_API_KEY`.
- GPS: solo con la app abierta y pantalla encendida (límite de las PWA). Fondo/pantalla apagada requiere app nativa. No probado en iPhone/Android reales.
- Los macros de los 34 platos son aproximados (porciones típicas), no de una base nutricional oficial.
- Cámara, voz/avatar, wearables, pagos, academia, agenda: sin hacer.
- Backups, migraciones versionadas, cifrado en reposo, reseteo de contraseña.
- Plan gratuito de Render: se duerme tras 15 min (primer acceso lento).
