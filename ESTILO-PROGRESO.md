# Estilo nuevo de COSECHA v4.2 — progreso

Pedido de Roberto (23-nov-2026): que toda la app tenga el estilo de la portada (Hoy):
fondo en degradado blanco → naranja, tarjetas de vidrio esmerilado («ice») y barra de
pestañas flotante. Solo estilo: sin cambiar textos, lógica ni el orden. Pidió el vidrio
«más transparente». Un commit local por pantalla verificada; nunca `git push`.

## Estado

Las cuatro secciones están hechas, verificadas y guardadas (24-nov-2026). `node --test tests/*.test.mjs`: 258 de 258.

| Pantalla | Estado | Commit |
|---|---|---|
| Hoy (primera visita, con meta, con comida y «Tu semana») | Hecha y verificada; revisada otra vez con las tintas compartidas | `ac52bde` + `b293a0a` |
| Barra de pestañas (las 4 secciones) | Hecha y verificada | `ac52bde` |
| Pedir: perfil (fórmula y manual), armar el plato (5 pasos), resumen y ticket | Hecha y verificada | `b293a0a` |
| Diario: día (vacío y con comida), buscador, alimento, «Tu semana», «Tus datos», aviso con Deshacer | Hecha y verificada | `0e71a27` |
| Entrenar: rutinas, elegir descanso, sesión en vivo (preparado, serie, descanso), Ejercicios con barra de descanso, resumen, Progreso, Historial, Biblioteca, ficha, editor, hoja de técnica, aviso «Deshacer» | Hecha y verificada | `5342aa9` |
| Avisos del Diario y burbujas de la guía (forma y filo de luz) | Hechas; la burbuja no se revisó en todas sus posiciones | `0e71a27` |

## Unión con las propuestas de UX (24-nov-2026)

`git merge v4.2-ux` en el commit `3a96db2`, sin conflictos. Trae 13 propuestas que eligió
Roberto, una por commit: H2, H3 (Hoy), P1, P2, P3 (Pedir), D1, D2, D3 (Diario), E2, E3
(Entrenar), G1, G2, G3 (perfil y cabecera). Las hizo otra sesión sobre este estilo.

- Revisado tras la unión, a 375×812 y con el recorrido de contraste (0 fallos): Hoy (persona
  nueva y con perfil), Pedir (perfil, los cinco pasos del plato con la pastilla «Anterior /
  Siguiente», resumen), Diario (día, buscador, alimento con − y +), Entrenar (cuadros por
  nivel, descanso con «Recomendado», sesión en vivo, resumen con «Guardar sesión»).
- Piezas nuevas con el vidrio compartido: `.plato-pie` (`css/styles.css`) y `.en-guardar-pie`
  (`css/entreno.css`). Son `position:sticky`, así que conviven con el `backdrop-filter` de las
  láminas (el problema es solo con `position:fixed`).
- Ajuste propio en commit aparte: el texto de ejemplo de los campos (`::placeholder`) pasa a
  `--muted-ink`; el gris del navegador no llegaba a AA sobre el vidrio.
- No revisado tras la unión: «Tu semana» y «Tus datos» del Diario, Progreso, Historial,
  Biblioteca, ficha y editor de Entrenar (no los tocan las propuestas), ni 320×568.

## Cambio de estructura: Rutinas COSECHA por nivel (24-nov-2026)

Pedido de Roberto: en Entrenar › Rutinas, tres cuadros (Principiante, Intermedio, Avanzado)
y al tocar uno salen sus rutinas. Esto NO es solo estilo; va en su propio commit.

- `js/entreno.js`: `NIVELES` y `rutinasPorNivel()` (puras, exportadas y probadas), el estado
  `nivelAbierto` y, en `pintarPanelRutinas`, los cuadros (`cuadroNivel`) y `pintarNivel()`, que
  abre, cierra o cambia de nivel en sitio para no perder el foco.
- `css/entreno.css`: bloque «Rutinas COSECHA por nivel» (`.en-niveles`, `.en-nc*`).
- `js/guia.js`: el consejo «Rutinas listas» señala ahora el primer cuadro (`.en-nc`).
- `tests/entreno.test.mjs`: prueba de `rutinasPorNivel`.
- Decisiones tomadas: las rutinas salen DEBAJO de los cuadros (no en pantalla aparte); todo
  empieza cerrado; un nivel sin rutinas no pinta cuadro; una rutina sin nivel conocido sale
  suelta bajo los cuadros; el nivel abierto se recuerda al volver de «Descanso entre series».
- No se tocó «Crear rutina», «Empezar sesión vacía» ni «Tus rutinas».
- Verificado a 375×812 y 320×568: abrir, cambiar, cerrar, `aria-expanded`, foco, empezar una
  rutina desde la lista, consejo de la guía, sin desborde horizontal ni errores en consola.

## Dónde está todo

Un solo bloque al final de `css/styles.css`: «HIELO SOBRE DEGRADADO (23-nov-2026)».
No se tocó `css/diario.css`. En `css/entreno.css` solo cambiaron tres reglas, usando las
variables compartidas: `.en-descanso` (cuadro de vidrio flotante), `.en-hoja` (esquinas) y
`.en-ed-deshacer` (esquinas y filo de luz). No se tocó `js/entreno.js`.

Variables compartidas (en `:root`):
- `--hielo`, `--hielo-borde`, `--hielo-luz`, `--hielo-sombra`, `--hielo-filtro`, `--r-hielo`: el vidrio.
- `--grano`: ruido SVG para la textura. `--sol-cosecha`: el degradado ember → naranja → barro.
- `--r-burbuja`, `--burbuja-luz`: forma y filo de luz de avisos y burbujas.
- `--v-accent`, `--v-accent-ink`, `--v-green`, `--v-blue`, `--v-amber`, `--v-danger`: tintas un
  escalón más oscuras, solo para lo que va DENTRO del vidrio.

Cómo vestir una superficie nueva:
1. Añadir su selector a la lista «TINTAS sobre vidrio» (oscurece los tokens de texto dentro).
2. Si es la lámina de una pantalla, añadirlo también a la lista «LÁMINAS» (fondo, radio,
   desenfoque y el margen de 8px compensado en el padding, para no cambiar anchos).
3. El fondo (`body::after`) está encendido siempre, en las cuatro secciones.
4. OJO: `backdrop-filter` en un contenedor saca de la ventana a sus hijos `position:fixed`.
   Por eso en Entrenar el vidrio va en `.en-wrap::before` y no en `.en-wrap` (el editor lleva
   dentro el aviso fijo «Deshacer»). Antes de vestir otro contenedor, mirar si tiene hijos fijos.

## Reglas que hay que respetar
- El ancho del contenido no puede cambiar (335px a 375): Pedir tiene alturas reservadas
  medidas a ese ancho (ver `CLAUDE.md`).
- La tabbar ocupa 56px + safe-area: `.en-descanso` y los pies fijos de Entrenar apoyan ahí.
- No devolverle fondo a `.en-foco-anillo` ni tocar `dibujarOrbe` / `animarOrbe`.
- Animar solo `opacity` y `transform`.

## Cómo se verifica cada pantalla
- Vista previa a 375×812 en `http://estetica.localhost:3005` (otro origen que `localhost:3005`,
  para no pisar los datos de quien esté probando la app).
- Contraste: recorrido del DOM que calcula cada texto contra su fondo; el vidrio se toma en
  su peor caso (L = 0,67: vidrio al 62 % sobre el naranja más hondo). Mínimo 4,5:1.
- Sin errores en consola, regla de `prefers-reduced-motion` presente, `node --test tests/*.test.mjs`.

## No comprobado
- Entrenar: rest-pause y drop set (mini-series y micro-descanso), el aviso verde de fin de
  descanso, la tarjeta de permiso de avisos, el panel de filtros de la Biblioteca y el arrastre
  para reordenar en el editor. Usan los mismos componentes ya revisados, pero no se abrieron.
- Las burbujas de la guía en todas sus posiciones.
- iPhone real (el desenfoque puede verse distinto o ir más lento).
- `prefers-reduced-motion` activado de verdad (solo que la regla existe).
- Teléfonos más bajos que 812px y ventana ancha de ordenador.

## Notas
- Si tras actualizar no se ve un cambio de Entrenar o del Diario, recargar: el navegador guarda
  en caché `css/entreno.css` y `css/diario.css` (se cargan aparte, al abrir su pestaña).
- El orbe de «Sesión en vivo» toma su `color` de los tokens, que dentro del vidrio son un
  escalón más oscuros: ámbar, verde y naranja se leen bien sobre el disco crema. No se tocó
  `.en-foco-anillo` ni las funciones del orbe.
- La tarjeta «Tu día» del Diario (`.dia-progreso`) conserva su degradado ember opaco, igual que antes; va dentro de la lámina.

## Decisiones pendientes de Roberto
- Cuadros por nivel: ¿le sirve que las rutinas salgan debajo y que todo empiece cerrado?
- ¿Le sirve la transparencia actual del vidrio en Pedir, Diario y Entrenar (la misma que Hoy)?
- Las tarjetas de dentro (ingredientes, comidas, ejercicios) siguen opacas en crema, como las
  del menú en Hoy. ¿Las quiere también translúcidas?
- De las 15 propuestas de UX, 13 ya están unidas (ver arriba). Quedan fuera H1 y E1, que
  Roberto no eligió.
