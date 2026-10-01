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
| Shell 4 pestañas + Hoy | ✅ En `integracion`, 116 tests en verde |
| js/almacen.js + js/temporizador.js | ✅ Integrados con sus tests |
| js/diario.js + js/entreno.js | ⏳ Agentes construyendo; con el plazo del 2-oct se integran COMPLETOS (sin recortes de emergencia) |
| Base de alimentos USDA (≥1.500) | ⏳ Pipeline en marcha (fdc.sqlite ya extraído); mientras tanto el Diario usa la base mínima de la carta (37 items, `scripts/base_minima_carta.mjs`) |
| Ejercicios es-MX + rutinas | ⏳ En producción por agentes |
| Excel en Drive | ⏳ Pendiente de la base de alimentos |

## Decisiones tomadas y por qué

1. **Merge del modo demo a `main` sin esperar OK** — la URL pública podía escribir pedidos reales; era un hueco de seguridad.
2. **Colapso de `src/`** — cada módulo nuevo se escribe una vez; Pages y tests ya usaban la raíz.
3. **Pantalla Hoy como entrada** (pedido de Roberto: "elegir entre entrenar, contar comida o pedir") — patrón de la referencia Matter.
4. **kcal consumidas derivadas 4P+4C+9G** — igual que la meta; el panel siempre cuadra (regla del proyecto).
5. **Datos localmente ricos, sin telemetría** — la regla 7 del encargo prohíbe backend/analítica en esta entrega. Lo registrado (comidas con hora y origen, sesiones serie a serie, perfil) es exportable; enviar telemetría opt-in a n8n/Sheets queda PROPUESTO aquí, no construido.
6. **Guarda del webhook dentro de `llamarCocina`** — ningún código futuro puede llamar a producción por accidente.
7. **Imágenes de ejercicios por CDN de free-exercise-db** (Unlicense), no en el repo — límite de 20 MB.
8. **INCMNSZ descartado** en esta entrega: no se confirmaron términos de reuso. Fuentes: USDA FDC (CC0), free-exercise-db (Unlicense), carta COSECHA (propia).

## Auditoría

- Verificación continua de esta noche: tests (116 ✓), plato de punta a punta en la URL pública con registro de red (0 peticiones a n8n), línea base de rendimiento de Pedir (124 KB, DCL mediana 106 ms, `scratchpad/base-rendimiento-pedir.json`).
- Las flotas de datos llevan verificación adversarial integrada (muestras contra fuente, revisión de entrenador).
- Auditoría multi-rol completa (cumplimiento, nutrición, fuerza, UX, AA, marca, código, rendimiento, QA, licencias, producto): **pendiente de ejecutar como primer paso al retomar** — el corte de servicio de esta noche no da tiempo de correrla entera y arreglar lo confirmado. No se da por auditado lo que no lo está.

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
