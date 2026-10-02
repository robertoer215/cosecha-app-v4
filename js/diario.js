// ─────────────────────────────────────────────────────────────────────────────
// DIARIO DE MACROS — la pestaña que comparte meta y registro con Pedir.
//
// El shell (app.js) monta este módulo con initDiario({ raiz, getMeta }) la
// primera vez que se abre la pestaña, y llama refrescar() al volver a ella:
// el almacén pudo cambiar desde Pedir (un plato añadido al diario) y aquí se
// relee entero en vez de adivinar qué cambió.
//
// Reglas de la casa que este módulo respeta a rajatabla:
// - La meta POR COMIDA llega por getMeta() (calcularMeta()/manual, cacheada en
//   el almacén). Aquí no hay fórmulas de meta: metaDelDia() solo multiplica por
//   el número de comidas, igual que hace la pantalla Hoy.
// - Las kcal MOSTRADAS se derivan SIEMPRE 4P+4C+9G al pintar (kcalDerivada):
//   es la misma regla con la que se construye la meta, así el "te quedan X"
//   cuadra por construcción. kcalFuente (la etiqueta) es dato de respaldo y
//   solo asoma cuando difiere de la derivada en más de un 15 %.
// - localStorage se toca SOLO a través de js/almacen.js, y cada mutación
//   produce un estado nuevo que se persiste con guardar().
//
// La base de alimentos (data/alimentos.json, valores por 100 g) se carga UNA
// vez, al abrir el buscador por primera vez, y el índice vive en memoria: el
// buscador no toca la red al teclear. Si el archivo no está, el buscador lo
// dice y los recientes (que salen del propio diario) siguen funcionando.
//
// Las funciones de arriba del archivo son puras y están testeadas en
// tests/diario.test.mjs; el DOM empieza donde dice "ESTADO DE LA UI". Nada
// fuera de initDiario()/refrescar() toca document: los tests importan este
// módulo en Node, sin navegador.
// ─────────────────────────────────────────────────────────────────────────────

import * as almacen from './almacen.js';
// El mismo ±4 g por macro con el que el resumen de Pedir pinta "En tu meta":
// un diario que marcara "fuera" con otro umbral contradiría a la otra pestaña.
import { UMBRAL_G } from './calc.js';

// Las cuatro franjas, en su orden de render (el mismo del almacén).
const COMIDAS = ['desayuno', 'comida', 'cena', 'colaciones'];
const COMIDA_LBL = { desayuno: 'Desayuno', comida: 'Comida', cena: 'Cena', colaciones: 'Colaciones' };

// El deshacer vive 5 s: suficiente para reaccionar, poco para estorbar.
const TOAST_MS = 5000;

// ── FUNCIONES PURAS (testeadas con fixtures inline, sin DOM ni red) ──────────

// Minúsculas, sin acentos y con los espacios colapsados: "Plátano  TABASCO"
// y "platano tabasco" son la misma consulta. NFD separa la letra de su tilde
// y el rango U+0300–U+036F borra solo la tilde, nunca la letra (la ñ se
// conserva como n+virgulilla → "n": "ñame" se encuentra tecleando "name",
// que es exactamente lo que hace quien no encuentra la ñ en su teclado).
export function normalizarTexto(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// El índice se construye una sola vez por carga de la base: normalizar en
// cada tecleo multiplicaría el trabajo por el número de letras escritas.
// `nombre` queda aparte de `texto` para poder rankear el prefijo del nombre
// por encima del acierto en un sinónimo.
export function construirIndice(alimentos) {
  if (!Array.isArray(alimentos)) return [];
  const indice = [];
  for (const a of alimentos) {
    if (!a || typeof a.nombre !== 'string' || a.nombre === '') continue;
    const nombre = normalizarTexto(a.nombre);
    const sinonimos = Array.isArray(a.sinonimos)
      ? a.sinonimos.map(normalizarTexto).filter(s => s !== '').join(' ')
      : '';
    indice.push({ alimento: a, nombre, texto: sinonimos ? nombre + ' ' + sinonimos : nombre });
  }
  return indice;
}

// Búsqueda local por subcadenas: cada palabra de la consulta tiene que
// aparecer en el nombre o en los sinónimos (AND, no OR: "arroz pollo" no
// debe traer todos los arroces MÁS todos los pollos). El orden premia al
// nombre que EMPIEZA por la consulta, luego al que la contiene, y al final
// los aciertos solo por sinónimo; dentro de cada grupo, alfabético, para que
// el mismo tecleo pinte siempre la misma lista.
// Un principiante escribe en plural ("frijoles", "huevos", "tomates"): la
// palabra también vale sin su -s o -es final.
export function incluyePalabra(texto, p) {
  if (texto.includes(p)) return true;
  if (p.length <= 3) return false;
  return (p.endsWith('es') && texto.includes(p.slice(0, -2))) || (p.endsWith('s') && texto.includes(p.slice(0, -1)));
}

export function buscar(indice, consulta, limite = 20) {
  const q = normalizarTexto(consulta);
  if (q === '') return [];
  const palabras = q.split(' ');
  const aciertos = [];
  for (const item of indice) {
    if (!palabras.every(p => incluyePalabra(item.texto, p))) continue;
    const rango = item.nombre.startsWith(q) ? 0 : item.nombre.includes(palabras[0]) ? 1 : 2;
    aciertos.push({ item, rango });
  }
  aciertos.sort((a, b) => a.rango - b.rango || a.item.nombre.localeCompare(b.item.nombre));
  return aciertos.slice(0, limite).map(x => x.item.alimento);
}

// Macros de una cantidad concreta de un alimento de la base (valores por
// 100 g). Sin porción, `cantidad` son gramos; con porción, `cantidad` es el
// número de porciones (1.5 tazas) y los gramos se derivan de porcion.g.
// Redondeo a 1 decimal: es la resolución con la que el almacén guarda y
// suficiente para que una suma de 20 entradas no arrastre basura binaria.
// kcalFuente se escala igual: es la etiqueta de la base, guardada como dato.
export function macrosDeCantidad(alimento, cantidad, porcion = null) {
  const n = Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 0;
  const gramos = porcion && Number.isFinite(porcion.g) ? n * porcion.g : n;
  const f = gramos / 100;
  const r1 = x => Math.round((Number(x) || 0) * f * 10) / 10;
  return {
    gramos: Math.round(gramos * 10) / 10,
    macros: {
      prot: r1(alimento.proteina_g),
      carb: r1(alimento.carbohidratos_g),
      gras: r1(alimento.grasa_g),
      kcalFuente: r1(alimento.kcal)
    }
  };
}

// LA regla de las kcal mostradas: 4P + 4C + 9G, la misma con la que la meta
// se deriva de sus macros. Ningún otro sitio del módulo multiplica 4/4/9.
// Devuelve el número crudo; quien pinta redondea.
export function kcalDerivada(m) {
  return 4 * (Number(m?.prot) || 0) + 4 * (Number(m?.carb) || 0) + 9 * (Number(m?.gras) || 0);
}

// Suma un día del diario: total y subtotal por comida, con la kcal derivada
// del TOTAL de macros (no de la suma de kcal por entrada: así total y barras
// cuadran siempre entre sí). Tolera día ausente o franjas que falten.
export function sumarDia(dia) {
  const total = { prot: 0, carb: 0, gras: 0, kcal: 0, comidas: {} };
  for (const c of COMIDAS) {
    const sub = { prot: 0, carb: 0, gras: 0, kcal: 0 };
    const lista = dia && Array.isArray(dia[c]) ? dia[c] : [];
    for (const e of lista) {
      sub.prot += e.macros.prot;
      sub.carb += e.macros.carb;
      sub.gras += e.macros.gras;
    }
    sub.kcal = kcalDerivada(sub);
    total.comidas[c] = sub;
    total.prot += sub.prot;
    total.carb += sub.carb;
    total.gras += sub.gras;
  }
  total.kcal = kcalDerivada(total);
  return total;
}

// La meta del DÍA a partir de la meta POR COMIDA que entrega getMeta().
// - origen 'formula' o 'manual_dia': meta × meta.comidas (el usuario ya dijo
//   cuántas comidas al repartir su meta).
// - origen 'manual_comida': la meta llegó ya por comida (comidas = 1) y NADIE
//   ha dicho cuántas comidas hace al día → hace falta perfil.comidasDiario.
//   Sin él se devuelve { pendiente: true } y la UI lo pregunta UNA vez.
// Aquí no se calcula ninguna meta: solo se multiplica la que ya existe.
export function metaDelDia(meta, perfil) {
  if (!meta || !Number.isFinite(meta.prot)) return null;
  let n;
  if (meta.origen === 'manual_comida') {
    n = perfil && Number.isFinite(perfil.comidasDiario) && perfil.comidasDiario > 0
      ? perfil.comidasDiario
      : null;
    if (n === null) return { pendiente: true };
  } else {
    n = Number.isFinite(meta.comidas) && meta.comidas > 0 ? meta.comidas : 1;
  }
  return { kcal: meta.kcal * n, prot: meta.prot * n, carb: meta.carb * n, gras: meta.gras * n, n };
}

// Suma días a una fecha ISO en hora LOCAL: el Date local absorbe el cambio de
// mes/año y hoyISO() la vuelve a formatear con la misma regla del almacén.
function sumarDias(fechaISO, delta) {
  const [a, m, d] = fechaISO.split('-').map(Number);
  return almacen.hoyISO(new Date(a, m - 1, d + delta).getTime());
}

// ── ESTADO DE LA UI (de aquí para abajo hay DOM) ─────────────────────────────

let raiz = null;            // la <section> que el shell nos presta
let raizCableada = null;    // contra doble init: los listeners se cuelgan una vez
let getMeta = null;         // la meta POR COMIDA, siempre del shell
let estado = null;          // snapshot del almacén; cada mutación lo reemplaza
let fecha = '';             // día visible ('YYYY-MM-DD')
let vista = 'dia';          // 'dia' | 'buscar' | 'detalle' | 'semana'

// Buscador
let base = null;            // lista de alimentos (por 100 g) o null
let indice = [];            // índice normalizado en memoria
let baseError = false;      // fetch fallido → "Base de alimentos no disponible"
let basePromesa = null;     // la carga corre UNA vez; se resetea solo si falló
let consulta = '';
let comidaDestino = 'comida';
let enfocarBuscador = false;
let chipPorId = new Map();  // id → última entrada, para los chips de recientes

// Detalle (alta o edición de una entrada)
let det = null;

// Toast de deshacer: una sola acción viva a la vez; la nueva pisa a la vieja.
let toastTimer = null;
let deshacerFn = null;

// "Tus datos"
let datosAbierto = false;
let importPendiente = null; // estado ya migrado, esperando confirmación
let importError = '';
let importOk = false;
let fallaGuardado = false;  // guardar() devolvió false: se avisa, no se rompe

const esc = s => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
// Cifras sin basura binaria: 1 decimal si lo hay, entero si no.
const fmt1 = n => String(Math.round(n * 10) / 10);
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const MAS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

function persistir() {
  // Escritura por INJERTO sobre el estado fresco del disco: este módulo solo
  // es dueño del diario, de recientes.alimentos y de perfil.comidasDiario.
  // Guardar el snapshot entero pisaría lo que Pedir o Entrenar escribieron
  // desde su pestaña (la pérdida de datos que cazó la auditoría).
  const r = almacen.actualizar(e => ({
    ...e,
    diario: estado.diario,
    recientes: { ...e.recientes, alimentos: estado.recientes.alimentos },
    perfil: e.perfil
      ? { ...e.perfil, comidasDiario: estado.perfil?.comidasDiario ?? e.perfil.comidasDiario }
      : estado.perfil
  }));
  estado = r.estado;
  // Si localStorage falla (modo privado, cuota), la sesión sigue en memoria y
  // el día lo avisa una vez: perder datos en silencio sería peor que avisar.
  if (!r.guardado) fallaGuardado = true;
}

function irVista(v) {
  vista = v;
  render();
  window.scrollTo(0, 0);
}

// ── Base de alimentos: fetch lazy, una vez ───────────────────────────────────

function cargarBase() {
  if (basePromesa) return basePromesa;
  baseError = false;
  basePromesa = fetch('data/alimentos.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(lista => {
      base = Array.isArray(lista) ? lista : [];
      indice = construirIndice(base);
    })
    .catch(() => {
      // Promesa a null: "Reintentar" puede volver a disparar la carga.
      baseError = true;
      basePromesa = null;
    })
    .finally(() => {
      // Solo la zona de resultados: un render() completo reconstruiría el
      // campo de búsqueda y le robaría el foco justo al empezar a teclear.
      if (vista !== 'buscar') return;
      const zona = raiz?.querySelector('[data-zona="resultados"]');
      if (zona) zona.innerHTML = htmlResultados();
      anunciarResultados();
    });
  return basePromesa;
}

// ── Recientes y frecuentes ───────────────────────────────────────────────────

// La última entrada registrada con ese id, buscando del día más nuevo al más
// viejo: es la que presta nombre y cantidad al chip ("Avena · 60 g").
function ultimaEntradaPorId(id) {
  const fechas = Object.keys(estado.diario).sort().reverse();
  for (const f of fechas) {
    const dia = estado.diario[f];
    for (const c of COMIDAS) {
      const lista = dia[c] || [];
      for (let i = lista.length - 1; i >= 0; i--) {
        if (lista[i].id === id) return lista[i];
      }
    }
  }
  return null;
}

// Chips del buscador: recientes primero (el orden del almacén ya es "más
// reciente al frente") y después los frecuentes de los últimos 30 días que no
// estén ya en la fila. Tocar un chip registra con la última cantidad: es el
// camino de ≤3 toques (+ de la comida → chip) para lo que comes a diario.
function chipsSugeridos() {
  chipPorId = new Map();
  const vistos = new Set();
  const recientes = [];
  for (const id of estado.recientes.alimentos) {
    if (recientes.length >= 8) break;
    const e = ultimaEntradaPorId(id);
    if (!e) continue;
    recientes.push(e);
    vistos.add(id);
    chipPorId.set(id, e);
  }
  const cuenta = {};
  const fechas = Object.keys(estado.diario).sort().reverse().slice(0, 30);
  for (const f of fechas) {
    for (const c of COMIDAS) {
      for (const e of estado.diario[f][c] || []) cuenta[e.id] = (cuenta[e.id] || 0) + 1;
    }
  }
  const frecuentes = [];
  for (const id of Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])) {
    if (frecuentes.length >= 4) break;
    if (vistos.has(id)) continue;
    const e = ultimaEntradaPorId(id);
    if (!e) continue;
    frecuentes.push(e);
    chipPorId.set(id, e);
  }
  return recientes.concat(frecuentes);
}

// ── Mutaciones del diario (todas pasan por el almacén y persisten) ───────────

function agregarEntradas(f, comida, entradas, textoToast) {
  // Cada entrada lleva un ts único: el deshacer quita EXACTAMENTE lo que se
  // añadió aquí (por ts + id), no "las N últimas de la franja": mover otra
  // entrada a esa comida, o un plato llegado desde Pedir, la ponía al final
  // y el deshacer viejo borraba la equivocada.
  const base = Date.now();
  const marcadas = entradas.map((e, i) => ({ ...e, ts: base + i }));
  for (const e of marcadas) estado = almacen.agregarAlDiario(estado, f, comida, e);
  persistir();
  irVista('dia');
  const claves = new Set(marcadas.map(e => e.ts + '|' + e.id));
  mostrarToast(textoToast, () => {
    const lista = estado.diario[f]?.[comida] || [];
    for (let i = lista.length - 1; i >= 0; i--) {
      if (claves.has(lista[i].ts + '|' + lista[i].id)) estado = almacen.quitarDelDiario(estado, f, comida, i);
    }
    persistir();
    if (vista === 'dia') render();
  });
}

function agregarDesdeChip(id) {
  const e = chipPorId.get(id);
  if (!e) return;
  // Se repite tal cual (misma cantidad, mismos macros), con ts de ahora.
  agregarEntradas(fecha, comidaDestino, [{ ...e, ts: Date.now() }],
    `${e.nombre} en ${COMIDA_LBL[comidaDestino].toLowerCase()}`);
}

function repetirAyer(comida) {
  const ayer = estado.diario[sumarDias(fecha, -1)];
  const lista = ayer?.[comida] || [];
  if (!lista.length) return;
  agregarEntradas(fecha, comida, lista.map(e => ({ ...e, ts: Date.now() })),
    `${lista.length === 1 ? '1 alimento' : lista.length + ' alimentos'} de ayer en ${COMIDA_LBL[comida].toLowerCase()}`);
}

// ── Detalle: alta desde la base, o edición de una entrada existente ──────────

// La porción por defecto es la unidad NATURAL del alimento si la tiene: con
// porciones[0] el huevo arrancaba en "1 taza picada" (136 g ≈ 2,7 huevos).
const UNIDAD_NATURAL = /\b(pieza|unidad|rebanada|huevo|filete|tortilla|bolillo|telera|taco|tamal|chico|chica|mediano|mediana|grande|vaso|botella)\b/i;
// Las bebidas de la carta COSECHA solo declaran ml: su fila es por 100 ml y
// así se rotula (1 ml cuenta como 1 unidad de cantidad; la proporción es exacta).
function unidadDe(al) {
  return /^(BE\d|ADD-)/.test(al?.id_fuente || '') ? 'ml' : 'g';
}

function porcionDe(al) {
  const lista = Array.isArray(al.porciones) ? al.porciones.filter(p => p && Number.isFinite(p.g) && p.g > 0) : [];
  const p = lista.find(x => UNIDAD_NATURAL.test(x.nombre || '')) || lista[0] || null;
  return p && typeof p.nombre === 'string' && Number.isFinite(p.g) && p.g > 0
    ? { nombre: p.nombre, g: p.g }
    : null;
}

function abrirDetalleNuevo(al) {
  const porcion = porcionDe(al);
  det = {
    modo: 'nuevo',
    alimento: al,
    id: typeof al.id === 'string' && al.id !== '' ? al.id : al.nombre,
    nombre: al.nombre,
    comida: comidaDestino,
    porcion,
    // Con porción casera se parte de 1 porción; sin ella, de 100 g (la unidad
    // de la base). Nunca un campo vacío: un valor es editable, un hueco no.
    cantidad: porcion ? 1 : 100,
    editable: true,
    ref: null,
    entrada: null
  };
  irVista('detalle');
}

function abrirDetalleEdicion(f, comida, indice) {
  const e = estado.diario[f]?.[comida]?.[indice];
  if (!e) return;
  const enBase = base ? base.find(a => a.id === e.id) : null;
  let alimento = null, porcion = null, cantidad = 0, editable = false;
  if (enBase) {
    alimento = enBase;
    const match = e.porcion && Array.isArray(enBase.porciones)
      ? enBase.porciones.find(p => p.g === e.porcion.g && p.nombre === e.porcion.nombre)
      : null;
    porcion = match ? { nombre: match.nombre, g: match.g } : null;
    cantidad = porcion ? Math.round((e.gramos / porcion.g) * 100) / 100 : e.gramos;
    editable = true;
  } else if (e.gramos > 0) {
    // Sin alimento en la base (un plato COSECHA, o una base que cambió), la
    // propia entrada hace de alimento por 100 g: reescalar sigue siendo
    // posible y los macros guardan la misma proporción que traían.
    const f100 = 100 / e.gramos;
    alimento = {
      id: e.id, nombre: e.nombre,
      proteina_g: e.macros.prot * f100,
      carbohidratos_g: e.macros.carb * f100,
      grasa_g: e.macros.gras * f100,
      kcal: e.macros.kcalFuente * f100,
      porciones: e.porcion ? [e.porcion] : []
    };
    porcion = e.porcion ? { ...e.porcion } : null;
    cantidad = porcion ? Math.round((e.gramos / porcion.g) * 100) / 100 : e.gramos;
    editable = true;
  }
  // Con gramos en 0 no hay proporción que escalar: solo mover de comida o quitar.
  det = {
    modo: 'editar', alimento, porcion, cantidad, editable,
    id: e.id, nombre: e.nombre, comida,
    ref: { fecha: f, comida, indice }, entrada: e
  };
  irVista('detalle');
}

function confirmarDetalle() {
  if (det.modo === 'nuevo') {
    const { gramos, macros } = macrosDeCantidad(det.alimento, det.cantidad, det.porcion);
    if (gramos <= 0) { avisarCantidad(); return; }
    const entrada = {
      id: det.id, nombre: det.nombre, gramos,
      porcion: det.porcion, macros, origen: 'base', ts: Date.now()
    };
    agregarEntradas(fecha, det.comida, [entrada],
      `${entrada.nombre} en ${COMIDA_LBL[det.comida].toLowerCase()}`);
    return;
  }
  const ref = det.ref;
  let gramos, porcion, macros;
  if (det.editable) {
    ({ gramos, macros } = macrosDeCantidad(det.alimento, det.cantidad, det.porcion));
    if (gramos <= 0) { avisarCantidad(); return; }
    porcion = det.porcion;
  } else {
    ({ gramos, porcion, macros } = det.entrada);
  }
  if (det.comida === ref.comida) {
    estado = almacen.editarEnDiario(estado, ref.fecha, ref.comida, ref.indice, { gramos, porcion, macros });
  } else {
    // Cambió de franja: se quita de donde estaba y se agrega a la nueva, con
    // su ts original (fue comida cuando fue comida; mover no es re-registrar).
    const nueva = { ...det.entrada, gramos, porcion, macros };
    estado = almacen.quitarDelDiario(estado, ref.fecha, ref.comida, ref.indice);
    estado = almacen.agregarAlDiario(estado, ref.fecha, det.comida, nueva);
  }
  persistir();
  irVista('dia');
}

// Cantidad vacía o 0: no hay nada que guardar, pero el toque no puede morir en
// silencio. Un solo mensaje (no uno por toque), ligado al campo.
// ── Registro a mano: lo que no está en la base también se puede anotar ────────
let manual = { nombre: '', prot: '', carb: '', gras: '' };

function htmlManual() {
  const n = v => (Number.isFinite(parseFloat(v)) && parseFloat(v) >= 0 ? parseFloat(v) : 0);
  const kcal = Math.round(kcalDerivada({ prot: n(manual.prot), carb: n(manual.carb), gras: n(manual.gras) }));
  const campo = (id, lbl, val) => `<div class="fg"><label for="dia-m-${id}">${lbl}</label>
      <input type="number" inputmode="decimal" min="0" max="500" id="dia-m-${id}" data-rol="manual-campo" data-campo="${id}" value="${esc(val)}"></div>`;
  return `<div class="dia-sub-hd">
      <button type="button" class="dia-volver" data-accion="manual-volver">${CHEV}<span>Buscar</span></button>
    </div>
    <h2 class="stitle dia-sub-titulo">Registrar a mano</h2>
    <p class="dia-vacio-s">Escribe lo que comiste y sus macros (de la etiqueta o tu app de confianza). Las calorías se calculan solas.</p>
    <div class="fg"><label for="dia-m-nombre">Alimento</label>
      <input type="text" id="dia-m-nombre" data-rol="manual-campo" data-campo="nombre" maxlength="60" value="${esc(manual.nombre)}"></div>
    <div class="form-grid">
      ${campo('prot', 'Proteína — g', manual.prot)}
      ${campo('carb', 'Carbohidratos — g', manual.carb)}
      ${campo('gras', 'Grasas — g', manual.gras)}
    </div>
    <p class="dia-manual-kcal" data-zona="manual-kcal" aria-live="polite">${kcal} kcal</p>
    <p class="form-error" data-zona="manual-error" role="alert"></p>
    <button type="button" class="btn btn-main dia-cta" data-accion="manual-confirmar">Agregar a ${COMIDA_LBL[comidaDestino].toLowerCase()}</button>`;
}

function confirmarManual() {
  const nombre = manual.nombre.trim();
  const n = v => parseFloat(v);
  const vals = { prot: n(manual.prot), carb: n(manual.carb), gras: n(manual.gras) };
  const err = raiz.querySelector('[data-zona="manual-error"]');
  const malos = Object.entries(vals).filter(([, v]) => !(Number.isFinite(v) && v >= 0 && v <= 500));
  if (!nombre || malos.length || vals.prot + vals.carb + vals.gras <= 0) {
    if (err) err.textContent = !nombre ? 'Escribe qué comiste.' : 'Revisa los macros: números de 0 a 500 g, al menos uno mayor que 0.';
    return;
  }
  const entrada = {
    id: 'MANUAL-' + normalizarTexto(nombre).replace(/\s+/g, '-'),
    nombre, gramos: 0, porcion: null,
    macros: { ...vals, kcalFuente: kcalDerivada(vals) },
    origen: 'base', ts: Date.now()
  };
  manual = { nombre: '', prot: '', carb: '', gras: '' };
  agregarEntradas(fecha, comidaDestino, [entrada], `${nombre} en ${COMIDA_LBL[comidaDestino].toLowerCase()}`);
}

function avisarCantidad() {
  const campo = raiz.querySelector('#dia-cantidad');
  if (campo) { campo.setAttribute('aria-invalid', 'true'); campo.setAttribute('aria-describedby', 'dia-cant-error'); campo.focus(); }
  const vivo = raiz.querySelector('[data-zona="detalle-macros"]');
  if (vivo && !raiz.querySelector('#dia-cant-error')) {
    vivo.insertAdjacentHTML('afterbegin', '<p class="form-error" id="dia-cant-error" role="alert">Escribe una cantidad mayor que 0.</p>');
  }
}

function quitarDesdeDetalle() {
  const { fecha: f, comida: c, indice } = det.ref;
  const e = estado.diario[f]?.[c]?.[indice];
  estado = almacen.quitarDelDiario(estado, f, c, indice);
  persistir();
  irVista('dia');
  if (e) {
    // Deshacer re-agrega al FINAL de la franja: se pierde la posición exacta,
    // pero recuperar el dato importa más que el orden dentro de la comida.
    mostrarToast(`Quitaste ${e.nombre}`, () => {
      estado = almacen.agregarAlDiario(estado, f, c, e);
      persistir();
      if (vista === 'dia') render();
    });
  }
}

// ── Toast de deshacer ────────────────────────────────────────────────────────

function mostrarToast(texto, fn) {
  const zona = raiz.querySelector('[data-zona="toast"]');
  if (!zona) return;
  clearTimeout(toastTimer);
  deshacerFn = fn || null;
  zona.innerHTML = `<div class="dia-toast" role="status">
    <span class="dia-toast-txt">${esc(texto)}</span>
    ${fn ? '<button type="button" class="dia-toast-btn" data-accion="deshacer">Deshacer</button>' : ''}
  </div>`;
  // Doble rAF: la clase de entrada tiene que llegar un frame después de que
  // el nodo exista, o la transición (solo transform/opacity) no corre. Con
  // prefers-reduced-motion el barrido global de styles.css la deja en .01ms.
  const t = zona.firstElementChild;
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('dia-toast-on')));
  toastTimer = setTimeout(ocultarToast, TOAST_MS);
  // WCAG 2.2.1: con el foco o el puntero encima el tiempo se pausa; al salir
  // vuelve a correr entero. Con teclado ya se alcanza "Deshacer" a tiempo.
  const pausar = () => clearTimeout(toastTimer);
  const seguir = () => { clearTimeout(toastTimer); toastTimer = setTimeout(ocultarToast, TOAST_MS); };
  t.addEventListener('focusin', pausar);
  t.addEventListener('mouseenter', pausar);
  t.addEventListener('focusout', seguir);
  t.addEventListener('mouseleave', seguir);
}

function ocultarToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  deshacerFn = null;
  const zona = raiz?.querySelector('[data-zona="toast"]');
  if (zona) zona.innerHTML = '';
}

// ── Exportar / importar ──────────────────────────────────────────────────────

function exportarRespaldo() {
  const blob = new Blob([almacen.exportarJSON(estado)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cosecha-respaldo-${almacen.hoyISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // El revoke va diferido: revocar en el mismo tick corta la descarga en Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function recibirArchivo(archivo) {
  archivo.text().then(texto => {
    importOk = false;
    try {
      // importarJSON migra y valida; si el archivo no sirve, lanza con un
      // mensaje en es-MX que se pinta tal cual bajo los botones.
      importPendiente = almacen.importarJSON(texto);
      importError = '';
    } catch (e) {
      importPendiente = null;
      importError = e.message;
    }
    datosAbierto = true;
    render();
  });
}

function confirmarImportacion() {
  estado = importPendiente;
  importPendiente = null;
  importOk = true;
  // Importar es la ÚNICA operación de reemplazo TOTAL: el respaldo se escribe
  // entero, sin pasar por el injerto de persistir() (que solo lleva las ramas
  // del diario y descartaba entrenamientos, rutinas y meta en silencio).
  const r = almacen.actualizar(() => estado);
  estado = r.estado;
  if (!r.guardado) fallaGuardado = true;
  window.dispatchEvent(new CustomEvent('cosecha:importado'));
  fecha = almacen.hoyISO();
  datosAbierto = true;
  render();
}

// ── HTML de cada vista ───────────────────────────────────────────────────────

function etiquetaFecha(f) {
  const hoy = almacen.hoyISO();
  const [a, m, d] = f.split('-').map(Number);
  const txt = new Date(a, m - 1, d).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
  if (f === hoy) return 'Hoy · ' + txt;
  if (f === sumarDias(hoy, -1)) return 'Ayer · ' + txt;
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// Una barra de macro con el patrón EXACTO del tracker de Pedir: riel .bar-bg,
// relleno .bar-fill animado con transform:scaleX (nunca width) y los tres
// canales --green/--blue/--amber. .bover marca el exceso con su trama.
function htmlBarra(lbl, clase, valor, meta, unidad = 'g') {
  const frac = meta > 0 ? Math.min(1, valor / meta) : 0;
  const umbral = unidad === 'g' ? UMBRAL_G : UMBRAL_G * 17; // ±4 g ↔ ±68 kcal (4·4+4·4+9·4)
  const over = meta > 0 && valor > meta + umbral;
  return `<div class="gt-bar-wrap">
    <div class="gt-bar-top"><span class="gt-bar-lbl">${lbl}</span><span class="gt-bar-val">${Math.round(valor)}/${Math.round(meta)}${unidad}</span></div>
    <div class="bar-bg"><div class="bar-fill ${clase}${over ? ' bover' : ''}" style="transform:scaleX(${frac})"></div></div>
  </div>`;
}

function htmlProgreso(md, sumas) {
  const kcal = Math.round(sumas.kcal);
  const restante = Math.round(md.kcal - sumas.kcal);
  const linea = restante >= 0
    ? `Te quedan ${restante} kcal ${fecha === almacen.hoyISO() ? 'hoy' : 'ese día'}.`
    : `Llevas ${-restante} kcal por encima de tu meta.`;
  return `<section class="gap-wrap dia-progreso" aria-label="Progreso del día">
    <div class="gap-hd dia-progreso-hd"><span>Tu día</span><span class="dia-kcal">${kcal} / ${Math.round(md.kcal)} kcal</span></div>
    <div class="dia-barras">
      ${htmlBarra('Proteína', 'bp', sumas.prot, md.prot)}
      ${htmlBarra('Carbos', 'bc', sumas.carb, md.carb)}
      ${htmlBarra('Grasas', 'bg2', sumas.gras, md.gras)}
    </div>
    <p class="dia-restante">${linea}</p>
  </section>`;
}

// La meta llegó por comida y nadie dijo cuántas comidas al día: se pregunta
// UNA vez (guardarPerfil la deja en perfil.comidasDiario) y no se vuelve a ver.
function htmlPreguntaComidas() {
  return `<section class="gap-wrap dia-pregunta" aria-label="Comidas por día">
    <div class="gap-hd"><span>Tu meta</span></div>
    <div class="dia-pregunta-body">
      <p>Tu meta está definida por comida. ¿Cuántas comidas registras al día? Lo preguntamos una sola vez.</p>
      <div class="dia-pills">
        ${[2, 3, 4, 5].map(n => `<button type="button" class="dia-pill" data-accion="comidas-dia" data-n="${n}">${n}</button>`).join('')}
      </div>
    </div>
  </section>`;
}

function htmlEntrada(e, comida, i) {
  const kcal = Math.round(kcalDerivada(e.macros));
  const cant = e.porcion
    ? `${fmt1(e.gramos / e.porcion.g)} × ${esc(e.porcion.nombre)}`
    : `${fmt1(e.gramos)} g`;
  return `<li><button type="button" class="dia-entrada" data-accion="editar-entrada" data-comida="${comida}" data-indice="${i}">
    <span class="dia-e-main">
      <span class="dia-e-nm">${esc(e.nombre)}</span>
      <span class="dia-e-sub">${cant} · P${Math.round(e.macros.prot)} C${Math.round(e.macros.carb)} G${Math.round(e.macros.gras)}</span>
    </span>
    <span class="dia-e-kcal">${kcal} kcal</span>
  </button></li>`;
}

function htmlComidas(sumas) {
  const dia = estado.diario[fecha] || {};
  const ayer = estado.diario[sumarDias(fecha, -1)] || {};
  return COMIDAS.map(c => {
    const lista = dia[c] || [];
    const sub = sumas.comidas[c];
    // Sin entradas el subtotal se queda vacío: un "—" junto al botón de +
    // se leía como un botón de menos (visto en el humo con Chrome).
    const kcal = lista.length ? `${Math.round(sub.kcal)} kcal` : '';
    const repetir = !lista.length && (ayer[c] || []).length
      ? `<div class="dia-vacia-zona"><button type="button" class="dia-chip" data-accion="repetir-ayer" data-comida="${c}">
           <span class="dia-chip-nm">Repetir lo de ayer</span><span class="dia-chip-sub">${(ayer[c]).length === 1 ? '1 alimento' : (ayer[c]).length + ' alimentos'}</span>
         </button></div>`
      : '';
    const cuerpo = lista.length
      ? `<ul class="dia-lista">${lista.map((e, i) => htmlEntrada(e, c, i)).join('')}</ul>`
      : `<p class="dia-vacia">Aún no registras nada.</p>${repetir}`;
    return `<section class="dia-comida" aria-label="${COMIDA_LBL[c]}">
      <header class="dia-comida-hd">
        <span class="dia-comida-nm">${COMIDA_LBL[c]}</span>
        <span class="dia-comida-kcal">${kcal}</span>
        <button type="button" class="dia-mas" data-accion="abrir-buscar" data-comida="${c}" aria-label="Agregar a ${COMIDA_LBL[c].toLowerCase()}">${MAS}</button>
      </header>
      ${cuerpo}
    </section>`;
  }).join('');
}

function htmlDatos() {
  const confirmar = importPendiente ? `<div class="dia-import-confirmar" role="alert">
      <p>Esto sustituye tu diario y tus entrenamientos actuales por los del respaldo.</p>
      <div class="dia-datos-botones">
        <button type="button" class="btn btn-main" data-accion="importar-confirmar">Sí, importar</button>
        <button type="button" class="btn btn-ghost" data-accion="importar-cancelar">Cancelar</button>
      </div>
    </div>` : '';
  return `<details class="dia-datos"${datosAbierto ? ' open' : ''}>
    <summary class="dia-datos-sum" data-accion="datos-toggle">
      <span>Tus datos</span>
      <span class="dia-datos-chev" aria-hidden="true">${CHEV}</span>
    </summary>
    <div class="dia-datos-body">
      <p>Tu diario vive solo en este dispositivo: nada sale a ningún servidor. Llévate un respaldo en JSON o restaura uno.</p>
      <p class="dia-fuentes">Datos nutricionales: USDA FoodData Central (dominio público, CC0 1.0) y carta COSECHA. Los desvíos de etiqueta van marcados, no corregidos.</p>
      <div class="dia-datos-botones">
        <button type="button" class="btn btn-ghost" data-accion="exportar">Exportar respaldo</button>
        <button type="button" class="btn btn-ghost" data-accion="importar-elegir">Importar respaldo</button>
      </div>
      <input type="file" accept="application/json,.json" data-rol="importar-file" hidden aria-hidden="true">
      ${importError ? `<p class="form-error" role="alert">${esc(importError)}</p>` : ''}
      ${confirmar}
      ${importOk ? '<p class="dia-datos-ok">Respaldo importado.</p>' : ''}
    </div>
  </details>`;
}

// Sin meta no hay contra qué medir el día: el diario espera al perfil en vez
// de inventarse una meta propia (regla del proyecto: una sola fuente de meta).
function htmlVacio() {
  return `<div class="dia-vacio">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5a2 2 0 0 1 2-2h12v18H7a2 2 0 0 1-2-2z"/><path d="M9 3v18"/></svg>
    <p class="dia-vacio-t">Tu diario usa la misma meta que tu plato</p>
    <p class="dia-vacio-s">Crea tu perfil una sola vez y aquí verás tu progreso de proteína, carbohidratos y grasas de cada día.</p>
    <button type="button" class="btn btn-main" data-accion="ir-pedir">Completa tu perfil en Pedir</button>
  </div>
  ${htmlDatos()}`;
}

function htmlDia() {
  const meta = getMeta ? getMeta() : null;
  if (!meta) return htmlVacio();
  const md = metaDelDia(meta, estado.perfil);
  const sumas = sumarDia(estado.diario[fecha]);
  const hoy = almacen.hoyISO();
  const esHoy = fecha === hoy;
  const aviso = fallaGuardado
    ? '<p class="form-error" role="alert">No pude guardar en este dispositivo: tus cambios podrían perderse al cerrar. Revisa el espacio o el modo privado.</p>'
    : '';
  return `<nav class="dia-fechas" aria-label="Cambiar de día">
      <button type="button" class="dia-fecha-btn" data-accion="fecha-prev" aria-label="Día anterior">${CHEV}</button>
      <div class="dia-fecha-centro">
        <span class="dia-fecha-lbl">${etiquetaFecha(fecha)}</span>
        ${esHoy ? '' : '<button type="button" class="dia-hoy-btn" data-accion="fecha-hoy">Hoy</button>'}
      </div>
      <button type="button" class="dia-fecha-btn dia-fecha-sig" data-accion="fecha-next" aria-label="Día siguiente" ${esHoy ? 'disabled' : ''}>${CHEV}</button>
    </nav>
    ${aviso}
    ${md && md.pendiente ? htmlPreguntaComidas() : ''}
    ${md && !md.pendiente ? htmlProgreso(md, sumas) : ''}
    ${htmlComidas(sumas)}
    <button type="button" class="btn btn-ghost dia-semana-btn" data-accion="ver-semana">Ver mi semana</button>
    ${htmlDatos()}`;
}

// ── Buscador ─────────────────────────────────────────────────────────────────

function htmlChips() {
  const chips = chipsSugeridos();
  if (!chips.length) return '';
  return `<div class="dia-chips-zona">
    <div class="sec-lbl">Recientes y frecuentes</div>
    <div class="dia-chips">${chips.map(e => {
      const cant = e.porcion ? `${fmt1(e.gramos / e.porcion.g)} × ${esc(e.porcion.nombre)}` : `${fmt1(e.gramos)} g`;
      return `<button type="button" class="dia-chip" data-accion="chip" data-id="${esc(e.id)}">
        <span class="dia-chip-nm">${esc(e.nombre)}</span>
        <span class="dia-chip-sub">${cant} · ${Math.round(kcalDerivada(e.macros))} kcal</span>
      </button>`;
    }).join('')}</div>
  </div>`;
}

// Los resultados cambian sin mover el foco: sin un mensaje de estado, quien
// usa lector de pantalla no se entera de que hay (o no hay) coincidencias
// (WCAG 4.1.3). Se anuncia el CONTEO, con pausa, no la lista entera.
let anuncioT = null;
function anunciarResultados() {
  clearTimeout(anuncioT);
  anuncioT = setTimeout(() => {
    const el = raiz?.querySelector('[data-zona="anuncio"]');
    const zona = raiz?.querySelector('[data-zona="resultados"]');
    if (!el || !zona) return;
    if (normalizarTexto(consulta) === '') { el.textContent = ''; return; }
    const n = zona.querySelectorAll('[data-accion="resultado"]').length;
    el.textContent = n ? `${n} ${n === 1 ? 'resultado' : 'resultados'}` : 'Sin resultados';
  }, 450);
}

function htmlResultados() {
  if (baseError) {
    return `<div class="dia-estado">
      <p class="dia-vacio-t">Base de alimentos no disponible</p>
      <p class="dia-vacio-s">No pude cargar la lista de alimentos. Tus recientes siguen funcionando.</p>
      <button type="button" class="btn btn-ghost" data-accion="reintentar-base">Reintentar</button>
    </div>`;
  }
  if (base === null) return '<p class="dia-estado dia-vacio-s">Cargando la base de alimentos…</p>';
  if (normalizarTexto(consulta) === '') return '';
  const lista = buscar(indice, consulta);
  if (!lista.length) {
    return `<div class="dia-estado">
      <p class="dia-vacio-s">Nada con «${esc(consulta)}». Prueba con otro nombre o regístralo tú.</p>
      <button type="button" class="btn btn-ghost" data-accion="manual">Registrar «${esc(consulta)}» a mano</button>
    </div>`;
  }
  return `<ul class="dia-lista dia-resultados">${lista.map(a => {
    const kcal = Math.round(kcalDerivada({ prot: a.proteina_g, carb: a.carbohidratos_g, gras: a.grasa_g }));
    const p = porcionDe(a);
    return `<li><button type="button" class="dia-entrada" data-accion="resultado" data-id="${esc(a.id)}">
      <span class="dia-e-main">
        <span class="dia-e-nm">${esc(a.nombre)}</span>
        <span class="dia-e-sub">P${fmt1(a.proteina_g)} C${fmt1(a.carbohidratos_g)} G${fmt1(a.grasa_g)} · por 100 ${unidadDe(a)}${p ? ` · ${esc(p.nombre)}` : ''}</span>
      </span>
      <span class="dia-e-kcal">${kcal} kcal</span>
    </button></li>`;
  }).join('')}</ul>
  <button type="button" class="dia-manual-link" data-accion="manual">¿No está? Regístralo a mano</button>`;
}

function htmlBuscar() {
  return `<div class="dia-sub-hd">
      <button type="button" class="dia-volver" data-accion="volver-dia">${CHEV}<span>Diario</span></button>
    </div>
    <h2 class="stitle dia-sub-titulo">Agregar a ${COMIDA_LBL[comidaDestino].toLowerCase()}</h2>
    <div class="dia-buscar-campo">
      <label class="dia-lbl" for="dia-buscar-input">Alimento</label>
      <input type="search" id="dia-buscar-input" data-rol="buscar-input" value="${esc(consulta)}"
        placeholder="Busca por nombre, sin acentos da igual" autocomplete="off">
    </div>
    ${normalizarTexto(consulta) === '' ? htmlChips() : ''}
    <div data-zona="resultados">${htmlResultados()}</div>
    <p class="dia-sr" role="status" aria-live="polite" data-zona="anuncio"></p>`;
}

// ── Detalle ──────────────────────────────────────────────────────────────────

function htmlVivo() {
  if (!det.editable) {
    const m = det.entrada.macros;
    return `<div class="dia-vivo-macros">P ${fmt1(m.prot)} g · C ${fmt1(m.carb)} g · G ${fmt1(m.gras)} g</div>
      <div class="dia-vivo-kcal">${Math.round(kcalDerivada(m))} kcal</div>`;
  }
  const { gramos, macros } = macrosDeCantidad(det.alimento, det.cantidad, det.porcion);
  const kcal = Math.round(kcalDerivada(macros));
  const etiqueta = Math.round(macros.kcalFuente);
  // La etiqueta solo asoma cuando contradice de verdad a los macros (>15 %):
  // los ±9 kcal de redondeo conocidos de la base no son noticia.
  const difiere = kcal > 0 && Math.abs(etiqueta - kcal) / kcal > 0.15;
  return `<div class="dia-vivo-macros">P ${fmt1(macros.prot)} g · C ${fmt1(macros.carb)} g · G ${fmt1(macros.gras)} g</div>
    <div class="dia-vivo-kcal">${kcal} kcal</div>
    ${det.porcion ? `<div class="dia-vivo-g">${fmt1(gramos)} g en total</div>` : ''}
    ${difiere ? `<div class="dia-vivo-etq">La etiqueta dice ${etiqueta} kcal: difiere de sus propios macros.</div>` : ''}`;
}

function htmlDetalle() {
  const porciones = det.editable && det.alimento && Array.isArray(det.alimento.porciones)
    ? det.alimento.porciones.filter(p => p && Number.isFinite(p.g) && p.g > 0)
    : [];
  const pills = det.editable ? `<div class="dia-pills">
      <button type="button" class="dia-pill${det.porcion ? '' : ' dia-pill-on'}" data-accion="porcion" data-idx="-1" aria-pressed="${!det.porcion}">Gramos</button>
      ${porciones.map((p, i) => `<button type="button" class="dia-pill${det.porcion && det.porcion.nombre === p.nombre && det.porcion.g === p.g ? ' dia-pill-on' : ''}" data-accion="porcion" data-idx="${i}" aria-pressed="${!!(det.porcion && det.porcion.g === p.g && det.porcion.nombre === p.nombre)}">${esc(p.nombre)}</button>`).join('')}
    </div>` : '';
  const campo = det.editable ? `<div class="dia-campo">
      <label class="dia-lbl" for="dia-cantidad">Cantidad</label>
      <div class="dia-cant-fila">
        <input type="number" id="dia-cantidad" data-rol="detalle-cantidad" inputmode="decimal"
          min="0" step="${det.porcion ? '0.5' : '1'}" value="${det.cantidad}">
        <span class="dia-cant-unidad">${det.porcion ? 'porciones' : unidadDe(det.alimento)}</span>
      </div>
      ${pills}
    </div>` : '<p class="dia-vacio-s">Esta entrada no trae gramos: puedes moverla de comida o quitarla.</p>';
  const cta = det.modo === 'nuevo' ? `Agregar a ${COMIDA_LBL[det.comida].toLowerCase()}` : 'Guardar cambios';
  return `<div class="dia-sub-hd">
      <button type="button" class="dia-volver" data-accion="detalle-volver">${CHEV}<span>${det.modo === 'nuevo' ? 'Buscar' : 'Diario'}</span></button>
    </div>
    <h2 class="stitle dia-sub-titulo">${esc(det.nombre)}</h2>
    ${campo}
    <div class="dia-vivo" data-zona="detalle-macros" aria-live="polite">${htmlVivo()}</div>
    <div class="dia-campo">
      <div class="sec-lbl">Comida</div>
      <div class="sub-toggle" role="group" aria-label="Comida del día">
        ${COMIDAS.map(c => `<button type="button" class="st-btn${det.comida === c ? ' st-active' : ''}" data-accion="comida-pill" data-comida="${c}" aria-pressed="${det.comida === c}">${COMIDA_LBL[c]}</button>`).join('')}
      </div>
    </div>
    <button type="button" class="btn btn-main dia-cta" data-accion="detalle-confirmar">${cta}</button>
    ${det.modo === 'editar' ? '<button type="button" class="btn btn-ghost dia-cta dia-danger" data-accion="detalle-quitar">Quitar del diario</button>' : ''}`;
}

// ── Vista semanal ────────────────────────────────────────────────────────────

function htmlSemana() {
  const hoy = almacen.hoyISO();
  const dias = [];
  for (let i = 6; i >= 0; i--) dias.push(sumarDias(hoy, -i));
  const acum = { prot: 0, carb: 0, gras: 0 };
  let conRegistro = 0;
  for (const f of dias) {
    const s = sumarDia(estado.diario[f]);
    if (s.prot || s.carb || s.gras) {
      conRegistro++;
      acum.prot += s.prot;
      acum.carb += s.carb;
      acum.gras += s.gras;
    }
  }
  const volver = `<div class="dia-sub-hd">
      <button type="button" class="dia-volver" data-accion="volver-dia">${CHEV}<span>Diario</span></button>
    </div>
    <h2 class="stitle dia-sub-titulo">Tu semana</h2>
    <div class="ssub">${etiquetaFecha(dias[0]).replace('Hoy · ', '').replace('Ayer · ', '')} — ${etiquetaFecha(hoy).replace('Hoy · ', '')}</div>`;
  if (!conRegistro) {
    return `${volver}<p class="dia-estado dia-vacio-s">Aún no registras nada en los últimos 7 días. Lo que agregues al diario aparecerá aquí como promedio.</p>`;
  }
  // Promedio sobre los días CON registro: los días en blanco no son ceros de
  // consumo, son días sin datos, y meterlos hundiría el promedio sin razón.
  const prom = {
    prot: acum.prot / conRegistro,
    carb: acum.carb / conRegistro,
    gras: acum.gras / conRegistro
  };
  prom.kcal = kcalDerivada(prom);
  const meta = getMeta ? getMeta() : null;
  const md = meta ? metaDelDia(meta, estado.perfil) : null;
  const barras = md && !md.pendiente
    ? `<div class="dia-barras dia-sem-barras">
        ${htmlBarra('Kcal', 'dia-bk', prom.kcal, md.kcal, ' kcal')}
        ${htmlBarra('Proteína', 'bp', prom.prot, md.prot)}
        ${htmlBarra('Carbos', 'bc', prom.carb, md.carb)}
        ${htmlBarra('Grasas', 'bg2', prom.gras, md.gras)}
      </div>`
    : `<p class="dia-vacio-s">Promedio: ${Math.round(prom.kcal)} kcal · P${Math.round(prom.prot)} C${Math.round(prom.carb)} G${Math.round(prom.gras)}. Define tu meta en Pedir para comparar.</p>`;
  return `${volver}
    <section class="gap-wrap dia-progreso" aria-label="Promedios de la semana">
      <div class="gap-hd dia-progreso-hd"><span>Promedio diario vs tu meta</span></div>
      ${barras}
      <p class="dia-restante">Promedios de ${conRegistro === 1 ? '1 día' : conRegistro + ' días'} con registro de los últimos 7.</p>
    </section>`;
}

// ── Render y eventos (delegados: el innerHTML cambia, los listeners no) ──────

// Re-render con innerHTML tira el foco del teclado a <body>: activar una
// píldora de porción obligaba a re-tabular desde el principio. Esto describe
// el control activo por sus data-atributos y lo re-enfoca en el DOM nuevo.
function selectorFoco(el) {
  if (!el || el === document.body || !(raiz && raiz.contains(el))) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const d = el.dataset || {};
  const attrs = ['accion', 'id', 'idx', 'comida', 'n', 'rol'].filter(k => d[k] !== undefined)
    .map(k => `[data-${k}="${CSS.escape(d[k])}"]`).join('');
  return attrs ? el.tagName.toLowerCase() + attrs : null;
}

function render() {
  const zona = raiz && raiz.querySelector('[data-zona="vista"]');
  if (!zona) return;
  const foco = selectorFoco(document.activeElement);
  if (vista === 'buscar') zona.innerHTML = htmlBuscar();
  else if (vista === 'detalle') zona.innerHTML = htmlDetalle();
  else if (vista === 'semana') zona.innerHTML = htmlSemana();
  else if (vista === 'manual') zona.innerHTML = htmlManual();
  else zona.innerHTML = htmlDia();
  if (vista === 'buscar' && enfocarBuscador) {
    enfocarBuscador = false;
    zona.querySelector('[data-rol="buscar-input"]')?.focus();
  } else if (foco) {
    zona.querySelector(foco)?.focus({ preventScroll: true });
  }
}

function alClick(ev) {
  const btn = ev.target.closest('[data-accion]');
  if (!btn) return;
  const a = btn.dataset.accion;
  switch (a) {
    case 'fecha-prev':
      fecha = sumarDias(fecha, -1);
      render();
      break;
    case 'fecha-next':
      // Tope en hoy: el diario registra lo comido, no planifica el futuro.
      if (fecha !== almacen.hoyISO()) { fecha = sumarDias(fecha, 1); render(); }
      break;
    case 'fecha-hoy':
      fecha = almacen.hoyISO();
      render();
      break;
    case 'ir-pedir':
      // La navegación es del shell: se toca SU botón en vez de llamar a un
      // global, así este módulo no asume cómo se llama la función de pestañas.
      if (typeof globalThis.crearPerfil === 'function') globalThis.crearPerfil('diario');
      else document.getElementById('tab-pedir')?.click();
      break;
    case 'abrir-buscar':
      comidaDestino = COMIDAS.includes(btn.dataset.comida) ? btn.dataset.comida : almacen.comidaPorHora();
      consulta = '';
      enfocarBuscador = true;
      cargarBase();
      irVista('buscar');
      break;
    case 'volver-dia':
      irVista('dia');
      break;
    case 'reintentar-base':
      cargarBase();
      render();
      break;
    case 'chip':
      agregarDesdeChip(btn.dataset.id);
      break;
    case 'resultado': {
      const al = base && base.find(x => String(x.id) === btn.dataset.id);
      if (al) abrirDetalleNuevo(al);
      break;
    }
    case 'editar-entrada':
      abrirDetalleEdicion(fecha, btn.dataset.comida, Number(btn.dataset.indice));
      break;
    case 'repetir-ayer':
      repetirAyer(btn.dataset.comida);
      break;
    case 'ver-semana':
      irVista('semana');
      break;
    case 'comidas-dia': {
      const n = Number(btn.dataset.n);
      // Si el perfil es null (meta importada sin perfil), el spread arranca de
      // {}: la respuesta vale esta sesión aunque migrar() no pueda retenerla.
      estado = almacen.guardarPerfil(estado, { ...(estado.perfil ?? {}), comidasDiario: n });
      persistir();
      render();
      break;
    }
    case 'porcion': {
      const idx = Number(btn.dataset.idx);
      const gramosActuales = macrosDeCantidad(det.alimento, det.cantidad, det.porcion).gramos;
      if (idx < 0) {
        // A gramos conservando la cantidad real: cambiar de unidad no debe
        // cambiar lo que hay en el plato.
        det.porcion = null;
        det.cantidad = gramosActuales || 100;
      } else {
        const p = det.alimento.porciones[idx];
        det.porcion = { nombre: p.nombre, g: p.g };
        det.cantidad = gramosActuales > 0 ? Math.max(0.5, Math.round((gramosActuales / p.g) * 2) / 2) : 1;
      }
      render();
      break;
    }
    case 'comida-pill':
      det.comida = btn.dataset.comida;
      render();
      break;
    case 'manual':
      manual = { nombre: consulta.trim(), prot: '', carb: '', gras: '' };
      irVista('manual');
      break;
    case 'manual-volver':
      irVista('buscar');
      break;
    case 'manual-confirmar':
      confirmarManual();
      break;
    case 'detalle-volver':
      irVista(det.modo === 'nuevo' ? 'buscar' : 'dia');
      break;
    case 'detalle-confirmar':
      confirmarDetalle();
      break;
    case 'detalle-quitar':
      quitarDesdeDetalle();
      break;
    case 'exportar':
      exportarRespaldo();
      break;
    case 'importar-elegir':
      raiz.querySelector('[data-rol="importar-file"]')?.click();
      break;
    case 'importar-confirmar':
      confirmarImportacion();
      break;
    case 'importar-cancelar':
      importPendiente = null;
      importError = '';
      render();
      break;
    case 'datos-toggle':
      // El click llega ANTES de que el navegador alterne el <details>: el
      // estado que hay que recordar es el contrario del actual.
      importOk = false;
      datosAbierto = !btn.closest('details').open;
      break;
    case 'deshacer': {
      const fn = deshacerFn;
      ocultarToast();
      if (fn) fn();
      break;
    }
  }
}

function alInput(ev) {
  const rol = ev.target.dataset && ev.target.dataset.rol;
  if (rol === 'buscar-input') {
    consulta = ev.target.value;
    // Solo la zona de resultados: repintar el campo mataría el foco y el cursor.
    const zona = raiz.querySelector('[data-zona="resultados"]');
    if (zona) zona.innerHTML = htmlResultados();
    anunciarResultados();
    // Los chips viven fuera de esa zona: con texto se ocultan, sin texto vuelven.
    const chips = raiz.querySelector('.dia-chips-zona');
    if (chips && normalizarTexto(consulta) !== '') chips.hidden = true;
    else if (chips) chips.hidden = false;
  } else if (rol === 'manual-campo') {
    manual[ev.target.dataset.campo] = ev.target.value;
    const z = raiz.querySelector('[data-zona="manual-kcal"]');
    const n = v => (Number.isFinite(parseFloat(v)) && parseFloat(v) >= 0 ? parseFloat(v) : 0);
    if (z) z.textContent = `${Math.round(kcalDerivada({ prot: n(manual.prot), carb: n(manual.carb), gras: n(manual.gras) }))} kcal`;
  } else if (rol === 'detalle-cantidad') {
    const c = raiz.querySelector('#dia-cantidad');
    if (c && c.getAttribute('aria-invalid') === 'true') { c.removeAttribute('aria-invalid'); raiz.querySelector('#dia-cant-error')?.remove(); }
    det.cantidad = parseFloat(ev.target.value);
    const zona = raiz.querySelector('[data-zona="detalle-macros"]');
    if (zona) zona.innerHTML = htmlVivo();
  }
}

function alChange(ev) {
  if (!ev.target.dataset || ev.target.dataset.rol !== 'importar-file') return;
  const archivo = ev.target.files && ev.target.files[0];
  // El value se limpia para poder reelegir el MISMO archivo tras un error.
  ev.target.value = '';
  if (archivo) recibirArchivo(archivo);
}

// ── Contrato con el shell ────────────────────────────────────────────────────

export function initDiario(opts) {
  raiz = opts.raiz;
  getMeta = opts.getMeta;
  estado = almacen.cargar();
  fecha = almacen.hoyISO();
  vista = 'dia';
  // El toast vive FUERA de la zona de vista: un render no se lo lleva.
  raiz.innerHTML = '<div class="dia-wrap" data-zona="vista"></div><div data-zona="toast"></div>';
  if (raizCableada !== raiz) {
    raiz.addEventListener('click', alClick);
    raiz.addEventListener('input', alInput);
    raiz.addEventListener('change', alChange);
    // Con la app abierta en dos pestañas, lo registrado en una no se pierde
    // por un persistir() de la otra con memoria vieja: se relee al instante.
    window.addEventListener('storage', e => { if (e.key === almacen.CLAVE) refrescar(); });
    raizCableada = raiz;
  }
  render();
}

// El shell llama esto al volver a la pestaña: se relee el almacén entero
// (Pedir pudo agregar un plato) y se repinta la vista en la que estaba el
// usuario. Si editaba una entrada que ya no existe, se vuelve al día.
export function refrescar() {
  if (!raiz) return;
  estado = almacen.cargar();
  if (vista === 'detalle' && det && det.ref) {
    const { fecha: f, comida: c, indice } = det.ref;
    if (!estado.diario[f]?.[c]?.[indice]) vista = 'dia';
  }
  render();
}
