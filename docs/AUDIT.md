# Sprint 0 — Auditoría de repositorios

**Resultado honesto: no se pudo auditar.** Esta sesión solo tiene acceso al repositorio `Arquitecto-` (estaba vacío, solo README).
`Fondal-Learn`, `Fondal-Motion`, `ClinicIA`, `Nexus` y `CleanKEA` **no están en el alcance de esta sesión**; no se leyó su código y no se asume nada sobre su contenido.

## Matriz requisito → reutilizable → faltante → riesgo (provisional)
| Requisito | Candidato a reutilizar | Estado | Riesgo |
|---|---|---|---|
| M15 Academia | Fondal-Learn (¿?) | Sin verificar | Licencia/stack desconocidos |
| M10 Biomecánica | Fondal-Motion (¿?) | Sin verificar | Precisión sin validar |
| M09 Readaptación / M17 Panel | ClinicIA (¿?) | Sin verificar | Datos clínicos: privacidad |
| M18 Agenda | Nexus (¿?) | Sin verificar | Acoplamiento |
| CleanKEA | — | **No identificado** | No inventar |

## Para completar la auditoría necesito
1. Dar acceso a esos repos a esta sesión (o indicar propietario/URL exactos) y la identificación de **CleanKEA**.
2. Integrar solo por adaptadores; nunca copiar secretos.
