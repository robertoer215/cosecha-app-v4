# Diseño de módulos — Diario y Entrenar

Documento de diseño de los dos módulos nuevos de COSECHA App. Los demás agentes
codean contra lo que dice aquí: la API de `js/almacen.js` es contrato cerrado
(sección 8) y las decisiones de UX llevan su porqué para que nadie las deshaga
sin saber qué rompe.

Contexto de marca: `CLAUDE.md` y `css/styles.css` del repo. La app es el canal
digital de un restaurante fast-casual saludable: el flujo "Pedir" (armar plato →
porcionado por IA → QR a cocina) ya existe y NO se toca. Diario y Entrenar se
suman alrededor, con la misma paleta crema + naranja, Inter + IBM Plex Mono,
español de México y tuteo.

Índice:

1. Benchmark del diario (MyFitnessPal, MacroFactor, Cronometer, Fitia)
2. Benchmark de entrenamiento (WHOOP Strength Trainer, Hevy/Strong)
3. Navegación: barra inferior de 3 pestañas
4. Wireframes de baja fidelidad
5. Modelo de datos local versionado, migraciones y exportar/importar
6. Decisión: kcal consumidas derivadas 4P+4C+9G
7. Tokens nuevos necesarios: ninguno
8. API exacta de `js/almacen.js` (contrato)
9. Fuentes

---

## 1 · Benchmark del diario

Criterio de lectura: COSECHA no compite con estas apps; les roba los patrones
que sirven a UN caso de uso — cerrar la meta de macros del día, con el plato
del restaurante como protagonista — y descarta todo lo que existe para retener
usuarios de una suscripción que nosotros no vendemos.

### MyFitnessPal

| | Patrón | Por qué |
|---|---|---|
| **Adoptamos** | El día partido en comidas con subtotal por comida y "restante" arriba | Es el modelo mental universal del diario desde 2009; nuestro estado ya nace así (`diario[fecha].desayuno/comida/cena/colaciones`) y la meta de COSECHA es POR COMIDA, así que el subtotal por comida no es decoración: es la unidad real de la meta. |
| **Adoptamos** | Recientes primero en el buscador | En MFP el 80 % de los registros son repeticiones. `recientes.alimentos` (tope 30) existe en el esquema exactamente para esto. |
| **Descartamos** | Base de alimentos crowdsourced | Su defecto más citado: entradas duplicadas y macros inventados. Nuestra base es chica y VERIFICADA (data.js sale del costeo real) y los platos del restaurante entran con los macros del motor (`origen:'plato'`). Mejor 40 alimentos correctos que 14 millones dudosos. |
| **Descartamos** | "Calorías ganadas" por ejercicio que inflan el presupuesto del día | Mezcla dos cuentas con errores distintos y rompe la regla de negocio: la meta SIEMPRE sale de `calcularMeta()`/manual. Entrenar registra trabajo, no descuenta comida. |
| **Descartamos** | Rachas con presión, feed social, anuncios, funciones básicas tras muro de pago (el escáner de código pasó a premium) | Nada de eso acerca al usuario a su meta; todo existe para el modelo de suscripción. COSECHA es gratuita y sin cuentas. |

### MacroFactor

| | Patrón | Por qué |
|---|---|---|
| **Adoptamos** | Jerarquía macro-first: proteína/carbos/grasas como cifras de primer nivel, kcal como derivada | Es exactamente nuestra regla de negocio (las kcal de la meta se derivan 4P+4C+9G de los macros redondeados). MacroFactor demuestra que un diario puede cuadrar siempre; ver sección 6. |
| **Adoptamos** | Registro ultrarrápido y sin fricción (se venden como "el logger más rápido del mercado", y en 2026 lo llevaron hasta el Apple Watch) | El estándar de velocidad a copiar: agregar un alimento reciente debe ser 2 toques (buscador → tarjeta). Sin modales encadenados. |
| **Adoptamos** | Tono neutral, sin regaños | MacroFactor no pinta el día de rojo moral por pasarse. Nosotros igual: el color dice en meta / fuera de meta (regla ya escrita en styles.css para `.gap-num`) y la dirección la dicen las palabras. |
| **Descartamos** | Coaching dinámico (ajuste semanal de la meta según gasto energético estimado) | Exige pesaje diario y un algoritmo de expenditure propio. Nuestra meta es determinista y auditable (`calcularMeta()`, Mifflin-St Jeor); meter una segunda fuente de meta viola la regla dura del proyecto. |
| **Descartamos** | Premium-only | COSECHA no cobra la app. |

### Cronometer

| | Patrón | Por qué |
|---|---|---|
| **Adoptamos** | Rigor del dato: cada entrada sabe de dónde viene | Nuestro `origen: 'base'|'plato'` es la versión mínima de su trazabilidad de fuentes, y `kcalFuente` conserva el dato de etiqueta aunque pintemos la derivada (sección 6). |
| **Adoptamos** | Honestidad con los desvíos: si la etiqueta no cuadra con los macros, se dice | De aquí sale la marca de desvío >15 % (sección 6). CLAUDE.md ya documenta que las kcal de etiqueta de data.js traen hasta ±9.5 kcal por item contra 4/4/9: el problema es real y conocido. |
| **Descartamos** | Los 80+ micronutrientes y la densidad de tabla | Nuestro caso de uso es cerrar 3 macros, no auditar selenio. Cada columna extra compite con la legibilidad a 375 px. |
| **Descartamos** | UI de origen web/escritorio | COSECHA es móvil primero; el gutter, las reservas anti-salto y los targets de 44 px ya están medidos a 375 px. |

### Fitia (referente latam)

| | Patrón | Por qué |
|---|---|---|
| **Adoptamos** | Español latam nativo con tuteo y alimentos con nombres de la región | Es la única de las cuatro que no se siente traducida. Nuestros textos ya son es-MX con tuteo; el diario sigue igual ("Te faltan 23 g de proteína hoy", nunca "Usted ha consumido"). |
| **Adoptamos** | La comida (no el alimento suelto) como unidad de plan: meta por comida con su "restante" propio | Coincide con nuestro modelo: `metaCache` es POR COMIDA. El diario enseña restante por comida Y del día. |
| **Adoptamos** | `comidaPorHora()`: al abrir el registro, la comida propuesta es la que toca por hora | Fitia preselecciona la comida según la hora y se siente "listo"; los cortes 11:30 / 17:00 / 22:00 son horario de México, no de gringolandia (la comida fuerte es a las 2–3 pm). |
| **Descartamos** | Planificador de comidas con IA + lista de súper (su premium) | Fuera de alcance: COSECHA ya tiene SU inteligencia (el porcionado del plato) y el diario es registro, no prescripción. |
| **Descartamos** | Freemium con funciones capadas | Mismo motivo que MFP/MacroFactor. |

---

## 2 · Benchmark de entrenamiento

### WHOOP Strength Trainer

Lo que hace bien y copiamos:

- **Biblioteca → rutina → sesión → resumen** como columna vertebral. Cuatro
  pantallas, cada una con un trabajo.
- **Superseries** como bloque de primera clase dentro de la rutina (no un hack
  de "ejercicio A/B" como en apps viejas).
- **Resumen de sesión** con volumen total, series completadas y duración: el
  cierre emocional de la sesión. Nosotros además lo guardamos en
  `entreno.sesiones` y alimenta el historial.
- **Validar la serie** como gesto central: una serie no "existe" hasta que la
  palomeas con reps y peso reales.

Su queja recurrente en la comunidad (2026, hilos de community.whoop.com, ver
fuentes): **el descanso entre series**. Dos fallas concretas que los usuarios
repiten hilo tras hilo:

1. El temporizador **no arranca solo** al validar la serie: hay que lanzarlo a
   mano, y si se te olvida, el descanso se te pasa sin darte cuenta.
2. **Avisa mal al terminar**: sin alerta clara (sonido/vibración) la gente
   sigue sentada mirando Instagram. Varios confiesan que siguen usando Strong
   nada más por el timer.

Nuestra respuesta de diseño (es LA decisión del módulo Entrenar):

- Palomear la serie **arranca el descanso automáticamente**, con la duración
  del ejercicio (`descanso` del bloque, editable). Cero gestos extra.
- El descanso vive en una **barra fija inferior** (encima de la barra de
  pestañas) con cuenta regresiva grande, botones **−15 s / +15 s / Saltar**.
- Al terminar: la barra **cambia de estado de forma inconfundible** (fondo
  pasa a `--green` con texto blanco, el rótulo pasa a "¡A darle!") y se dispara
  `navigator.vibrate(200)` dentro de try/catch — iOS Safari no lo soporta y no
  pasa nada: el cambio visual es el aviso primario, la vibración es refuerzo.
  Sin sonido por defecto: en un gimnasio con audífonos un beep de la web es
  ruido; y con `prefers-reduced-motion` el cambio es instantáneo (el barrido
  global de styles.css ya apaga toda transición).
- **El tiempo se calcula contra timestamps, nunca con un contador**: el estado
  guarda `{ inicio: ts, duracion: s }` y cada render pinta
  `restante = duracion − (Date.now() − inicio)/1000`. Porqué: el navegador
  throttlea los timers en segundo plano (pantalla bloqueada, cambio de app) y
  un `setInterval` que resta 1 se atrasa minutos; contra timestamp, al volver
  con `visibilitychange` el tiempo es el correcto. Además así el descanso
  sobrevive un reload: `sesionActiva` se persiste en cada cambio.

### Hevy / Strong (el patrón de temporizador que adoptamos)

Es el estándar de facto que la propia comunidad de WHOOP pide: descanso
**configurable por ejercicio** con un default sensato (90 s), que arranca al
validar la serie, visible siempre (no un modal que tapa la tabla de series),
ajustable en caliente con ±15 s, y saltable sin castigo. También les copiamos
la **tabla de series editable en vivo** (fila = serie; columnas: previa, kg,
reps, palomita) con la serie anterior como placeholder de referencia — el dato
"qué hice la vez pasada" es el 90 % del valor de registrar.

De Hevy descartamos el feed social y los PRs con confeti; de Strong, el muro
de pago por rutinas ilimitadas. Nuestras rutinas son ilimitadas y locales.

---

## 3 · Navegación: barra inferior fija de 3 pestañas

```
┌──────────────────────────────┐
│  [svg] Pedir  [svg] Diario  [svg] Entrenar  │  ← fija abajo
└──────────────────────────────┘
```

**Por qué barra inferior y no otra cosa:**

- **Tres contextos reales, no tres vistas de lo mismo.** Pedir (en el
  restaurante, decidiendo), Diario (en cualquier momento, consultando),
  Entrenar (en el gimnasio, con las manos ocupadas). El usuario salta entre
  ellos en la misma visita; un menú hamburguesa esconde ese salto y las
  pestañas superiores pelean con el tracker sticky que YA vive arriba
  (`.global-tracker`, z-index 100).
- **Zona del pulgar.** Entrenar se usa con una mano y entre series; abajo es
  el único sitio alcanzable en un teléfono de 6.5".
- **Es el estándar que las cuatro apps del benchmark usan.** Cero aprendizaje.
- **Tres y no más**: con 3 ítems cada target queda en ~125 px de ancho a
  375 px, muy por encima de los 44 px mínimos. El perfil NO es pestaña: vive
  dentro de Pedir (ya existe como paso) y Diario enlaza a él para editar meta.

**Reglas de implementación** (quien codee la barra, contra esto):

- `<nav>` con 3 `<button>` (no `<a>`: no hay rutas, es SPA de un HTML),
  `aria-current="page"` en la activa, targets ≥44 px de alto.
- Fondo `--surface`, filete superior 1px `--border-strong` (misma pareja que
  el tracker sticky usa arriba: la app queda enmarcada por las dos bandas),
  ítem activo en `--accent-ink`, inactivo en `--muted-ink` — ambos pasan AA
  sobre `--surface` (5,04:1 y 7,0:1 aprox; los números del :root ya están
  auditados en styles.css).
- Iconos **SVG inline** de trazo (24×24, `stroke="currentColor"`): plato/bowl,
  libreta/lista, mancuerna. Nunca emoji.
- `position:fixed; bottom:0` + `padding-bottom:env(safe-area-inset-bottom)`;
  el contenedor `.app` sube su `padding-bottom` para que nada quede debajo
  (hoy son 64 px; pasa a 64 px + alto de barra).
- z-index por encima del tracker (100) y del contenido: 110. La barra de
  descanso de Entrenar se monta ENCIMA de la de pestañas (120) para no
  taparle los targets: se apilan, no se superponen.
- Cambiar de pestaña NO destruye estado: Pedir conserva su plato a medias,
  Entrenar su sesión activa (además persistida en `sesionActiva`).

---

## 4 · Wireframes de baja fidelidad

Convenciones: ancho ~375 px, `[ ]` = control, `▓` = barra de progreso,
`(svg)` = icono inline. La barra inferior de pestañas aparece solo en el
primer wireframe; está en todas.

### 4.1 Diario del día

```
+-----------------------------------+
| COSECHA·                          |
|-----------------------------------|
| HOY · MIE 1 OCT          [ < > ]  |
|                                   |
| TU DIA                            |
| Prot  ▓▓▓▓▓▓▓░░░  96/130 g       |
| Carb  ▓▓▓▓▓░░░░░  110/210 g      |
| Gras  ▓▓▓▓▓▓▓▓░░   48/58 g       |
| 1,250 kcal · te quedan 627        |
|-----------------------------------|
| DESAYUNO           412 kcal  [+]  |
|  Avena con fruta      320 kcal    |
|  Cafe con leche        92 kcal    |
|-----------------------------------|
| COMIDA             838 kcal  [+]  |
|  Plato Cosecha (QR)   838 kcal    |
|  salmon · camote · brocoli        |
|-----------------------------------|
| CENA                    —    [+]  |
|  Aun no registras nada            |
|-----------------------------------|
| COLACIONES              —    [+]  |
|-----------------------------------|
| [ Ver semana ]                    |
+-----------------------------------+
| (svg)Pedir (svg)Diario (svg)Entr. |
+-----------------------------------+
```

Notas: las tres barras reutilizan el patrón visual del tracker
(`.bar-bg`/`.bar-fill` con `scaleX`, canales `--green`/`--blue`/`--amber`).
`[+]` de cada comida abre el buscador con esa comida preseleccionada; el `[+]`
flotante no existe: la comida es el contexto, como en Fitia. Tocar una entrada
abre su detalle (editar gramos / quitar). La meta del día = `metaCache` ×
número de comidas del diario (`perfil.comidasDiario ?? perfil.comidas`).

### 4.2 Buscador de alimentos

```
+-----------------------------------+
| <  Agregar a COMIDA               |
|-----------------------------------|
| [ Buscar alimento...        (svg)]|
|-----------------------------------|
| RECIENTES                         |
|  Avena con fruta    320 kcal  [+] |
|  Plato Cosecha      838 kcal  [+] |
|  Manzana             95 kcal  [+] |
|-----------------------------------|
| BASE COSECHA                      |
|  Salmon a la plancha          [+] |
|   P23 C0 G14 · 100 g              |
|  Arroz integral               [+] |
|   P3 C33 G1 · 120 g               |
|  ...                              |
+-----------------------------------+
```

Notas: recientes primero (MFP/MacroFactor); `[+]` agrega DIRECTO con la
porción default (2 toques en total) y muestra un "deshacer" de 4 s en vez de
pedir confirmación; tocar el nombre abre el detalle para ajustar gramos. La
comida destino se hereda de dónde se abrió, o de `comidaPorHora()` si se abre
sin contexto.

### 4.3 Detalle de alimento

```
+-----------------------------------+
| <  Salmon a la plancha            |
|-----------------------------------|
| PORCION                           |
| [ 100 ] g   [1/2][1][1.5][2]      |
|-----------------------------------|
| P 23 g   C 0 g   G 14 g           |
| 218 kcal (derivadas)              |
|  Etiqueta: 208 kcal               |
|-----------------------------------|
| COMIDA                            |
| [Desayuno][COMIDA][Cena][Colac.]  |
|-----------------------------------|
| [       Agregar a comida        ] |
+-----------------------------------+
```

Notas: los macros se recalculan en vivo al cambiar gramos; las kcal mostradas
son SIEMPRE las derivadas (sección 6); la línea "Etiqueta:" solo aparece si
difiere, y si difiere >15 % lleva la marca de desvío. Los multiplicadores
rápidos reutilizan el patrón de píldoras de tamaño del flujo Pedir. En modo
edición el CTA dice "Guardar cambios" y aparece "Quitar del diario" en
`--danger`.

### 4.4 Vista semanal

```
+-----------------------------------+
| <  Tu semana        29 SEP–5 OCT  |
|-----------------------------------|
| PROTEINA (g)          meta 130    |
| L   ▓▓▓▓▓▓▓▓░░ 118               |
| M   ▓▓▓▓▓▓▓▓▓▓ 131  ✓            |
| M   ▓▓▓▓▓▓▓░░░  96  ← hoy        |
| J   ░░░░░░░░░░   —               |
| ...                               |
| [Proteina][Carbs][Grasas][Kcal]   |
|-----------------------------------|
| PROMEDIO: 115 g/dia · 4 de 7 dias |
| en meta esta semana               |
+-----------------------------------+
```

Notas: una métrica a la vez (toggle de píldoras, patrón `.sub-toggle`), no
cuatro columnas apretadas: a 375 px la comparación día-a-día de UNA métrica se
lee; la tabla completa no. Día en meta = dentro de ±4 g (los umbrales del
resumen de Pedir, mismas reglas). Sin racha gamificada: el dato es "4 de 7",
nunca "¡no rompas tu racha!".

### 4.5 Biblioteca de ejercicios

```
+-----------------------------------+
| ENTRENAR                          |
| [Biblioteca][Rutinas][Historial]  |
|-----------------------------------|
| [ Buscar ejercicio...       (svg)]|
| [Todos][Pecho][Espalda][Pierna]…  |
|-----------------------------------|
| RECIENTES                         |
|  Press banca        barra    [+]  |
|  Sentadilla         barra    [+]  |
|-----------------------------------|
| PECHO                             |
|  Press banca        barra    [+]  |
|  Press inclinado    mancrna  [+]  |
|  Aperturas          polea    [+]  |
+-----------------------------------+
```

Notas: mismo esqueleto que el buscador de alimentos a propósito (aprender uno
es aprender los dos). `recientes.ejercicios` alimenta el bloque de arriba.
`[+]` en contexto de edición de rutina agrega a la rutina; fuera de contexto
abre "Empezar sesión libre con este ejercicio".

### 4.6 Rutinas

```
+-----------------------------------+
| ENTRENAR                          |
| [Biblioteca][RUTINAS][Historial]  |
|-----------------------------------|
| [ + Nueva rutina ]                |
|-----------------------------------|
| Empuje A                          |
|  4 ejercicios · 1 superserie      |
|  ultima vez: hace 3 dias          |
|  [ Empezar ]  [ Editar ]          |
|-----------------------------------|
| Pierna                            |
|  5 ejercicios                     |
|  ultima vez: hace 6 dias          |
|  [ Empezar ]  [ Editar ]          |
+-----------------------------------+
```

Notas: la tarjeta dice lo necesario para elegir (contenido + última vez);
"Empezar" crea la `sesionActiva` precargada con la plantilla de series de la
rutina y los pesos de la última sesión de esa rutina como referencia. En
Editar, los ejercicios se reordenan y dos contiguos se agrupan en superserie
(patrón WHOOP), con descanso por bloque.

### 4.7 Sesión en vivo (con descanso corriendo)

```
+-----------------------------------+
| Empuje A              00:23:41    |
|-----------------------------------|
| PRESS BANCA         descanso 90s  |
|  SERIE  PREVIA   KG    REPS   ✓   |
|   1     60x8    [60]   [8]   [✓]  |
|   2     60x8    [60]   [8]   [✓]  |
|   3     60x7    [62]   [ ]   [ ]  |
|  [ + serie ]                      |
|-----------------------------------|
| SUPERSERIE                        |
|  LATERALES + FACE PULL            |
|  ...                              |
|-----------------------------------|
| [ Terminar sesion ]               |
+-----------------------------------+
| DESCANSO   1:12   [-15][+15][>>]  |  ← barra fija, nace al palomear
+-----------------------------------+
```

Y al llegar a cero, la misma barra (misma caja, solo cambia el contenido y el
fondo pasa a `--green`):

```
+-----------------------------------+
| ¡A DARLE!  serie 3 de press banca |
+-----------------------------------+
```

Notas: la palomita valida la serie Y arranca el descanso (la respuesta a la
queja de WHOOP). La columna PREVIA es dato de la última sesión, pintado como
referencia (placeholder-style, `--muted-ink`), nunca pre-palomeado. La barra
de descanso mide lo mismo en los dos estados: cambia contenido, nunca la caja
(regla anti-salto de toda la app). "Terminar sesión" pide confirmación solo si
hay series sin palomear.

### 4.8 Resumen de sesión

```
+-----------------------------------+
| SESION COMPLETA                   |
| Empuje A · mie 1 oct              |
|-----------------------------------|
|  47 min   ·   14 series           |
|  3,240 kg de volumen total        |
|-----------------------------------|
| PRESS BANCA                       |
|  60x8 · 60x8 · 62x7               |
| LATERALES                         |
|  10x12 · 10x12 · 10x10            |
| ...                               |
|-----------------------------------|
| NOTAS                             |
| [ ¿Como te sentiste?            ] |
|-----------------------------------|
| [         Guardar sesion        ] |
+-----------------------------------+
```

Notas: el resumen es el patrón de WHOOP que sí funciona: cierre con los tres
números que importan (duración, series, volumen). "Guardar sesión" llama
`cerrarSesion()` (mueve a `entreno.sesiones`, limpia `sesionActiva`). El
volumen = Σ kg × reps de series palomeadas; los ejercicios de solo-reps o
tiempo no suman volumen y no estorban.

### 4.9 Historial

```
+-----------------------------------+
| ENTRENAR                          |
| [Biblioteca][Rutinas][HISTORIAL]  |
|-----------------------------------|
| ESTA SEMANA · 2 sesiones          |
|-----------------------------------|
| MIE 1 OCT                         |
|  Empuje A                         |
|  47 min · 14 series · 3,240 kg    |
|-----------------------------------|
| LUN 29 SEP                        |
|  Pierna                           |
|  52 min · 16 series · 4,810 kg    |
|-----------------------------------|
| SEMANA PASADA · 3 sesiones        |
|  ...                              |
+-----------------------------------+
```

Notas: lista inversa agrupada por semana; tocar una sesión abre su resumen
(misma pantalla 4.8 en modo lectura). Sin gráficas de PRs en v1: el historial
honesto ya responde "¿estoy entrenando?"; las curvas de fuerza son v2.

---

## 5 · Modelo de datos local versionado

Todo el estado de Diario y Entrenar vive en `localStorage` bajo UNA clave
versionada, a través de `js/almacen.js` y de nadie más. Ningún módulo toca
`localStorage` directo: así la migración, el try/catch y el export viven en un
solo lugar.

### Esquema v1 (`VERSION = 1`, `CLAVE = 'cosecha.v1'`)

```js
{ v: 1,
  perfil: null | { sexo, edad, peso, altura, actividad, objetivo, comidas,
                   unidadPeso: 'kg'|'lb', comidasDiario: null|number,
                   actualizado: ts },
  metaCache: null | { kcal, prot, carb, gras, comidas, origen },
  // POR COMIDA, la escribe app.js desde calcularMeta()/manual
  diario: { 'YYYY-MM-DD': { desayuno:[], comida:[], cena:[], colaciones:[] } },
  entreno: { rutinas:[], sesiones:[], sesionActiva:null },
  recientes: { alimentos:[], ejercicios:[] } }  // ids, más reciente primero, tope 30
```

Entrada del diario:

```js
{ id, nombre, gramos, porcion: null|{nombre,g},
  macros: { prot, carb, gras, kcalFuente },
  origen: 'base'|'plato', ts }
```

Las kcal MOSTRADAS siempre se derivan 4P+4C+9G al pintar; `kcalFuente` es
dato de respaldo (sección 6).

`metaCache` es POR COMIDA y su único escritor es app.js desde
`calcularMeta()`/manual: almacen.js lo guarda y lo sirve, jamás lo calcula.
La meta del DÍA en el diario = metaCache × (`perfil.comidasDiario ??
perfil.comidas`): `comidasDiario` existe porque las comidas que registras en
el diario pueden no ser las mismas con que repartiste la meta en Pedir.

### Sub-formas de `entreno` (propuesta de este documento)

almacen.js las trata como datos opacos (valida contenedores, no interiores);
los módulos de UI acuerdan estas formas aquí para no inventar tres distintas:

```js
// Ejercicio de la biblioteca (catálogo estático en js/ejercicios-data.js)
{ id, nombre, grupo: 'pecho'|'espalda'|'pierna'|'hombro'|'brazo'|'core'|'cardio',
  equipo, tipo: 'peso_reps'|'reps'|'tiempo', descansoSugerido: 90 }

// Rutina (entreno.rutinas[])
{ id, nombre, creada: ts, actualizada: ts,
  bloques: [ { tipo: 'ejercicio'|'superserie', descanso: s,
               ejercicios: [ { ejercicioId,
                               series: [ { reps, peso } ] } ] } ] }  // plantilla

// Sesión (entreno.sesiones[] y sesionActiva)
{ id, rutinaId: null|id, inicio: ts, fin: null|ts, notas: '',
  bloques: [ { ejercicioId, descanso: s,
               series: [ { reps, peso, hecha: null|ts } ] } ],
  descansoActivo: null | { inicio: ts, duracion: s } }  // solo en sesionActiva
```

`descansoActivo` guarda timestamps, no segundos restantes: el restante se
deriva contra `Date.now()` al pintar (sección 2, gotcha del throttling).

### Migraciones

- `migrar(crudo)` es el único embudo: TODO lo que entra de fuera
  (`cargar`, `importarJSON`) pasa por ahí y **nunca lanza**.
- Basura (null, string, número, objeto sin `v`, `v` futuro desconocido) →
  `estadoInicial()`. Preferimos perder un estado corrupto a tronar la app al
  arrancar: el diario es conveniencia, Pedir no depende de él.
- Objeto con forma parcial → se completa campo a campo con los defaults de
  `estadoInicial()` y se sanean los contenedores (un `diario` que no es
  objeto → `{}`; un día sin las 4 comidas → se le completan vacías; recientes
  se recorta a 30). Lo que el esquema no conoce se descarta: conservar campos
  fantasma es cargar bugs de versiones viejas para siempre.
- Cuando exista v2, `migrar` encadenará v1→v2 aquí mismo; los módulos de UI
  jamás ven otra cosa que el esquema vigente.

### Guardado

- `cargar(storage)` y `guardar(estado, storage)` van en try/catch: Safari en
  privado lanza al escribir, y un storage lleno o bloqueado no puede tirar la
  app. `guardar` devuelve true/false y la UI decide si avisa (en v1: aviso
  discreto solo si falla el guardado de una sesión de entreno, que es lo que
  dolería perder).
- El parámetro `storage` opcional existe por los tests: `node --test` no tiene
  `localStorage` y un doble `{getItem,setItem}` en memoria lo sustituye.
- Las funciones de escritura devuelven SIEMPRE un estado nuevo (inmutables):
  quien llama hace `estado = agregarAlDiario(estado, ...)` y luego
  `guardar(estado)`. Sin mutación compartida no hay renders fantasma.

### Exportar / importar JSON

- `exportarJSON(estado)` → string **legible** (indentado a 2 espacios) con
  `{ v, exportado: ISO, estado }`. Legible a propósito: el usuario que exporta
  quiere poder abrir SU archivo y entenderlo; el peso no importa a este tamaño.
  La UI lo entrega como descarga `cosecha-respaldo-YYYY-MM-DD.json`.
- `importarJSON(texto)` acepta el sobre de export O un estado pelado (la gente
  copia-pega la mitad del archivo), lo pasa por `migrar` y devuelve estado
  válido. Si el texto no es JSON o no se parece a nada importable, lanza
  `Error` con mensaje es-MX accionable ("El archivo no es un respaldo de
  COSECHA. Exporta uno desde Ajustes e inténtalo de nuevo."), que la UI pinta
  con el patrón `.form-error` existente.
- Importar REEMPLAZA el estado completo previa confirmación en la UI
  ("Esto sustituye tu diario y tus entrenamientos actuales"). Fusionar dos
  estados es un problema sin respuesta correcta y no se intenta en v1.

---

## 6 · Decisión: kcal consumidas DERIVADAS (4P + 4C + 9G)

**Decisión**: las kcal que el diario muestra — por entrada, por comida, por
día, por semana — se calculan SIEMPRE al pintar como
`4·prot + 4·carb + 9·gras`. La kcal de la fuente (etiqueta de data.js, o la
que venga con un plato) se conserva en `macros.kcalFuente` como dato, y cuando
`|kcalFuente − derivada| / derivada > 0.15` la entrada lleva una marca visible
("etiqueta difiere") con ambas cifras en su detalle.

**Por qué así y no mostrando la kcal de etiqueta:**

1. **La meta ya es derivada.** Regla de negocio escrita en CLAUDE.md: las kcal
   de la meta (fórmula y manual) se derivan de los macros por comida ya
   redondeados, exactamente 4P+4C+9G. Si el consumo usara la kcal de
   etiqueta, meta y consumo estarían en unidades distintas y el "te quedan
   627" sería mentira estructural: podrías cuadrar los tres macros y que las
   kcal "no cuadren", o al revés. Con ambas derivadas, **el panel siempre
   cuadra por construcción**: barras de macros en meta ⇔ kcal en meta.
2. **El desvío es real y conocido.** CLAUDE.md documenta que las kcal de
   etiqueta de data.js no cumplen 4/4/9 contra sus propios macros (hasta
   ±9.5 kcal por item) y que en platos grandes se apilan más allá del umbral
   de ±68 kcal. Derivar al pintar elimina esa clase entera de incoherencias
   en vez de perseguirla item por item.
3. **Es el patrón del mejor del benchmark.** La coherencia interna
   macro→kcal es lo que hace que MacroFactor se sienta confiable; MFP
   muestra la kcal de etiqueta y sus foros llevan una década explicando por
   qué "mis macros suman distinto que mis calorías".
4. **No se destruye información.** `kcalFuente` queda en el dato: si mañana
   se decide otra presentación, o para auditar la base, el número original
   está. La marca de >15 % convierte el desvío en información visible en vez
   de en ruido silencioso — es la honestidad de Cronometer aplicada a nuestro
   caso. El umbral es 15 % y no los ±9.5 kcal conocidos: esos son esperables
   y marcarlos todos sería gritar siempre; 15 % señala datos probablemente
   mal capturados.

Implementación: un helper único `kcalDerivada({prot,carb,gras})` en el módulo
del diario (o reutilizando la suma que calc.js ya hace para la meta); ningún
otro sitio multiplica 4/4/9 a mano. Prohibido cachear la kcal derivada en el
estado: se deriva al pintar, igual que la meta.

---

## 7 · Tokens nuevos necesarios: ninguno

Revisado rol por rol contra el `:root` actual de `css/styles.css`; todo lo que
Diario y Entrenar necesitan ya tiene token con contraste auditado:

| Necesidad nueva | Token existente | Nota |
|---|---|---|
| Barra de pestañas (fondo/filete) | `--surface` + `--border-strong` | La misma pareja de la banda sticky superior: la app queda enmarcada por dos bandas gemelas. |
| Pestaña activa / inactiva | `--accent-ink` / `--muted-ink` | Texto + icono `currentColor`; ambos AA sobre `--surface` (auditados en el :root). |
| Barras de macros del diario | `--green` `--blue` `--amber` + `--border` (riel) | Idénticas al tracker: mismo código visual P/C/G en toda la app. |
| Exceso sobre meta | `--accent` + trama `.bover` | Patrón ya resuelto (la trama existe porque amber/accent están a 1,28:1). |
| Descanso corriendo | `--accent-ink` fondo, blanco encima | El par "relleno elegido" de toda la app (5,26:1). |
| Descanso terminado | `--green` fondo, blanco encima | Blanco sobre #356B4A ≈ 6,6:1, pasa AA; es el único fondo verde de la app y por eso es inconfundible. |
| Quitar del diario / descartar sesión | `--danger` | Ya existe y ya se separa del naranja por luminancia. |
| Badges (superserie, "etiqueta difiere", extra) | `--ember` + `--text` | Patrón `.meta-tag`/`.res-extra-tag` tal cual (8,10:1). |
| Radios y tipografía | `--r-sm/md/pill`, `--sans`, `--mono` | Mono = rótulo en mayúscula con tracking, y nada más (regla de la hoja); las cifras del timer van en `--sans` con `tabular-nums`, como todas las cifras vivas de la app. |

Dos no-decisiones deliberadas: no se usa `--light` (declarado pero pisado por
el barrido final: no pinta un solo píxel, y apoyarse en él sería heredar esa
trampa), y no se inventa un "verde éxito" distinto de `--green`: el canal de
proteína y el de "descanso terminado" no conviven nunca en la misma pantalla
con el mismo rol, así que no hay ambigüedad que justifique un token más.

Lo único que la barra de pestañas añade es CSS nuevo con tokens viejos
(`position:fixed`, `env(safe-area-inset-bottom)`, z-index 110/120 para
pestañas/descanso) — valores de layout, no de identidad: no son tokens.

---

## 8 · API exacta de `js/almacen.js` (contrato cerrado)

Los demás módulos codean contra estas firmas; no se cambian.

```js
export const VERSION = 1;
export const CLAVE = 'cosecha.v1';
export function estadoInicial()                                  // estado v1 completo con defaults
export function migrar(crudo)                                    // basura/versiones viejas → estado v1 válido; NUNCA lanza
export function cargar(storage)                                  // storage opcional (default localStorage); try/catch; si falla → estadoInicial()
export function guardar(estado, storage)                         // try/catch; true/false
export function exportarJSON(estado)                             // string legible con { v, exportado: ISO, estado }
export function importarJSON(texto)                              // → estado migrado válido; lanza Error con mensaje es-MX si no es importable
export function hoyISO(ms)                                       // 'YYYY-MM-DD' en hora LOCAL (ms opcional)
export function comidaPorHora(ms)                                // 'desayuno' <11:30, 'comida' <17:00, 'cena' <22:00, si no 'colaciones'
export function agregarAlDiario(estado, fechaISO, comida, entrada) // → NUEVO estado (inmutable); registra tambien en recientes.alimentos
export function quitarDelDiario(estado, fechaISO, comida, indice)
export function editarEnDiario(estado, fechaISO, comida, indice, cambios)
export function guardarPerfil(estado, perfil)                    // → nuevo estado
export function guardarMetaCache(estado, meta)
export function guardarSesionActiva(estado, sesion)              // null para limpiar
export function cerrarSesion(estado, sesion)                     // mueve a entreno.sesiones y limpia sesionActiva
export function guardarRutina(estado, rutina)                    // alta o reemplazo por id
```

Semántica acordada (lo que las firmas no dicen solas):

- **Inmutabilidad**: toda función que recibe `estado` devuelve un estado
  NUEVO; el recibido no se muta. Persistir es responsabilidad de quien llama
  (`guardar`).
- `hoyISO` usa `getFullYear/getMonth/getDate` locales, **nunca**
  `toISOString()`: en GMT-6 un registro de las 7 pm caería en el día
  siguiente UTC y la cena aparecería en mañana.
- `comidaPorHora`: límites en hora local; 22:00 a 11:29 del día siguiente →
  `'colaciones'` solo de 22:00 a 23:59; de 00:00 a 11:29 es `'desayuno'`
  (madrugada rara, pero <11:30 manda: la regla es literal).
- `agregarAlDiario` crea el día con sus 4 comidas vacías si no existe, empuja
  la entrada al final de la comida y registra `entrada.id` en
  `recientes.alimentos` (dedupe, más reciente primero, tope 30).
- `editarEnDiario` mezcla `cambios` superficialmente sobre la entrada
  (`{...entrada, ...cambios}`); índice fuera de rango → estado sin cambios.
- `cerrarSesion` sella `fin` si viene null, quita `descansoActivo`, agrega la
  sesión a `entreno.sesiones` y pone `sesionActiva: null`. Los ejercicios de
  la sesión alimentan `recientes.ejercicios` (mismas reglas de tope 30).
- `guardarRutina`: si existe una rutina con el mismo `id` la reemplaza; si
  no, la agrega; sella `actualizada`.
- La meta nutricional SIEMPRE sale de `calcularMeta()`/`mac()` de
  `js/calc.js`; almacen.js solo cachea (`guardarMetaCache`) lo que app.js le
  entrega. Sin fórmulas paralelas en ningún módulo.

---

## 9 · Fuentes

Benchmark 2026 verificado en la web el 1-oct-2026:

- WHOOP Strength Trainer, quejas del descanso (comunidad oficial):
  [rest timer workflow](https://www.community.whoop.com/t/strength-trainer-feedback-rest-timer-workflow-progression-targets-notes-measurements-and-exercise-mapping/14544) ·
  [rest time between sets](https://www.community.whoop.com/t/feature-request-rest-time-between-sets-in-strength-trainer/14908) ·
  [timer and bell sound](https://www.community.whoop.com/t/whoop-strength-timer-and-bell-sound/13693) ·
  [workout notes, rest timer & tap controls](https://www.community.whoop.com/t/feature-request-workout-notes-rest-timer-tap-controls/14641) ·
  [a much better strength training experience](https://www.community.whoop.com/t/feature-request-a-much-better-strength-training-experience/15924)
- MacroFactor: [producto](https://macrofactor.com/macrofactor/) ·
  [vs Cronometer 2026](https://macrofactor.com/macrofactor-vs-cronometer/) ·
  [watchOS y Fastest Food Logger Index](https://macrofactor.com/mm-sept-2025/) ·
  [vs MyFitnessPal](https://macrofactor.com/macrofactor-vs-myfitnesspal-2025/)
- Fitia: [App Store](https://apps.apple.com/es/app/fitia-contar-calor%C3%ADas-dietas/id1448277011) ·
  [reseña Xataka](https://www.xatakamovil.com/aplicaciones/esta-app-te-ayuda-a-comer-mejor-alimentos-que-te-gustan-obsesionarse-calorias) ·
  [perfil](https://www.descubre.vc/fitia)
- MyFitnessPal y Cronometer: patrones de dominio público de ambas apps,
  contrastados en los comparativos de MacroFactor citados arriba.
