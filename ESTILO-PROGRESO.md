# Estilo nuevo de COSECHA v4.2 — progreso

Pedido de Roberto (23-nov-2026): que toda la app tenga el estilo de la portada (Hoy):
fondo en degradado blanco → naranja, tarjetas de vidrio esmerilado («ice») y barra de
pestañas flotante. Solo estilo: sin cambiar textos, lógica ni el orden. Pidió el vidrio
«más transparente». Un commit local por pantalla verificada; nunca `git push`.

## Estado

| Pantalla | Estado | Commit |
|---|---|---|
| Hoy | Hecha y verificada | `ac52bde` |
| Barra de pestañas (las 4 secciones) | Hecha y verificada | `ac52bde` |
| Pedir: perfil (fórmula y manual), armar el plato (5 pasos), resumen y ticket | Hecha y verificada | `b293a0a` |
| Diario: día (vacío y con comida), buscador, alimento, «Tu semana», «Tus datos», aviso con Deshacer | Hecha y verificada | commit «Estilo nuevo en Diario» |
| Entrenar: rutinas, descanso, sesión en vivo, Ejercicios, resumen, Progreso, Historial, Biblioteca, ficha, editor, hojas | Sin empezar (sigue en crema) | pendiente |
| Avisos del Diario y burbujas de la guía (forma y filo de luz) | Hechas; la burbuja no se revisó en todas sus posiciones | commit «Estilo nuevo en Diario» |

## Dónde está todo

Un solo bloque al final de `css/styles.css`: «HIELO SOBRE DEGRADADO (23-nov-2026)».
No se tocó `css/diario.css` ni `css/entreno.css`.

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
3. El fondo (`body::after`) se enciende en todo menos Entrenar: al adaptar Entrenar, quitar
   el `:not(:has(#vista-entrenar...))` de esa regla y la regla del velo de `.tabbar`.

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
- iPhone real (el desenfoque puede verse distinto o ir más lento).
- `prefers-reduced-motion` activado de verdad (solo que la regla existe).
- Teléfonos más bajos que 812px y ventana ancha de ordenador.

## Notas
- La tarjeta «Tu día» del Diario (`.dia-progreso`) conserva su degradado ember opaco, igual que antes; va dentro de la lámina.

## Decisiones pendientes de Roberto
- Ninguna por ahora.
