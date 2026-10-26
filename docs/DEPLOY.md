# Cómo poner Fondal Fit online (gratis)

## Por qué al entrar ves el README
GitHub guarda el **código**; no ejecuta la app. Si abrís el repo (o GitHub Pages) ves el README. Fondal Fit necesita un servidor (la API) y una base de datos, y GitHub Pages solo sirve archivos estáticos. Hay que desplegarla en un hosting. Con los pasos de abajo obtenés un enlace tipo `https://fondal-fit.onrender.com`.

## La forma simple (solo Render, un clic)
1. Abrí https://render.com/deploy?repo=https://github.com/drmarianojimenez94-sudo/Arquitecto-
2. Creá cuenta en Render con tu GitHub y tocá **Apply**. Crea solo la app y su base de datos.
3. Cuando termine (~5 min) te da el enlace público de la app.

Limitaciones del plan gratuito de Render: la app se duerme tras ~15 min sin uso (tarda en despertar) y **la base gratis se borra a los 30 días**. Sirve para probar. Para uso real: base paga o migrar a Neon (https://neon.tech, cambiando solo la variable `DATABASE_URL`).

## Activar el coach con IA (opcional)
1. Creá una clave en https://console.anthropic.com (la API se cobra por uso; el límite diario por usuario es 30 mensajes).
2. En Render: tu servicio → *Environment* → agregá `ANTHROPIC_API_KEY` = tu clave. (Opcional `COACH_MODEL`.) Guardá: se redespliega.
Sin clave, todo funciona menos el chat.

## Velocidad
En el plan gratuito la app se duerme tras ~15 min sin uso y el primer acceso tarda hasta un minuto. Para evitarlo: un monitor gratuito (p. ej. UptimeRobot) que visite `https://TU-URL/api/health` cada 5 minutos, o el plan pago de Render.

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

## Variables de entorno de administración
- `ADMIN_EMAILS` = tu email de login (coma para varios): habilita el panel de telemetría (cuentas creadas, activos por día, uso). Solo muestra agregados, nunca datos de salud.
- `ANTHROPIC_API_KEY`: activa el coach y la interpretación con IA de comidas en texto libre (sin clave funciona con reglas).
- `FOUNDER_ACCOUNT_ID` / `FOUNDER_ACCOUNT_EMAIL`: cuenta fundadora verificada en el directorio profesional.
- Tip: el plan gratuito de Render duerme tras 15 min sin uso; el primer ingreso tarda ~50 s.
