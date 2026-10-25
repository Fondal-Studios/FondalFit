# Matriz de módulos (24) — estado real

Leyenda: ✅ flujo persistente + tests · 🟡 parcial · ⬜ backlog (sin implementar; no hay botones vacíos).

| # | Módulo | Estado | Evidencia / pendiente |
|---|---|---|---|
| M01 | Cuentas y perfiles | 🟡 | registro/login/roles, consentimientos, exportar y borrar. Pendiente: reset de contraseña, equipos |
| M02 | Evaluación adaptativa | 🟡 | asistente de 6 pasos con Atrás, datos antropométricos, editable cuando quieras, banderas rojas. Pendiente: pruebas físicas opcionales |
| M03 | FONDAL COACH (LLM) | 🟡 | chat con Claude (necesita `ANTHROPIC_API_KEY`), contexto solo con consentimiento, límite 30 msg/día, reglas de seguridad; suplementos con evidencia sin necesidad de clave. Probado con modelo simulado, **no con la API real** |
| M04 | Planificación | 🟡 | plan híbrido fuerza+cardio, 8 objetivos con fibras/descansos/volumen, 45 ejercicios, doble progresión. Pendiente: periodización por bloques, sustituciones |
| M05 | Sesión guiada | 🟡 | registro de series/RIR. temporizador de descanso. Pendiente: offline parcial |
| M06 | Fuerza y calistenia | 🟡 | catálogo de 20 ejercicios |
| M07 | Running / bici | 🟡 | GPS en vivo (distancia, ritmo, desnivel, ruta), sesiones zona 2/intervalos/tempo/fondo, FC estimada, aviso de saltos de volumen. Limitación: solo con la app abierta |
| M08 | Funcional / deportes | ⬜ | |
| M09 | Readaptación | 🟡 | derivación por banderas rojas. Pendiente: aprobación profesional del plan |
| M10 | Biomecánica | ⬜ | Sprint 6 |
| M11 | Voz y avatar | ⬜ | Sprint 6 |
| M12 | Nutrición | 🟡 | cálculo explicado, 30 menús (3 por día, rotan), filtros dieta/alergias, portions escaladas, registro 1 toque, agua. Pendiente: recetas, base de alimentos propia |
| M13 | Recuperación | 🟡 | índice y alertas |
| M14 | Wearables | ⬜ | Sprint 7; ver ADR-004 |
| M15 | Academia | ⬜ | |
| M16 | Gamificación | 🟡 | XP (1 actividad/día), nivel, racha, logros. Pendiente: cosméticos |
| M17 | Panel profesional | 🟡 | alumnos, límites de IA, aprobaciones. Pendiente: informes, comunicación |
| M18 | Agenda | ⬜ | |
| M19 | Analítica | 🟡 | volumen por sesión |
| M20 | Suscripciones | 🟡 | prueba 14 días y cancelación; **sin proveedor de pago** |
| M21 | Idiomas / accesibilidad | 🟡 | ES/PT/EN con test de paridad; controles ≥44px |
| M22 | Seguridad | 🟡 | RBAC, scrypt, rate limit, auditoría. Pendiente: cifrado en reposo, backups |
| M23 | Operaciones | 🟡 | CI. Pendiente: feature flags, monitoreo |
| M24 | QA | 🟡 | 70 tests (motor 41, API 26 en SQLite y PostgreSQL, web 3) + E2E en navegador con GPS simulado |
