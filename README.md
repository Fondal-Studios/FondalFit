# Arquitecto

Asistente de arquitectura para quien no sabe de arquitectura: relevás los ambientes con la cámara del celular, obtenés un plano con cotas y m², y recibís observaciones y sugerencias de reforma con un presupuesto orientativo (Argentina).

> **Aviso:** no reemplaza a un profesional matriculado. No determina qué muros son portantes ni sustituye cálculo estructural, planos municipales ni dirección de obra. Los valores normativos y los precios son de referencia y hay que verificarlos.

## Qué hace hoy (MVP)

- **Medición con cámara (WebXR/ARCore, Chrome en Android):** marcás las esquinas del piso, el sistema calcula área y perímetro y endereza los ángulos casi rectos.
- **Carga manual** de medidas (rectángulos) cuando el navegador no soporta AR.
- **Plano de planta SVG** con cotas, nombre y m² por ambiente. Exporta SVG y JSON.
- **Observaciones por ambiente** (superficie, lado mínimo, altura, ventilación) y **sugerencias de reforma** con rango de costo.
- Funciona offline (PWA) y guarda el relevamiento en el dispositivo; nada se sube a ningún servidor.

## Probar

```bash
npm test            # o: node tests/geometry.test.mjs
python3 -m http.server 8000   # abrir http://localhost:8000
```

La cámara AR exige HTTPS (o `localhost`) y un dispositivo con ARCore.

## Estructura

| Archivo | Rol |
|---|---|
| `js/geometry.js` | Área, perímetro, enderezado de ángulos (puro, con tests) |
| `js/ar.js` | Sesión WebXR con hit-test para marcar esquinas |
| `js/plan.js` | Dibujo del plano SVG |
| `js/advisor.js` | Reglas orientativas, sugerencias y costos (precios editables) |
| `js/app.js` | Interfaz y almacenamiento local |

## Pendiente (roadmap)

1. Puertas, ventanas y muebles marcados en el plano; unión de ambientes por muros compartidos.
2. Altura medida con AR y plano de cortes.
3. Normativa por municipio y precios actualizables desde una fuente.
4. Render fotorrealista guiado por la geometría real.
5. App nativa iOS con RoomPlan (LiDAR) para mayor precisión.
