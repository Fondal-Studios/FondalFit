# Estado y reanudación

## Hecho (con tests)
- Motor determinista (20 tests): plan por objetivo/equipo/restricciones, doble progresión, límites de autonomía, nutrición con piso seguro, recuperación, banderas rojas.
- API (18 tests de integración): auth, roles, consentimientos, plan/sesiones, adaptación, aprobaciones, vínculos revocables, nutrición, recuperación, exportar/borrar.
- Web: PWA ES/PT/EN (2 tests de paridad). Humo en navegador móvil: alta → consentimiento → evaluación → plan → sesión → plan adaptado (`docs/screenshot-session-mobile.png`).

## No hecho / honesto
- Auditoría de repos hermanos (sin acceso). CleanKEA sin identificar.
- LLM, cámara, voz/avatar, wearables, pagos reales, running, academia, agenda.
- No probado en Safari iPhone ni Android real. Sin cifrado en reposo ni backups.
- SQLite local: apto para desarrollo; producción requiere PostgreSQL (ADR-002).

## Próximo bloque
Reset de contraseña, ADR de proveedor de pagos y Sprint 3 (coach LLM con herramientas de permisos limitados).
