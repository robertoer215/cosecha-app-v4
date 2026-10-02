# Contexto del proyecto — Cosecha App v4

Una sola app con cuatro pestañas que comparten un perfil y una meta: **Hoy**
(resumen del día + acciones), **Pedir** (el armador de plato del restaurante),
**Diario** (contador de macros) y **Entrenar** (registro de fuerza). Este repo
es una COPIA independiente de `cosecha-macro-calculator`: el original es de
solo lectura y aquí `MODO_DEMO` queda encendido (ver "Modo demo").

## Arquitectura v4 (1-oct-2026)

- `index.html` — cuatro `<main>` hermanos (`vista-hoy`, `vista-pedir`,
  `vista-diario`, `vista-entrenar`) + tabbar fija inferior. Solo Hoy y Pedir
  cargan al inicio; Diario y Entrenar se montan con `import()` dinámico la
  primera vez que se abren (la carga inicial de Pedir no crece).
- `js/almacen.js` — ÚNICA puerta a localStorage (`cosecha.v1`): estado
  versionado con `migrar()` tolerante, exportar/importar JSON, helpers del
  diario. Los datos del usuario NUNCA salen del dispositivo (regla del
  encargo: sin backend ni analítica en esta entrega).
- `js/temporizador.js` — descanso por HORA DE FIN (timestamp), nunca restando
  segundos: tras bloquear pantalla el tiempo sigue exacto. Reloj inyectable
  para tests; capa de avisos (WakeLock, beep WebAudio, vibración) aparte.
- `js/diario.js` + `css/diario.css`, `js/entreno.js` + `css/entreno.css` —
  cada módulo renderiza TODO dentro de su `<section>` vía
  `init({ raiz, getMeta })`; `getMeta()` da la meta POR COMIDA (de
  `calcularMeta()`/manual, cacheada en el almacén). Sin fórmulas paralelas.
- `data/` — `alimentos.json` (hoy: base mínima de la carta vía
  `scripts/base_minima_carta.mjs`; la base USDA ≥1.500 con fuente/id/licencia
  la reemplaza cuando su pipeline termine), `ejercicios.json` (free-exercise-db
  traducido, Unlicense; imágenes por CDN, no en el repo), `rutinas.json`.
  Cada JSON se carga al abrir SU pestaña.
- El shell (`app.js`: `goTab`, `renderHoy`, persistencia de perfil,
  `agregarPlatoAlDiario`) lo edita UNA sola persona/agente a la vez.

## Arquitectura de Pedir (heredada)
- `index.html` — markup, sin lógica inline salvo onclick que llaman funciones globales
- `css/styles.css` — todos los estilos. Paleta crema + acento naranja (#C05A1F)
- `js/data.js` — datos: ingredientes con `costoKg` (coste real de la preparación, del costeo), factores, constantes de precio
- `js/calc.js` — funciones puras: precio(), mac(), calcularMeta(), y el MODO IA:
  porcionar(), explicarCambio(), proponerCierre()
- `js/app.js` — estado y render de la UI; expone funciones a window
- `assets/ingredientes/` — foto de cada ingrediente, 600×600 JPEG (~110 KB). Son
  derivadas con `sips` de las fotos de la landing (repo cosecha-landing/assets).

## Fotos de ingredientes
- `data.js` trae `img` (nombre de archivo) y `foco` (object-position) por ingrediente.
- Las fotos son cuadradas y las tarjetas 4:3 (16:9 en móvil): `foco` recentra el recorte
  en los platos que no están al centro de su foto (guacamole, nueces, semillas, arroz,
  camote, esquites, verduras). Sin `foco` se corta el plato.
- Se renderizan con el helper `foto(it, cls)` de app.js, en tarjetas, extras y resumen.
  Van con `loading="lazy"`: el paso 2 sólo muestra una categoría a la vez.
- El ticket de cocina (instrucciones del QR) va sin fotos a propósito: es para staff.

## Duplicación src/ ↔ raíz (RESUELTA 1-oct-2026)
La copia `src/` se eliminó: la raíz es la única ubicación. `npm run dev` sirve la
raíz, los tests importan de `../js/` y GitHub Pages sirve la raíz. (Hasta `ccb51a4`
eran copias idénticas que había que editar por duplicado.)

## Modo IA — el tamaño es una respuesta, no una pregunta
El usuario elige QUÉ comer (proteína → carbohidrato → vegetal → grasa, mismas
tarjetas, mismo orden). El CUÁNTO lo resuelve `porcionar()`, que recorre TODAS las
combinaciones de tamaños de los módulos elegidos —cada uno dentro del tope de
porciones de su categoría, `tamanosPermitidos()`— y devuelve el óptimo global, no
una heurística. Lo hace por ENCUENTRO EN EL MEDIO: enumera las dos mitades del
plato y las cruza, así cada combinación cuesta tres sumas y no n llamadas a mac().
Corre en local, en cada toque, sin red: un plato de 4 son 480 combos en 0.2 ms;
el peor caso permitido (2P+2C+2V+1G y tres hipotéticos de 8 = 750.000 combos) son
~5 ms por toque medidos en Chrome. La enumeración plana tardaba 188 ms ahí y 3.6 s
con 3P+3C+3V; por eso además hay tope de módulos por categoría (MAX_MODULOS_CAT=2).
- Función objetivo: suma de desviaciones absolutas normalizadas por la meta de
  cada macro, con la proteína a peso doble (PESO_MACRO). Desempata por precio.
- `szManual` son los overrides de "Ajustar": se clavan (`opts.fijos`) y el resto
  se optimiza alrededor. `szBase` es un CACHÉ derivado del porcionado, y por eso
  el resumen, el QR y el ticket siguieron funcionando sin enterarse del cambio.
- Los extras del paso 5 entran en el porcionado clavados a su tamaño: si no, la
  tarjeta afirma "Cierra tu meta" mientras la barra marca otra cosa. Y en el paso 2
  su tarjeta se pinta ELEGIDA ("En tu plato como extra"): tocarla lo quita, no lo
  duplica. El "Cierre sugerido" también se calcula sobre el plato con extras.
- Tope de 2 módulos distintos por categoría, contando base Y extras (enCategoria):
  la tercera tarjeta dice "Máximo 2 por categoría", no promete hipotético y el toque
  no hace nada; el paso 5 no ofrece extras de una categoría al tope; n8n devuelve 400.
- Las tarjetas son operables con teclado (role=button, tabindex=0, aria-pressed,
  Enter/Espacio); el keydown solo actúa si el foco está en la propia tarjeta.
- La línea de porqué se deriva del DIFF del porcionado, nunca de un modelo. Mide
  contra un CONTRAFACTUAL (el plato de ahora con los previos clavados donde estaban
  y el módulo nuevo y lo manual clavados en su valor FINAL) y excluye lo que movió
  el usuario. Cada cambio se atribuye solo al macro que ese cambio, aplicado él
  solo, acerca a la meta; un cambio que no acerca ninguno no se cita. Hasta dos
  tramos ("…para no pasarte de tu proteína y subí camote a 3 porciones para cerrar
  tus carbohidratos"). `tramos` en el retorno expone esa estructura para los tests.
- Nunca animar width ni height, solo opacity y transform. Las barras del tracker
  usan `transform:scaleX` por eso; su estilo inline es `transform:scaleX(0)`, no
  `width:0%`.
- **Grasas cubiertas antes de su paso (18-sep-2026)**: la grasa es el macro que
  se llena primero (salmón, tenderloin, camote y esquites la traen de serie). Al
  entrar al paso de grasa saludable, `cubrenGrasa()` porciona el plato SIN sus
  módulos de grasa y, si ya alcanza la meta, pinta el aviso `.nudge` antes de las
  tarjetas nombrando QUIÉN la cubre ("con salmón y camote ya alcanzas tu meta"),
  con "Seguir sin grasa extra". Nace con el paso y nunca se inserta a mitad (en
  ese paso solo se tocan grasas, así que su condición no cambia): sin saltos. Si
  el cliente elige una grasa igualmente, solo cambia el texto, en sitio, y el
  botón pasa a "Quitar y seguir". El texto no lleva cifras a propósito.

## Cierre del plato contra n8n (17-sep-2026)
`goResumen()` pinta el resumen con los números LOCALES al instante (≈6 ms) y
dispara UNA llamada POST al webhook `cosecha-plato` (`js/cocina.js` tiene lo puro:
contrato, normalización de la respuesta, comparación y llamada con timeout de 8 s;
`app.js` solo pinta). Lo que vuelve confirma, explica (`explicacion`, auditada en
n8n: aquí no se redacta nada) y propone (`propuesta_cierre`).
- Los números de pantalla son los locales. Si cocina calcula distinto (total,
  líneas o macros), gana cocina pero se enseñan las dos cifras en `.cocina-disc` y
  el total pasa a "Total según cocina". `coincide_con_la_app` no basta: compara con
  lo ENVIADO, y se comprueba línea a línea contra lo que ve el cliente.
- La respuesta se NORMALIZA antes de pintar nada (`normalizarRespuesta`): total,
  líneas, tamaños o macros fuera de contrato → "Sin confirmar"; lo accesorio se
  limpia campo a campo. Un 200 con `ok:false` se trata como rechazo.
- Hueco `#cocina` con altura reservada: `.cocina-body` 226 px (12 líneas; medido
  sobre 40 explicaciones reales a 375 px: mediana 144, p90 160, máx 193) y 262 px
  bajo 340 px. Solo la discrepancia lo hace crecer, a propósito.
- La propuesta se RESERVA con la tarjeta exacta que va a llegar: `predecirPropuesta()`
  corre el mismo motor con todas las líneas clavadas (como n8n) y pinta la misma
  tarjeta con el contenido oculto. Ningún número de la predicción se enseña. Si
  n8n no propone o la llamada falla, la tarjeta se quita y `sinSalto()` compensa el
  scroll cuando el bloque está por encima de lo visible.
- Aceptar la propuesta CLAVA las líneas actuales (`szManual`) y añade el módulo
  como extra al tamaño propuesto: es lo que cocina prometió ("las demás líneas no
  cambian"); sin clavarlas el porcionado reajustaba el plato y el precio aceptado
  no se cumplía en el 53 % de los casos. Luego se repite la llamada con
  `upsell_aceptado:true` y `pedido_id_previo`.
- Dedupe: misma meta + misma selección (`clavePedido`) no vuelve a pedir; un plato
  ya confirmado en la sesión se restaura del `historial`. Una respuesta tardía de
  un plato editado se ignora (`seq`). Timeout/red/rechazo → "Sin confirmar con
  cocina", con el QR y el ticket intactos; reabrir el resumen reintenta.
- El QR lleva el `pedido_id` como última línea y TODO el texto se filtra a ASCII
  (la hora local puede traer U+202F). `#qr-pedido` lo muestra en el ticket.
- El pedido lleva `meta_origen` (`formula` | `manual_comida` | `manual_dia`, de
  `origenMeta()`) y `comidas`: cocina recibe siempre macros por comida y con esto
  sabe quién los puso; el agente no atribuye a la app una meta que trajo el cliente.
- Latencia real desde el navegador: mediana ≈ 5 s, máximo visto 7,6 s. El timeout
  pasó de 8 a 15 s el 18-sep-2026: con 8 s un pico normal de n8n (o un teléfono en
  Wi-Fi) se pintaba "Sin confirmar" con el pedido ya registrado en la hoja.

## Reglas de negocio (NO cambiar sin avisar)
- Macros: Mifflin-St Jeor → TDEE → kcal objetivo → reparto por comida
- Precio (16-sep-2026): BANDA POR CATEGORÍA a food cost objetivo. `costoKg` es el coste
  real por kilo de la preparación terminada (cosecha-costos/costeo.csv, insumos
  verificados 29–31 ago 2026). precioBase = (costeMedioCat + 0.25 × (costePorción −
  costeMedioCat)) / 0.32; Pequeña/Estándar/Grande = ceil(base × factor); 2+ porciones
  = N × Estándar. Sustituye a la "fórmula de la casa" (coste × 1.40 / 0.85), que
  dejaba food cost 61 % y vendía 7 de 13 módulos por debajo de coste. Resultado:
  proteínas $144 / $168 / $173 (antes $24 / $80 / $82), plato medio $231 (el
  modelo v2 dice $233). El catálogo de n8n (Sheets) lleva estos mismos precios.
- Tamaños: cocina vende TRES piezas (Pequeña 0.5, Estándar 1, Grande 1.5) y a partir
  de 2 el módulo se COMPONE con ellas en medios pasos (×2, ×2½, ×3, ×3½, ×4; el
  campo `cocina` de SIZES dice cómo se emplata: "2 Estándar + 1 Pequeña"), con tope
  por categoría en MAX_PORCIONES (proteína 3, carbohidrato 4, vegetal 2, grasa 2).
  Precio de 2+ porciones = SUMA de las piezas (N × Estándar + Pequeña si hay media):
  es lo que espera quien pide "tres de camote" y coincide con el motor de n8n. Los
  medios pasos (20-sep-2026) dan exactitud: de Grande se saltaba a 2 y de ahí a 3.
- Los extras del paso 5 ofrecen TODOS los tamaños de la carta (antes solo hasta
  Grande y entraban clavados: un arroz extra en Estándar dejaba 52 g de carbos de
  menos aunque el motor hubiera querido ×4).
- Las kcal de la meta (fórmula y manual-total) se DERIVAN de los macros por comida
  ya redondeados (4P+4C+9G): el panel siempre cuadra. Carbos = residuo, nunca <0;
  si quedan en 0 g/comida se muestra el aviso .meta-warn (flag ajusteCarb).
  Por eso el formulario manual NO pide kcal (18-sep-2026: las exigía y las
  ignoraba); las enseña en vivo bajo los campos (`kcalManual()`).
- Formularios del perfil (18-sep-2026): los campos manuales vienen con VALORES de
  referencia, no placeholders (un placeholder parece un valor y "Continuar"
  fallaba con los campos vacíos); los errores van EN el formulario
  (`errorFormulario()`: aria-invalid, subrayado rojo, mensaje con campo y rango
  bajo los campos, foco al primero), nunca en `alert()`; los toggles de modo son
  `<button>` con aria-pressed; todos los `label` llevan `for`.
- Las cartas muestran siempre el tamaño que se agregará al tocarlas (recomendado
  si el usuario no eligió otro): carta = barra = resumen = QR.
- Umbrales del resumen: ±4 g por macro; kcal ±68 (= 4·4+4·4+9·4, coherente con
  los ±4 g — reduce mucho los casos de "En tu meta" en macros con kcal en rojo).
- Nota conocida: las kcal de etiqueta en data.js no cumplen 4/4/9 exacto con sus
  propios macros (hasta ±9.5 kcal por item); en platos grandes esos desvíos pueden
  apilarse más allá de los 68 kcal y aún pintar la kcal en rojo con macros en meta.

## Bugs conocidos
- (Resuelto 16-sep-2026) El QR del resumen no se dibujaba NUNCA, ni con un módulo:
  qrcodejs 1.0.0 calcula mal el tamaño en cuanto hay un carácter fuera de ASCII y
  el texto siempre llevaba "—" y acentos. Ahora buildQRText() emite solo ASCII y
  compacto (`P01 x1.5 225g`, `E:C01 x1 120g`, `P47 C93 G20 K752`) y la creación va
  en try/catch con un texto de respaldo. La nota anterior ("falla con ~4 items")
  era incorrecta.

## Tareas pendientes / ideas
- [ ] Backend para guardar perfiles
- [ ] Base de datos real de ingredientes
- [x] Integrar API de Anthropic — flujo n8n `Xv459ruzH0Ag71qY` (ver `n8n/README.md`)
- [ ] Vista de cocina que lea el QR
- [x] Tests de las funciones de calc.js (tests/calc.test.mjs — `npm test`)
- [x] cosecha-standalone.html ELIMINADO (2-oct-2026): Pages lo servía con los
      precios viejos de la "fórmula de la casa" (pollo $36 vs $144 real).
- [ ] Alérgenos VERIFICADOS por cocina: hoy el catálogo de n8n los deriva del
      nombre del plato y lo declara fila a fila. No es una garantía alérgica.
- [x] El inventario de carbohidratos se quedaba corto (48 g con un módulo en
      Grande contra 96 g de meta media): resuelto con porciones múltiples (×2, ×3,
      ×4 del mismo módulo). Ojo: tras la rederivación el camote lleva 7.5 g de
      grasa por ración, así que el porcionador prefiere cerrar carbos con arroz.
- [ ] El recetario declara porción de 150 g para arroz y esquites; la app
      declara 120 y 100. Cerrar el conflicto antes de publicar carta.
