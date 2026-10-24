# Fondal Fit

Plataforma para seguimiento de entrenamientos, para deportistas y profesionales (PWA oscura, ES/PT/EN).
Base del dossier *FONDAL FIT IA* (23/10/2026). Estado: **Sprint 0 + base de los Sprints 1–5**. Ver [`docs/STATUS.md`](docs/STATUS.md) para lo implementado y lo pendiente.

## Estructura
- `packages/engine` – motor determinista y testeado (plan, progresión, límites de autonomía, nutrición, recuperación, filtro de seguridad). El LLM **no** calcula; solo explicará.
- `apps/api` – API Fastify + zod + SQLite (`node:sqlite`). Roles, consentimientos granulares, vínculos profesional↔alumno revocables, aprobaciones.
- `apps/web` – PWA React/Vite (instalable, service worker), ES/PT/EN.

## Uso
```bash
npm install
npm run dev:api   # :3001
npm run dev:web   # :5173 (proxy /api)
npm test && npm run typecheck && npm run build
```
Requiere Node ≥ 22.13.

## Documentación
[`docs/STATUS.md`](docs/STATUS.md) · [`docs/MODULES.md`](docs/MODULES.md) · [`docs/AUDIT.md`](docs/AUDIT.md) · [`docs/adr/`](docs/adr)
