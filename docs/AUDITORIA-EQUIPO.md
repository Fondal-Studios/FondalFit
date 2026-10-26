# Auditoría con equipo deportivo (profesor runner + profesor universitario de Educación Física)

Verificado: typecheck, 78 tests motor, 75 API (SQLite y PostgreSQL), 9 web, build y E2E de navegador (móvil y escritorio).

## Qué es útil hoy
- **Hoy**: sesión en un toque, presupuesto calórico explicado (basal + NEAT + ejercicio + ajuste por objetivo), agua separada por colores, rachas.
- **Entrenamiento**: 133 ejercicios con explicación, 36 rutinas, mesociclo de 4 semanas con descarga, retorno tras pausa, híbrido con regla de interferencia.
- **Running**: GPS en primer plano, ritmo/zonas FC, carga manual de carreras (km, kcal) y borrado.
- **Nutrición**: 150 alimentos por categoría y gramos, 30 menús rotables, texto libre (reglas + IA), carga manual con kcal y borrado.
- **Profesional**: estudio de rutinas, código de vinculación, devolución del alumno, directorio verificado; cambio deportista ⇄ profesional siempre desde Ajustes o el encabezado.
- **Admin**: telemetría agregada solo para `ADMIN_EMAILS`.

## Qué agregaría
1. Test de campo guiado (Cooper, 5 km, 1RM estimado) con re-cálculo de zonas y cargas.
2. Plan de running por objetivo de carrera (5/10/21 km) con fartlek, series, tempo y largos en semanas progresivas.
3. Control de carga (ACWR/RPE de sesión) visible para el profesional.
4. Calentamiento y movilidad automáticos por sesión; técnica en video corto por ejercicio.
5. Importar Strava/Garmin/Apple Health/Health Connect (hoy: GPX/CSV y balanzas BLE; los puentes nativos requieren app).
6. Informe semanal exportable (PDF) para alumno y profesor.

## Qué sacaría o simplificaría
- Menús y tarjetas duplicadas entre Home, Comida y Progreso: dejar una sola fuente por dato.
- Rankings por defecto desactivados (ya son opt-in); evitar comparar peso corporal.
- Textos en español fijo del código de Codex (directorio, panel profesional): pasar a i18n ES/PT/EN.

## Faltantes y riesgos conocidos
- Coach e interpretación con IA **no probados con la API real** (sin clave en esta sesión).
- GPS solo en primer plano (limitación de PWA); sin sensores nativos.
- Macros aproximados (tabla de 150 alimentos); no sustituye a un nutricionista.
- Sin pagos, backups automáticos ni cifrado a nivel campo; sin pruebas en iOS/Android reales.
- Panel de entrenador de Codex (`ProfessionalHub`) y mi Estudio conviven: conviene unificarlos.
- Edición simultánea Codex + Claude en `main` generó conflictos; usar ramas por tarea y PR.
