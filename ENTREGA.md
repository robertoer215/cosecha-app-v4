# ENTREGA — COSECHA App v4

**Última actualización: 1-oct-2026 23:25.** Plazo real: el plan de Roberto caduca el **2-oct a las 16:42 (Madrid)**; entrega final como muy tarde a las **16:00**. Trabajo continuo y autónomo hasta entonces: cada avance se commitea y pushea, y este archivo se mantiene al día. Criterio de terminado: app casi lista para lanzar y una ronda completa de auditoría (roles independientes + 3 refutadores por hallazgo) sin ningún defecto S0/S1/S2 confirmado.

## URL

- **App publicada:** https://robertoer215.github.io/cosecha-app-v4/ (Pages sirve `main`)
- Repo: https://github.com/robertoer215/cosecha-app-v4 · Rama de trabajo de esta noche: `integracion`

## Qué es

Una sola app, cuatro pestañas, un solo perfil y una sola meta compartidos:

- **Hoy** — puerta de entrada: resumen del día (consumido vs meta, kcal derivadas 4P+4C+9G) y las tres acciones. Si hay una sesión de pesas a medias, invita a retomarla.
- **Pedir** — el armador de platos del restaurante, intacto, en **modo demo** (nunca llama al webhook de producción; verificado por registro de red en la URL pública, plato de punta a punta).
- **Diario** — contador de macros con buscador local en español, comidas del día, recientes y vista semanal. El plato de Pedir entra con un toque ("+ Añadir a mi diario", números exactos de `lineasLocales()`).
- **Entrenar** — registro de fuerza con biblioteca de ejercicios, rutinas, sesión en vivo y descanso automático al marcar serie (temporizador por hora de fin: exacto tras bloquear la pantalla).

Los datos del usuario viven SOLO en el dispositivo (`localStorage`, esquema versionado `cosecha.v1`, exportar/importar JSON).

## Estado al cierre (se actualiza)

| Pieza | Estado |
|---|---|
| Modo demo en producción | ✅ Publicado y verificado (0 contactos con n8n, plato completo) |
| Colapso src/↔raíz | ✅ En `main` |
| Shell 4 pestañas + Hoy | ✅ En `integracion` |
| js/almacen.js + js/temporizador.js | ✅ Integrados con sus tests |
| js/diario.js + js/entreno.js | ✅ Integrados; humo CDP del camino feliz completo en verde; **167 tests** |
| Base de alimentos (**1.495**: USDA CC0 + carta) | ✅ 100 % con fuente/id/licencia, 0 duplicados, 172 desvíos 4/4/9 marcados, ~2.130 porciones (las bebidas de la carta con su vaso real); **3 verificadores adversariales: 0 discrepancias**; round-trip Excel→JSON idéntico. Fuera: 15 bebidas con alcohol (la kcal 4/4/9 no cuenta el etanol) |
| Ejercicios (876, es-MX) + 10 rutinas | ✅ 1:1 con free-exercise-db, revisión de entrenador (9 correcciones); rutinas con 97 ids verificados, 0 rotos |
| Excel maestro | ✅ Versionado en `data/COSECHA_Base_Alimentos.xlsx` + [puntero en Drive](https://drive.google.com/file/d/1yqI7HJIjF7yItdDHdxsSMyHLXyV0GtQI/view). ⚠️ Bloqueo documentado: el conector de Drive exige el binario inline en base64 (258 K caracteres) — transcribirlo garantiza corrupción, así que el maestro queda en GitHub (versionado) y en Drive el puntero; arrastrarlo a Drive toma 10 s si se quiere la copia física |
| Cobertura WHOOP | ✅ `docs/cobertura-whoop.md`: 286 nombres públicos contrastados |
| **Progreso en Entrenar** (pedido de Roberto, 2-oct 12:56) | ✅ Publicado (`4d5123d`, 13:06) y verificado en la URL pública: pestaña «Progreso» con volumen promedio por sesión y % frente al periodo anterior (1 mes / 6 meses), sesiones, series y volumen total, gráfica de barras (SVG propio, resumen accesible) y récords personales por ejercicio; detalle por ejercicio con foto, top 3 récords con medalla (desplegables: series, reps totales, volumen, «Ver la sesión»), historial e instrucciones. En peso corporal se mide por repeticiones. 1RM Epley rotulado «estimado». 7 tests nuevos (179) |
| **Hoy cálida** (pedido de Roberto, 2-oct 12:20: «el inicio se siente vacío y frío») | ✅ Publicada (`a4c5fdb`, 12:32) y verificada en la URL pública: saludo según la hora y frase que cambia con tu día; tu día en un anillo (consumido · por comer · meta) sobre lavado `--ember`; acciones con iconos en círculos de color y subtítulos personales; «Tu semana» (comida y entrenos de 7 días); carrusel «Del menú COSECHA» con fotos reales (miniaturas de ~35 KB, carga perezosa) que deja el plato elegido en Pedir; bienvenida con foto para la primera visita. Solo tokens de la marca (el motor de diseño proponía lavanda + Lora: descartado por la regla de tokens); contraste AA medido en cada par nuevo |
| **Sesión de Entrenar de dos ventanas** (pedido de Roberto, 2-oct 11:06) | ✅ Publicada (`f247fb1`, 11:20) y verificada en la URL pública: «Sesión en vivo» con círculo de estado (Calentamiento → Activo → Descansar → Listo), un botón grande Empezar serie / Fin de la serie, tarjeta del ejercicio con foto, Serie X/N, reps y kg; «Ejercicios» con la lista editable y miniaturas; ficha técnica desde la sesión sin perder el descanso; filtros por músculo y equipo en la Biblioteca. Recargar en «Activo» conserva el tiempo (6 s medidos tras recargar). Patrón de experiencia de WHOOP **sin** frecuencia cardiaca ni zonas (dependen de su sensor: regla 4 del encargo) |
| Auditoría multi-rol | Ronda 1: 35 confirmados (3 S0) → arreglados. Ronda 2: 15 confirmados (0 S0, 3 S1) → arreglados. Ronda 3: **0 S0, 0 S1**, 14 S2 → arreglados (los 42 refutadores cayeron por falta de créditos: cada S2 lo verifiqué yo contra el código antes de arreglarlo; ninguno resultó falso). Ronda 4: 4 S1 + ~30 S2 → arreglados. Ronda 5 (110/110 agentes, sin caídas): **2 S1 + 28 S2** (≈18 defectos distintos tras deduplicar) → **todos arreglados** el 3-oct, verificados con 6 recorridos en Chrome y 185 tests. Quedan 47 S3 de pulido como backlog (ver abajo) |
| **Publicación** | ✅ **`main` publicado en Pages** (`ced3dce`, 2-oct 10:45) y verificado en la URL pública con recorridos CDP a 375 px: Hoy → perfil → Diario (alta) → Hoy refleja lo comido; Entrenar: CTA de perfil devuelve a Entrenar, rutinas plegables, ficha de ejercicio, palomear arranca el descanso, saltar se persiste, terminar → volver a la sesión; **0 peticiones a n8n** |

## Decisiones tomadas y por qué

1. **Merge del modo demo a `main` sin esperar OK** — la URL pública podía escribir pedidos reales; era un hueco de seguridad.
2. **Colapso de `src/`** — cada módulo nuevo se escribe una vez; Pages y tests ya usaban la raíz.
3. **Pantalla Hoy como entrada** (pedido de Roberto: "elegir entre entrenar, contar comida o pedir") — patrón de la referencia Matter.
4. **kcal consumidas derivadas 4P+4C+9G** — igual que la meta; el panel siempre cuadra (regla del proyecto).
5. **Datos localmente ricos, sin telemetría** — la regla 7 del encargo prohíbe backend/analítica en esta entrega. Lo registrado (comidas con hora y origen, sesiones serie a serie, perfil) es exportable; enviar telemetría opt-in a n8n/Sheets queda PROPUESTO aquí, no construido.
6. **Guarda del webhook dentro de `llamarCocina`** — ningún código futuro puede llamar a producción por accidente.
7. **Imágenes de ejercicios por CDN de free-exercise-db** (Unlicense), no en el repo — límite de 20 MB.
8. **INCMNSZ descartado** en esta entrega: no se confirmaron términos de reuso. Fuentes: USDA FDC (CC0), free-exercise-db (Unlicense), carta COSECHA (propia).

## Bitácora de incidentes

- **23:07** — Las dos flotas de agentes (datos y módulos) murieron ("Workflow aborted") sin aviso; lo detectó la sesión gemela revisando las transcripciones y lo verifiqué (ningún archivo avanzaba desde las 23:07). **23:26** — Relanzadas con resume sobre sus runId (lo completado vuelve de caché: almacén, temporizador, diseño, extracción USDA y descarga de ejercicios). Desde entonces siempre queda un vigilante en segundo plano que me re-despierta si un workflow vuelve a caerse en silencio.

## Auditoría

- Verificación continua de esta noche: tests (116 ✓), plato de punta a punta en la URL pública con registro de red (0 peticiones a n8n), línea base de rendimiento de Pedir (124 KB, DCL mediana 106 ms, `scratchpad/base-rendimiento-pedir.json`).
- Las flotas de datos llevan verificación adversarial integrada (muestras contra fuente, revisión de entrenador).
- Auditoría multi-rol completa (cumplimiento, nutrición, fuerza, UX, AA, marca, código, rendimiento, QA, licencias, producto): **pendiente de ejecutar como primer paso al retomar** — el corte de servicio de esta noche no da tiempo de correrla entera y arreglar lo confirmado. No se da por auditado lo que no lo está.

## Búsqueda del Diario (pedido de Roberto, 3-oct)

«Busco tortilla y salen tacos; pollo y sale un guisado». Antes el orden era alfabético dentro de cada grupo y lo raro salía primero. Ahora cada resultado se puntúa (nombre que empieza por lo buscado, variante de uso diario en México, ya cocinado, nombre simple; variantes raras restan) y los resultados van en tres secciones: **Alimentos → Platillos → Del menú COSECHA**, con «Ver N más». Verificado en la URL pública: «tortilla» abre con la de maíz y los tacos van a Platillos; «pollo» abre con pechuga, el mole y el guisado en Platillos.

## Backlog de pulido (S3 de la ronda 5, no bloquean el lanzamiento)

- qrcodejs desde cdnjs sin SRI (heredado de Pedir).
- La miniatura de la biblioteca baja el JPG completo del CDN (1,4–3,2 MB por búsqueda con muchas filas): generar miniaturas propias.
- Editar los macros de una entrada registrada a mano (hoy se mueve o se quita).
- Mayúsculas mezcladas en nombres de la base USDA (449 en minúscula).
- Botón para borrar todos los datos del dispositivo.

## Recomendaciones que NO apliqué (fuera de mi permiso)

- **Webhook de producción sin autenticación** (auditoría r4, licencias-2): `COCINA_URL` está en el JS público del repo original y el nodo Webhook de n8n no pide credencial; cualquiera puede mandar POST y gastar créditos del agente. En esta copia no hay riesgo (MODO_DEMO corta antes del fetch), pero en producción conviene añadir una cabecera secreta o validación de origen en n8n. El encargo prohíbe tocar n8n: lo dejo propuesto.
- **Pedir (flujo original)**: la auditoría pide acortar el paso 2 (la primera tarjeta queda una pantalla abajo), quitar "Te deja −93 g carbos" de las tarjetas y renombrar "Nueva consulta". No lo toqué porque el encargo pide Pedir intacto salvo el modo demo.

## Qué falta para lanzar

1. Correr la auditoría multi-rol y arreglar hallazgos confirmados (3 refutadores por hallazgo).
2. Si la base USDA no aterrizó esta noche: terminar `data/alimentos.json` (pipeline en agentes, `scripts/` reproducible) y subir `COSECHA_Base_Alimentos.xlsx` a Drive como fuente maestra.
3. Regresión CDP completa a 375 px de las 4 pestañas + prueba del temporizador con pestaña en segundo plano real.
4. Decisión de producto: telemetría opt-in (hoy prohibida por regla 7).
5. Vídeo/manual de uso si se quiere para el TFG o inversores.

## Cómo retomar

```bash
cd ~/cosecha-app-v4   # rama integracion
npm test              # 116 en verde al cierre de esta nota
npm run dev           # sirve la raíz en :3000
```
- Staging de agentes de esta noche (si quedó algo sin integrar): `/private/tmp/claude-501/-Users-robertoespejelr/059b22b8-cb82-4b48-b6c9-b7da67d7e29a/scratchpad/staging-modulos/` y `staging-datos/`.
- Reglas, arquitectura y gotchas: `CLAUDE.md`, `docs/diseno-modulos.md`, memoria del asistente (`feedback_protocolo_orquestacion`, proyectos COSECHA).
- Lo innegociable: original solo lectura; `MODO_DEMO=true`; cero secretos; sin datos nutricionales inventados ni contenido WHOOP; datos de salud solo en el dispositivo.
