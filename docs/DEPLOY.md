# Cómo desplegar Fondal Fit

La app es **un solo servicio Node**: la API también sirve la PWA ya compilada. Necesita Node ≥ 22.13 y un disco persistente para la base (`DB_PATH`).

## 1. Probar local
```bash
npm install
npm run build          # compila la PWA en apps/web/dist
npm start              # http://localhost:3001  (API + PWA)
```
Para desarrollar con recarga: `npm run dev:api` y `npm run dev:web` (http://localhost:5173).

## 2. Con Docker
```bash
docker build -t fondal-fit .
docker run -p 3001:3001 -v fondal-data:/data fondal-fit
```

## 3. En un hosting (Render, Railway, Fly.io…)
- Crear un *Web Service* desde este repositorio (usa el `Dockerfile`).
- Agregar un **disco/volumen persistente** montado en `/data` (sin él, se pierden los datos en cada deploy).
- Variables: `PORT` (la mayoría lo inyecta), `DB_PATH=/data/fondal.db`.
- El hosting da HTTPS, necesario para instalar la PWA en el celular.

## Antes de abrirla a usuarios reales (beta)
Estos puntos NO están hechos todavía:
- Pasar de SQLite a PostgreSQL gestionado, con backups y restauración probada.
- Elegir proveedor de pagos (hoy solo hay prueba de 14 días y cancelación; no se cobra).
- Cifrado en reposo, política de retención, términos y política de privacidad revisados por un abogado.
- Probar en Safari iPhone y Android Chrome reales.
- Un sistema de reseteo de contraseña y correo transaccional.
