# Cómo poner Fondal Fit online (gratis)

## Por qué al entrar ves el README
GitHub guarda el **código**; no ejecuta la app. Si abrís el repo (o GitHub Pages) ves el README. Fondal Fit necesita un servidor (la API) y una base de datos, y GitHub Pages solo sirve archivos estáticos. Hay que desplegarla en un hosting. Con los pasos de abajo obtenés un enlace tipo `https://fondal-fit.onrender.com`.

## Piezas (todas con plan gratuito, sin tarjeta que yo sepa; verificá en cada sitio)
| Pieza | Servicio | Nota |
|---|---|---|
| App (API + PWA) | **Render** (web service gratis) | Se "duerme" tras ~15 min sin uso y tarda ~30–60 s en despertar. |
| Base de datos PostgreSQL | **Neon** (https://neon.tech) | La base gratis de Render **vence a los 30 días**, por eso uso Neon. |

## Paso a paso
**A. Crear la base (2 min)**
1. Entrá a https://neon.tech y creá cuenta (podés usar GitHub).
2. *Create project* → nombre `fondal-fit`, región la más cercana.
3. En el panel, botón **Connect** → copiá la *connection string* (empieza con `postgresql://…`). Guardala, es secreta.

**B. Crear la app en Render (5 min)**
1. Entrá a https://render.com y creá cuenta con GitHub; autorizá el repo `arquitecto-`.
2. *New +* → **Blueprint** → elegí el repo y la rama que contiene `render.yaml` (hoy `claude/fondal-feed-base`; tras fusionar a `main`, `main`).
3. Cuando pida `DATABASE_URL`, pegá la cadena de Neon. *Apply*.
4. Esperá el primer build (unos 3–6 min). Al terminar, Render muestra la URL pública. Abrila: ves la pantalla de Fondal Fit.
5. Verificá `https://TU-URL/api/health` → `{"ok":true}`.

Las tablas se crean solas al arrancar. En el celular, abrí la URL y usá *Agregar a pantalla de inicio* para instalar la PWA.

## Local
```bash
npm install && npm run build && npm start      # SQLite local en ./fondal.db → http://localhost:3001
DATABASE_URL=postgres://… npm start            # contra PostgreSQL
npm test                                       # SQLite
TEST_DATABASE_URL=postgres://… npm -w @fondal/api run test   # misma suite sobre PostgreSQL
```
Docker: `docker build -t fondal-fit . && docker run -p 3001:3001 -e DATABASE_URL=… fondal-fit`

## Antes de usuarios reales (pendiente)
- Backups y restauración probada de la base (Neon ofrece restauración por tiempo; hay que verificar el plan).
- Cifrado en reposo propio, reseteo de contraseña, correo transaccional, términos y privacidad revisados por un abogado.
- Pagos: fuera de alcance por ahora (solo prueba de 14 días y cancelación, sin cobro).
- Probar en Safari iPhone y Android reales.
