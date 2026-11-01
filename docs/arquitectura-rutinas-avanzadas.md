# Rutinas avanzadas: reordenar, superseries y técnicas por serie

**Estado:** arquitectura aprobada por Roberto el 30-oct-2026 (decisiones en §8). Todavía no hay nada construido; se ejecuta por fases, cada una con su OK.
**Alcance:** el editor de «Crear / Editar rutina», la sesión en vivo, el historial y el progreso de la pestaña Entrenar.

---

## 0. De dónde partimos (hechos del código)

| Pieza | Estado hoy | Dónde |
|---|---|---|
| Superseries en los datos | **Ya existen.** Una rutina es `dias[].bloques[][]`; un bloque con 2 o más ejercicios es una superserie. Las rutinas COSECHA ya traen superseries | `data/rutinas.json`, `sesionARutina()` |
| Superseries en la sesión en vivo | **Ya funcionan.** Alterna por rondas (A1, B1, A2, B2…) y el descanso arranca solo al cerrar la ronda | `siguientePendiente()`, `debeArrancarDescanso()` |
| Superseries en el editor | Se **conservan** al editar (campo `grupo`), pero no se pueden crear ni separar | `borradorDesdeRutina()`, `rutinaDesdeBorrador()` |
| Reordenar ejercicios | No existe | — |
| Técnicas por serie | No existen. Cada serie guarda `{ reps, pesoKg, rir, hecha, tsHecha }` | `ejercicioDeSesion()` |
| Almacén | Tolerante: `tipar()` conserva los campos que no conoce, así que añadir campos nuevos no rompe los datos ni los respaldos viejos | `js/almacen.js` |

**Conclusión:** las superseries son, sobre todo, trabajo de interfaz. Las técnicas por serie son lo nuevo de verdad: tocan los datos, la sesión en vivo y los récords.

---

## 1. Reordenar manteniendo presionado

### Cómo se usa
- **Asa visible** (≡) a la izquierda de cada tarjeta, de 44×44 px. Además, **mantener presionada la tarjeta** 400 ms también la levanta.
- **Umbral de 8 px:** si el dedo se mueve antes de los 400 ms, es scroll, no arrastre. Así no se confunden los dos gestos.
- **Al levantarla,** la tarjeta crece un poco (1,02), gana sombra y vibra en Android. Safari en iPhone no permite vibrar desde la web.
- **Las demás tarjetas se apartan** en 200 ms, animando solo `transform` (regla de la app). Cerca del borde de la pantalla, la lista se desplaza sola.
- **Al soltar,** la tarjeta queda en su sitio y un lector de pantalla anuncia «Press de banca, posición 2 de 4».

### Alternativas sin gesto (obligatorias por accesibilidad)
- **Teclado:** el asa es un botón. Con Enter o Espacio se levanta, las flechas la mueven, Enter la suelta y Esc cancela.
- **Menú «⋯» de la tarjeta:** Subir, Bajar, Unir con el siguiente y Quitar. Sirve para VoiceOver y para quien no hace gestos largos.
  - *1-nov-2026:* «Quitar» salió del menú y es un botón visible «Quitar ejercicio» al pie de cada tarjeta, con doble toque (como en la sesión). Con un solo ejercicio el ⋯ no aparece.

### Reglas con superseries
- Arrastrar mueve **un** ejercicio. Si lo sueltas entre dos ejercicios de una superserie, se une a ella. Si lo sueltas fuera, queda suelto.
- Un paso con «⋯ › Subir/Bajar» o con las flechas **nunca** mete el ejercicio en otra superserie: la salta entera. Desde el borde de la suya, el primer paso lo saca de ella.
- Una superserie **entera** se mueve arrastrando su cabecera («Superserie A»).

### Técnica
- Pointer Events, que funcionan igual con dedo, ratón y lápiz.
- `touch-action: none` solo en el asa, para que el resto de la tarjeta siga permitiendo el scroll.
- Sin librerías externas.

```
┌──────────────────────────────────────────┐
│ ≡  Press de banca agarre medio  ⋯   ✕   │   ≡ = arrastrar · ⋯ = menú
│    Series (−) 3 (+)    Reps 8 – 12       │
└──────────────────────────────────────────┘
```

---

## 2. Superseries en el editor

- **Unir y separar:** entre dos tarjetas hay un botón con eslabón, «Unir». Dentro de una superserie, el mismo botón dice «Separar».
- **Cómo se ve:** barra de color a la izquierda, cabecera «Superserie A · 2 ejercicios» y etiquetas **A1, A2**. Nunca solo color.
- **Tamaño:** de 2 a 4 ejercicios. Con más, ya es un circuito.
- **Series distintas:** si los ejercicios tienen distinto número de series, se hacen tantas rondas como la mayor. La sesión ya funciona así.
- **Descanso:** se descansa al cerrar cada ronda; entre los ejercicios de la ronda no hay descanso. La sesión ya funciona así, y el descanso que eliges al empezar se aplica a la ronda.

```
┃ SUPERSERIE A · 2 ejercicios                 ┃ = barra de color
┃ ┌───────────────────────────────────────┐
┃ │ ≡ A1  Press de banca          ⋯   ✕   │
┃ └───────────────────────────────────────┘
┃            [ 🔗 Separar ]
┃ ┌───────────────────────────────────────┐
┃ │ ≡ A2  Remo con barra          ⋯   ✕   │
┃ └───────────────────────────────────────┘
             [ 🔗 Unir ]
  ┌───────────────────────────────────────┐
  │ ≡     Elevación lateral       ⋯   ✕   │
  └───────────────────────────────────────┘
```
(El eslabón se dibuja con un ícono SVG, nunca con emoji.)

---

## 3. Técnicas por serie

La **superserie** agrupa *ejercicios*. Una **técnica** cambia cómo se hace *una serie*. Son cosas distintas y la interfaz las separa.

### Técnicas propuestas para el piloto

| Técnica | Insignia | Qué es | Parámetros (por defecto, editables) | En la sesión en vivo | Volumen y récords |
|---|---|---|---|---|---|
| Normal | — | Serie normal | — | Igual que hoy | Cuenta |
| Calentamiento | **W** | Serie ligera de aproximación | — | Insignia W; descanso corto | **No cuenta** en volumen ni en récords |
| Rest-pause | **RP** | Llegas al fallo, descansas unos segundos y haces mini-series con el mismo peso | 2 mini-series · 15 s de micro-descanso | Tras «Fin de la serie», el círculo cuenta 15 s («Micro-descanso»). Luego «Mini-serie 1/2», con su propio botón. Al terminar, descanso normal | El volumen suma todas las reps. El récord (1RM estimado) usa **solo la parte principal** |
| Drop set | **D** | Bajas el peso sin descansar y sigues | 1 bajada · −20 % | Tras la serie, el círculo dice «Baja a 48 kg» (redondeado a 2,5 kg o 5 lb). Sin descanso; anotas las reps de la bajada | Igual que rest-pause |

**Para después del piloto:** «Al fallo», myo-reps, clusters y 21s.

### En el editor (revelación progresiva)
- **La tarjeta no cambia:** sigue con Series (−) 3 (+) y Reps 8–12.
- **Debajo, una fila de «píldoras»,** una por serie: `[1] [2] [3 RP]`.
- **Tocar una píldora** abre una **hoja inferior** con:
  - la lista de técnicas, de la que se elige una;
  - sus parámetros;
  - «Aplicar a todas las series de este ejercicio».
- **La hoja se cierra** con la X, deslizando hacia abajo o tocando fuera. Si hay cambios, no se pierden al cerrar.
- **Atajo «+ Calentamiento»:** añade una serie W al principio.

```
┌──────────────────────────────────────────┐
│ ≡  Sentadilla - Barra          ⋯   ✕    │
│    Series (−) 4 (+)    Reps 6 – 8        │
│    [W] [2] [3] [4 RP]                    │  ← tocar una píldora
└──────────────────────────────────────────┘
╭──────────── Serie 4 ────────────── ✕ ╮
│ ○ Normal                             │
│ ○ Calentamiento                      │
│ ● Rest-pause                         │
│     Mini-series (−) 2 (+)            │
│     Micro-descanso (−) 15 s (+)      │
│ ○ Drop set                           │
│ [ ] Aplicar a todas las series       │
│ [        Listo        ]              │
╰──────────────────────────────────────╯
```

### En la sesión en vivo
- **El círculo no se mueve** (la regla del 30-oct). Solo cambian su rótulo y su color:
  - `REST-PAUSE · MINI 1/2`;
  - `MICRO-DESCANSO`;
  - `DROP · BAJA A 48 KG`.
- **La tarjeta del ejercicio** muestra la insignia (W, RP, D) junto a «Serie 3/4».
- **En la lista «Ejercicios»,** cada serie muestra su insignia y sus partes: `8 + 3 + 2 RP`.
- **Historial y resumen** usan el mismo formato.

---

## 4. Contrato de datos

**En la rutina (plantilla),** cada ejercicio del bloque gana un `plan` **opcional**, con una entrada por serie. Si no tiene `plan`, todas las series son normales. Así siguen valiendo las rutinas guardadas y las rutinas COSECHA, sin migrarlas.

```js
{ idEjercicio, nombre, series: 4, repsMin: 6, repsMax: 8, descansoS: 90,
  plan: [ { tipo: 'calentamiento' }, { tipo: 'normal' }, { tipo: 'normal' },
          { tipo: 'restpause', mini: 2, microS: 15 } ] }
```

**En la sesión, cada serie** gana `tipo` y `partes`:

```js
{ reps: 8,  pesoKg: 60, hecha: true, tipo: 'restpause', partes: [{ reps: 3 }, { reps: 2 }] }   // mismo peso
{ reps: 10, pesoKg: 60, hecha: true, tipo: 'drop',      partes: [{ reps: 8, pesoKg: 48 }] }
{ reps: 12, pesoKg: 20, hecha: true, tipo: 'calentamiento' }
```

**Reglas del contrato:**
- `series` siempre es igual a `plan.length`. El editor los mantiene juntos: «+» añade una serie normal al final y «−» quita la última.
- `tipo` falta o no se reconoce → se trata como `'normal'`.
- `partes` solo existe en `restpause` y `drop`, y se sanea en el almacén (máximo 5 partes; las reps no pueden ser negativas).
- No cambia la versión del esquema (`cosecha.v1` es tolerante). Los respaldos viejos se leen como «todo normal».

---

## 5. Qué funciones cambian (todas puras y con pruebas)

| Función | Cambio |
|---|---|
| `volumenSesion` | Ignora el calentamiento y suma las partes |
| `mejorSerie`, `recordsEjercicio`, `prsPorEjercicio`, `estadisticasPeriodo` | Ignoran el calentamiento; el 1RM usa solo la parte principal |
| `siguientePendiente`, `debeArrancarDescanso` | Sin cambios en las series. Nueva función `siguientePaso(serie)` que devuelve `'micro' \| 'mini' \| 'drop' \| 'fin'` |
| `estadoFoco` | Dos estados nuevos: `micro` (micro-descanso) y `parte` (mini-serie o bajada) |
| `sesionARutina` («Guardar como rutina») | Copia `tipo` a `plan` |
| `borradorDesdeRutina` / `rutinaDesdeBorrador` | Llevan y traen `plan` |
| `TIPOS_SERIE` (almacén) | Añade `tipo` (por defecto `'normal'`) y sanea `partes` |

---

## 6. Riesgos

1. **Gesto largo contra scroll en iPhone.** Se mitiga con el umbral de 8 px y el asa. Hay que probarlo en un iPhone real, no solo en Chrome.
2. **Choque de nombres.** El círculo decía «CALENTAMIENTO» antes de la primera serie, y eso chocaba con «serie de calentamiento». Hecho: el estado inicial se llama «PREPARADO».
3. **La sesión en vivo es lo más delicado.** Rest-pause y drop set le añaden dos estados. Cada transición lleva su prueba, y hay que repetir el recorrido completo antes de publicar.
4. **Técnicas dentro de una superserie.** Se permiten, pero la ronda espera a que termines las partes antes de pasar al siguiente ejercicio.
5. **Recargar en mitad de un rest-pause.** El micro-descanso se guarda por hora de fin, como el descanso normal, así que sobrevive a bloquear la pantalla y a recargar.

---

## 7. Plan de ejecución

Cada fase se publica por separado, con su OK.

| Fase | Qué | Riesgo |
|---|---|---|
| **1** ✅ | Reordenar: asa, mantener presionado, teclado y menú Subir/Bajar (publicada el 30-oct) | Bajo |
| **2** ✅ | Superseries en el editor: Unir/Separar, A1/A2 y arrastrar la cabecera. Reusa la sesión en vivo de hoy (publicada el 30-oct, tras revisión adversarial) | Bajo |
| **3** ✅ | Técnicas, parte de datos y editor: píldoras, hoja y `plan`. Corrige volumen y récords (publicada el 30-oct con la 4) | Medio |
| **4** ✅ | Técnicas, parte de la sesión en vivo: micro-descanso, mini-series, bajadas, historial y resumen (publicada el 30-oct, tras revisión adversarial) | Medio-alto |

**En cada fase:**
- pruebas de las funciones puras;
- recorrido en Chrome a 375 y 320 px, más horizontal;
- revisión de la guía de UI/UX: 44 px, contraste, foco, `reduced-motion` y alternativa a cada gesto;
- publicación tras el OK.

---

## 8. Decisiones (Roberto, 30-oct-2026)

> **Cambio del 31-oct-2026:** se quitó el Calentamiento (W). No se puede elegir y las rutinas que lo tenían pierden esas series (`sinCalentamientos`). Las sesiones viejas con W siguen sin contar. Peso y reps pasan a ser opcionales en el foco. Lo que este documento dice de la W queda como historia.

1. **Técnicas del piloto:** Calentamiento, Rest-pause y Drop set. «Al fallo» queda para después.
2. **Parámetros:** editables, con valores por defecto (RP: 2 mini-series y 15 s; Drop: 1 bajada y −20 %).
3. **Récords:** el calentamiento no cuenta; RP y drop suman volumen, pero el récord (1RM estimado) usa solo la serie principal.
4. **Superseries:** de 2 a 4 ejercicios.
