# Simulación de 10 días y auditoría por roles

**Qué es y qué no es.** `apps/api/test/sim10.ts` (`npx tsx test/sim10.ts`) usa la API real con reloj simulado: 10 deportistas y 2 profesionales viven 10 días (comen, toman agua, entrenan, corren, saltean días, corrigen errores). Mide comportamiento del sistema. **No son personas reales**: los comentarios de cada rol son una revisión experta razonada sobre lo que la simulación y la app muestran, no una prueba con usuarios. Eso falta y es lo que más valor daría.

## Resultado medido
- 0 errores del servidor ni respuestas inesperadas en ~1.500 llamadas; 10/10 planes generados; 0 ejercicios que choquen con las restricciones declaradas (rodilla, zona lumbar).
- 67 sesiones de fuerza y 18 actividades registradas; el presupuesto calórico nunca bajó del metabolismo basal.
- Corrección de errores: una pizza cargada ×4 se editó a 1 porción y el día se recalculó; borrar un día entero y borrar una sesión funcionan.
- Vinculación profesor→alumno por código, plantilla asignada y panel del profesor: OK. Telemetría de admin (cuentas, activos por día/semana/mes, uso): OK.

## Hallazgos de la simulación (a mejorar)
1. **Carga inicial agresiva para cardio**: un deportista de VO₂máx recibe un fondo de 110 min en la primera semana. Debería arrancar más corto y crecer por semanas.
2. **Corredores intermedios sin fondo largo ni series** en la semana semilla (zona 2 ×2 + tempo): falta variedad hasta que corre el mesociclo.
3. **Proteína alta para principiantes** (≈2 g/kg en recomposición/pérdida de grasa): razonable pero conviene mostrar rango y su fuente.
4. **Plantilla del profesor reemplaza todo el plan** del alumno (4 días → 1): hay que avisar antes de asignar y mostrar qué se sustituye.
5. **Subregistro es el principal riesgo de uso real**: con una sola comida cargada el "te quedan X kcal" es engañoso; el calendario ahora marca en color los días muy bajos para detectarlo.

## Revisión por rol
**Profe de gimnasio.** Útil: rutinas (ahora 50, con bloques de calistenia, fuerza por olas, barra hexagonal, potencia), plantillas por alumno, devolución de sesiones. Falta: superseries/circuitos en planilla, notas por serie, fotos de progreso, chat con el alumno, plantilla por semanas (no solo semana semilla).

**Profesor universitario de Educación Física.** Útil: mesociclo con descarga, RIR, retorno tras pausa, volumen semanal por músculo, zonas de FC. Falta: tests de campo guiados (Cooper, 1RM estimado), control de carga ACWR/RPE visible, periodización por competencia, evaluación de movimiento (sentadilla/ASLR) y registro de lesiones con semáforo.

**Médico.** Útil: banderas rojas en la evaluación, restricciones respetadas, consentimientos y aviso de no-consejo-médico. Falta: derivación explícita ante dolor torácico/mareo durante la sesión, historial de medicación y lesiones, límites de FC por patología, revisión de los macros por un profesional (hoy son aproximados).

**Deportistas (resumen de 10 perfiles).**
- *Principiante/pérdida de grasa (Lucía, Paula)*: entienden Hoy y la cámara de calorías; lo mejor es el calendario para corregir; piden recordatorios de comida y agua.
- *Hipertrofia/fuerza (Marcos, Valentina, Diego)*: valoran cargas sugeridas y las ilustraciones de técnica; piden gráficos de 1RM por ejercicio en Hoy y descanso con aviso sonoro.
- *Corredoras/corredor (Sofía, Camila, Nico)*: GPS en primer plano limita la carrera con pantalla apagada; piden ritmos por kilómetro y planes por distancia objetivo.
- *Adulto mayor con rodilla/lumbar (Raúl)*: restricciones bien respetadas; necesita letra más grande y menos pasos para registrar.
- *Retorno tras pausa (Tomás)*: el aviso de retorno aparece y adapta volumen; falta empatía en el texto ("sin culpa").

## Pendiente de mayor valor
Pruebas con 5–10 personas reales; puentes nativos (Apple Health/Health Connect, GPS en segundo plano); revisión profesional de nutrición y de las ilustraciones (son esquemáticas, no ilustración médica); corregir los 5 hallazgos de arriba.
