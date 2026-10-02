// ═════════════════════════════════════════════════════════════════════════════
// ENTRENAR — registro de fuerza de COSECHA App.
//
// La columna vertebral es la de WHOOP Strength Trainer (biblioteca → rutina →
// sesión → resumen) y el descanso es el de Hevy/Strong, porque esa es LA queja
// recurrente de la comunidad de WHOOP: el timer no arranca solo y avisa mal.
// Aquí palomear la serie ES arrancar el descanso (cero gestos extra) y el fin
// avisa con beep + vibración (js/temporizador.js, preparado en el primer toque
// porque iOS solo permite audio nacido de un gesto).
//
// Reglas que ordenan el módulo:
//  - El estado vive en el almacén (js/almacen.js) y en NINGÚN otro sitio: la
//    sesión activa se persiste con guardarSesionActiva en CADA cambio, así un
//    reload a mitad de serie restaura todo, incluido el descanso en curso
//    (que es exacto al volver porque se guarda la HORA DE FIN, no un contador).
//  - El peso SIEMPRE se guarda en kg (aKg); la unidad del perfil solo cambia
//    lo que se pinta. Así el historial no se corrompe si el usuario cambia
//    de unidad a mitad de camino.
//  - La meta nutricional no se calcula aquí ni en ningún módulo: llega por
//    getMeta() (calcularMeta()/manual vía app.js). Entrenar solo la usa como
//    puerta: sin perfil no hay unidades de peso ni sesión que registrar.
//  - Lo puro (Epley, volumen, series por grupo, la regla de superserie) va
//    exportado y testeado en Node; el DOM solo se toca dentro de initEntreno.
//
// Esquema de sesión (entreno.sesiones[] y sesionActiva):
//   { id, inicioMs, finMs|null, rutinaId|null,
//     ejercicios: [{ idEjercicio, nombre, descansoS, superGrupo: null|n,
//                    series: [{ reps, pesoKg, rir|null, hecha, tsHecha|null }] }],
//     notas }
// La sesión VIVA lleva además `descanso: { finMs, duracionS, idx }`, que se
// limpia al cerrar: es ruido de ejecución, no dato del historial.
// ═════════════════════════════════════════════════════════════════════════════

import * as almacen from './almacen.js';
import { crearDescanso, formatear, pedirWakeLock, liberarWakeLock,
         prepararAudio, avisarFin } from './temporizador.js';

// ── Funciones puras (exportadas para tests/entreno.test.mjs) ─────────────────

// 1RM estimado por Epley: peso × (1 + reps/30). SOLO con series de ≤10 reps:
// por encima la fórmula sobreestima tanto que el "récord" sería ficción, así
// que se devuelve null y la UI no lo rotula. Siempre se presenta "estimado".
export function epley1RM(pesoKg, reps) {
  if (!Number.isFinite(pesoKg) || !Number.isFinite(reps) || pesoKg <= 0) return null;
  if (reps < 1 || reps > 10) return null;
  // Décima de kg: más precisión aparenta una exactitud que una estimación no tiene.
  return Math.round(pesoKg * (1 + reps / 30) * 10) / 10;
}

// Volumen de la sesión = Σ reps × kg de las series HECHAS. Las no palomeadas
// no existen (regla WHOOP: una serie no cuenta hasta que la validas).
export function volumenSesion(sesion) {
  if (!sesion || !Array.isArray(sesion.ejercicios)) return 0;
  let v = 0;
  for (const ej of sesion.ejercicios) {
    for (const s of ej.series || []) {
      if (s.hecha && Number.isFinite(s.reps) && Number.isFinite(s.pesoKg)) v += s.reps * s.pesoKg;
    }
  }
  return Math.round(v * 100) / 100;
}

// Series hechas por grupo muscular (músculo PRIMARIO del catálogo): el
// sustituto honesto de la "carga muscular" de WHOOP — contar series es un dato
// real; estimar estrés fisiológico sin sensores sería inventarlo.
// `porId` es Map u objeto id → ejercicio del catálogo; sin ficha → 'otros'.
export function seriesPorGrupo(sesion, porId) {
  const ficha = porId instanceof Map ? id => porId.get(id) : id => porId?.[id];
  const out = {};
  if (!sesion || !Array.isArray(sesion.ejercicios)) return out;
  for (const ej of sesion.ejercicios) {
    const n = (ej.series || []).filter(s => s.hecha).length;
    if (!n) continue;
    const info = ficha(ej.idEjercicio);
    const grupo = info?.musculosPrimarios?.[0] || 'otros';
    out[grupo] = (out[grupo] || 0) + n;
  }
  return out;
}

// "La última vez": las series HECHAS de la sesión más reciente que incluyó ese
// ejercicio. La UI pinta la posición i junto a la serie i de hoy — comparar
// primera con primera y tercera con tercera es el dato que Hevy/Strong ponen
// de referencia y es el 90 % del valor de registrar.
export function ultimaVez(sesiones, idEjercicio) {
  if (!Array.isArray(sesiones)) return null;
  for (let i = sesiones.length - 1; i >= 0; i--) {
    const ej = (sesiones[i].ejercicios || []).find(e => e.idEjercicio === idEjercicio);
    if (!ej) continue;
    const hechas = (ej.series || []).filter(s => s.hecha);
    // Una sesión donde estaba el ejercicio pero no se hizo ninguna serie no
    // es "la última vez": se sigue buscando hacia atrás.
    if (hechas.length) return hechas.map(s => ({ reps: s.reps, pesoKg: s.pesoKg }));
  }
  return null;
}

// Regla de superserie: en un ejercicio suelto, palomear la serie arranca el
// descanso. En un bloque de 2+ (mismo superGrupo), el descanso arranca al
// CERRAR LA RONDA: cuando todos los del grupo tienen hecha la serie de ese
// índice. Se comprueba contra el estado YA marcado, y da igual el orden en
// que se palomeen: cierra la ronda quien palomea el último que faltaba.
// Un miembro sin serie en ese índice no bloquea (tiene menos series: ya no
// participa de esa ronda).
export function debeArrancarDescanso(ejercicios, idx, serieIdx) {
  const ej = ejercicios?.[idx];
  if (!ej) return false;
  if (ej.superGrupo === null || ej.superGrupo === undefined) return true;
  return ejercicios.every(e => {
    if (e.superGrupo !== ej.superGrupo) return true;
    const s = e.series?.[serieIdx];
    return !s || s.hecha === true;
  });
}

// A kilogramos desde la unidad del perfil. Redondeo a centésima: 10 g está
// por debajo de lo que distingue cualquier placa real y evita que el JSON
// guardado engorde con colas de flotante (45.359237000000004).
export function aKg(valor, unidad) {
  if (!Number.isFinite(valor) || valor < 0) return 0;
  const kg = unidad === 'lb' ? valor * 0.45359237 : valor;
  return Math.round(kg * 100) / 100;
}

// ── Helpers puros internos ───────────────────────────────────────────────────

const LB_POR_KG = 1 / 0.45359237;

// kg → número en la unidad del usuario, a décima: lo que cabe en un input de gym.
function pesoUI(kg, unidad) {
  const v = unidad === 'lb' ? kg * LB_POR_KG : kg;
  return Math.round(v * 10) / 10;
}

function fmtPeso(kg, unidad) {
  const n = pesoUI(kg, unidad);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// Mismas reglas de acentos que el buscador del diario: minúsculas + NFD sin
// diacríticos, así "press frances" encuentra "Press francés".
function normalizar(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Todo texto que venga de datos (nombres de ejercicio, rutinas, notas) pasa
// por aquí antes de entrar a innerHTML: el catálogo es nuestro hoy, pero un
// respaldo importado puede traer cualquier cosa.
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fechaCorta(ms) {
  const f = new Date(ms).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
  return f.charAt(0).toUpperCase() + f.slice(1);
}

function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SVG_LUPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8L20.5 20.5"/></svg>';
const SVG_VOLVER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';

// ── Estado del módulo ────────────────────────────────────────────────────────
// `sesion` apunta al MISMO objeto que estado.entreno.sesionActiva: se edita en
// sitio y cada cambio pasa por persistir(), que lo reenvuelve en un estado
// nuevo del almacén. El módulo es el único escritor de entreno.*, así que la
// mutación local no cruza con nadie.

let ctx = null;              // { raiz, getMeta } que entrega app.js
let estado = null;
let sesion = null;

let subtab = 'rutinas';      // 'rutinas' | 'biblioteca' | 'historial'
let modoBiblioteca = null;   // null (pestaña) | 'sesion' (overlay "agregar a la sesión")
let verSesionId = null;      // sesión del historial abierta en modo lectura
let verProgresoId = null;    // ejercicio abierto en "progreso"
let fichaId = null;          // ejercicio abierto en su ficha (desde la Biblioteca)
let consultaBib = '';        // texto del buscador (sobrevive repintados)
let confirmando = null;      // botón destructivo esperando segundo toque

let descansoObj = null;      // objeto de crearDescanso() del descanso vivo
let avisadoFin = false;      // para avisar UNA vez al llegar a cero
let reloj = null;            // intervalo que REPINTA (nunca cuenta) crono y descanso
let timerOcultar = null;

// Catálogo y rutinas base: lazy, cada JSON se pide la primera vez que su
// pestaña lo necesita. 'fallo' pinta estado vacío claro, nunca pantalla rota.
let catEstado = 'nada';      // 'nada' | 'cargando' | 'listo' | 'fallo'
let catalogo = [];
let porId = new Map();
let rutEstado = 'nada';
let rutinasBase = [];

const URL_IMG = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

// ── Entrada del shell ────────────────────────────────────────────────────────

export function initEntreno({ raiz, getMeta }) {
  ctx = { raiz, getMeta };
  estado = almacen.cargar();
  sesion = estado.entreno.sesionActiva;

  // iOS solo permite crear/reanudar audio dentro de un gesto: el primer toque
  // en la sección deja el beep del fin de descanso listo para sonar solo.
  raiz.addEventListener('pointerdown', () => prepararAudio(), { once: true, passive: true });

  // Al volver de segundo plano el sistema ya soltó el wake lock: se vuelve a
  // pedir, y se repinta ya (el intervalo pudo estar congelado y el descanso,
  // derivado de su hora de fin, puede haber terminado mientras tanto).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !sesion || sesion.finMs) return;
    pedirWakeLock();
    tic();
  });

  if (sesion && !sesion.finMs) {
    pedirWakeLock();
    restaurarDescanso();
  }
  render();
}

// app.js lo llama al volver a la pestaña: el almacén pudo cambiar desde otra
// (un plato al diario, un import de respaldo). Se relee y se repinta; como
// cada cambio propio ya se persistió, releer nunca pisa trabajo en curso.
export function refrescar() {
  if (!ctx) return;
  estado = almacen.cargar();
  sesion = estado.entreno.sesionActiva;
  if (sesion && !sesion.finMs && !descansoObj) restaurarDescanso();
  render();
}

// ── Persistencia ─────────────────────────────────────────────────────────────

// TODA escritura de este módulo aplica SU mutación sobre el estado fresco del
// disco (almacen.actualizar), nunca un snapshot de memoria: el tic del
// descanso persiste en segundo plano aunque el usuario esté en otra pestaña,
// y con un snapshot pisaba lo guardado por Diario o Pedir, o un respaldo
// recién importado. Así el tic solo toca la sesión activa.
function escribir(mutador) {
  const r = almacen.actualizar(mutador);
  estado = r.estado;
  return r.guardado;
}

function persistir() {
  escribir(e => almacen.guardarSesionActiva(e, sesion));
}

// Un descanso guardado se restaura recreándolo con el tiempo que le queda:
// crearDescanso pone finMs = ahora + duración, así que darle el restante
// reconstruye LA MISMA hora de fin. Uno ya vencido se descarta en silencio:
// beepear al abrir la app por un descanso de ayer sería ruido.
function restaurarDescanso() {
  const d = sesion?.descanso;
  if (!d || !Number.isFinite(d.finMs)) return;
  const restanteS = (d.finMs - Date.now()) / 1000;
  if (restanteS <= 0) {
    delete sesion.descanso;
    persistir();
    return;
  }
  descansoObj = crearDescanso({ duracionS: restanteS });
  avisadoFin = false;
}

// ── Sesiones: crear, marcar, cerrar ──────────────────────────────────────────

function nuevaSesion(rutinaId) {
  return { id: 'S-' + Date.now(), inicioMs: Date.now(), finMs: null, rutinaId: rutinaId ?? null, ejercicios: [], notas: '' };
}

function serieVacia(prev) {
  // La serie nueva hereda reps y peso de la anterior: en el gym lo normal es
  // repetir carga, y escribir de cero cada fila es la fricción que Hevy evita.
  return { reps: prev?.reps ?? 0, pesoKg: prev?.pesoKg ?? 0, rir: null, hecha: false, tsHecha: null };
}

function ejercicioDeSesion(idEjercicio, nombre, descansoS, superGrupo, nSeries, repsBase) {
  const previas = ultimaVez(estado.entreno.sesiones, idEjercicio);
  const series = [];
  for (let i = 0; i < nSeries; i++) {
    series.push({
      reps: repsBase ?? previas?.[i]?.reps ?? 0,
      // El peso se precarga de la última vez (misma posición de serie): la
      // referencia ya está en el input y solo se corrige si hoy cambia.
      pesoKg: previas?.[i]?.pesoKg ?? previas?.[previas.length - 1]?.pesoKg ?? 0,
      rir: null, hecha: false, tsHecha: null
    });
  }
  return { idEjercicio, nombre, descansoS, superGrupo, series };
}

function empezarVacia() {
  sesion = nuevaSesion(null);
  persistir();
  pedirWakeLock();
  // Una sesión sin ejercicios no sirve de nada: se abre la biblioteca de una
  // vez para elegir el primero.
  modoBiblioteca = 'sesion';
  consultaBib = '';
  render();
}

function empezarConEjercicio(id) {
  sesion = nuevaSesion(null);
  const f = porId.get(id);
  sesion.ejercicios.push(ejercicioDeSesion(id, f?.nombre ?? id, 90, null, 3));
  persistir();
  pedirWakeLock();
  modoBiblioteca = null;
  render();
}

async function empezarDesdeRutina(rutina, dia) {
  // Los nombres salen del catálogo; si no carga, el id hace de nombre y la
  // sesión funciona igual (el nombre es presentación, no dato).
  await cargarCatalogo();
  sesion = nuevaSesion(rutina.id);
  let grupo = 0;
  for (const bloque of dia.bloques || []) {
    const g = bloque.length > 1 ? ++grupo : null;
    for (const b of bloque) {
      const f = porId.get(b.idEjercicio);
      sesion.ejercicios.push(ejercicioDeSesion(
        b.idEjercicio, f?.nombre ?? b.idEjercicio, b.descansoS ?? 90, g, b.series ?? 3, b.repsMin ?? null));
    }
  }
  persistir();
  pedirWakeLock();
  render();
}

function agregarEjercicioASesion(id, nombre) {
  sesion.ejercicios.push(ejercicioDeSesion(id, nombre, 90, null, 3));
  persistir();
  modoBiblioteca = null;
  render();
}

// Índice del último miembro del grupo: en superserie el descanso es del BLOQUE
// y se toma del último ejercicio (patrón WHOOP de descanso por bloque), no del
// que casualmente cerró la ronda si se palomeó en desorden.
function ultimoDelGrupo(g) {
  for (let i = sesion.ejercicios.length - 1; i >= 0; i--) {
    if (sesion.ejercicios[i].superGrupo === g) return i;
  }
  return 0;
}

function alPalomear(idxEj, idxSerie, fila) {
  const ej = sesion.ejercicios[idxEj];
  const serie = ej.series[idxSerie];
  // La fila se LEE en el toque: en móvil el blur del input no siempre llega
  // antes del tap y palomear con el teclado abierto perdía lo tecleado.
  leerFila(fila, serie);
  serie.hecha = !serie.hecha;
  serie.tsHecha = serie.hecha ? Date.now() : null;
  prepararAudio();
  if (serie.hecha && debeArrancarDescanso(sesion.ejercicios, idxEj, idxSerie)) {
    const idxRest = ej.superGrupo == null ? idxEj : ultimoDelGrupo(ej.superGrupo);
    arrancarDescanso(idxRest);
  }
  persistir();
  render();
}

function leerFila(fila, serie) {
  const unidad = unidadPeso();
  const peso = parseFloat(fila.querySelector('.en-in-peso').value.replace(',', '.'));
  const reps = parseInt(fila.querySelector('.en-in-reps').value, 10);
  const rir = parseInt(fila.querySelector('.en-in-rir').value, 10);
  serie.pesoKg = aKg(Number.isFinite(peso) ? peso : 0, unidad);
  serie.reps = Number.isFinite(reps) && reps > 0 ? reps : 0;
  serie.rir = Number.isFinite(rir) && rir >= 0 ? Math.min(rir, 9) : null;
}

function terminarSesion() {
  sesion.finMs = Date.now();
  delete sesion.descanso;
  descansoObj = null;
  liberarWakeLock();
  persistir();
  render();
}

function guardarSesionFinal() {
  const notas = ctx.raiz.querySelector('.en-notas')?.value ?? sesion.notas ?? '';
  const limpia = {
    id: sesion.id, inicioMs: sesion.inicioMs, finMs: sesion.finMs ?? Date.now(),
    rutinaId: sesion.rutinaId,
    // `id` duplica a idEjercicio A PROPÓSITO: cerrarSesion() del almacén
    // alimenta recientes.ejercicios leyendo ej.id, y esa firma es contrato
    // cerrado. Sin el alias, "Recientes" de la biblioteca quedaría vacío.
    ejercicios: sesion.ejercicios.map(e => ({ ...e, id: e.idEjercicio })),
    notas
  };
  const ok = escribir(e => almacen.cerrarSesion(e, limpia));
  sesion = null;
  subtab = 'historial';
  render();
  // Perder una sesión entera de gym es lo que más dolería: si el storage
  // falló (cuota, modo privado) se dice, en vez de fingir que quedó.
  if (!ok) {
    const aviso = ctx.raiz.querySelector('.en-aviso-storage');
    if (aviso) aviso.hidden = false;
  }
}

function descartarSesion() {
  sesion = null;
  descansoObj = null;
  liberarWakeLock();
  escribir(e => almacen.guardarSesionActiva(e, null));
  render();
}

// Sesión → rutina de un día, agrupando superseries en bloques. repsMin/Max
// salen de lo realmente hecho: la rutina guarda lo que entrenaste, no lo que
// planeabas.
function sesionARutina(ses, nombre) {
  const bloques = [];
  let grupoAbierto = null;
  for (const ej of ses.ejercicios) {
    const reps = ej.series.filter(s => s.hecha).map(s => s.reps).filter(r => r > 0);
    const item = {
      idEjercicio: ej.idEjercicio,
      series: ej.series.filter(s => s.hecha).length || ej.series.length,
      repsMin: reps.length ? Math.min(...reps) : null,
      repsMax: reps.length ? Math.max(...reps) : null,
      descansoS: ej.descansoS
    };
    if (ej.superGrupo != null && grupoAbierto === ej.superGrupo) {
      bloques[bloques.length - 1].push(item);
    } else {
      bloques.push([item]);
      grupoAbierto = ej.superGrupo;
    }
  }
  return {
    id: 'R-' + Date.now(), nombre, nivel: null, objetivo: null, equipo: null,
    diasSemana: null, dias: [{ nombre: 'Día 1', bloques }], notas: ''
  };
}

// ── Descanso ─────────────────────────────────────────────────────────────────

function arrancarDescanso(idx) {
  const ej = sesion.ejercicios[idx];
  descansoObj = crearDescanso({ duracionS: ej.descansoS });
  avisadoFin = false;
  if (timerOcultar) { clearTimeout(timerOcultar); timerOcultar = null; }
  // Se guarda la hora de FIN: tras un reload (o 2 min con la pestaña dormida)
  // el restante se deriva de ella y es exacto sin hacer nada.
  sesion.descanso = { finMs: descansoObj.finMs, duracionS: ej.descansoS, idx };
}

function ajustarDescanso(deltaS) {
  if (!descansoObj) return;
  descansoObj.ajustar(deltaS);
  if (sesion.descanso) sesion.descanso.finMs = descansoObj.finMs;
  persistir();
  tic();
}

function saltarDescanso() {
  if (!descansoObj) return;
  // Saltar es una decisión consciente: no merece la alarma de fin (doble
  // beep + vibración), que es para avisar a quien está esperando.
  avisadoFin = true;
  descansoObj.saltar();
  // Persistir el salto: sin esto el descanso saltado resucitaba (con alarma)
  // al volver a la pestaña o recargar, porque el disco guardaba su fin viejo.
  if (sesion?.descanso) { delete sesion.descanso; persistir(); }
  tic();
}

function cerrarBarraDescanso() {
  descansoObj = null;
  if (timerOcultar) { clearTimeout(timerOcultar); timerOcultar = null; }
  const barra = ctx.raiz.querySelector('.en-descanso');
  if (barra) barra.hidden = true;
}

// El intervalo REPINTA, no cuenta: todo el tiempo se deriva de timestamps
// (inicioMs de la sesión, finMs del descanso) en cada tic.
function tic() {
  if (!sesion || sesion.finMs) return;
  const crono = ctx.raiz.querySelector('.en-crono');
  if (crono) crono.textContent = formatear((Date.now() - sesion.inicioMs) / 1000);
  pintarDescanso();
}

function arrancarReloj() {
  pararReloj();
  reloj = setInterval(tic, 1000);
}

function pararReloj() {
  if (reloj) { clearInterval(reloj); reloj = null; }
}

// ── Datos lazy: catálogo de ejercicios y rutinas sugeridas ───────────────────

async function cargarJSON(ruta, clave) {
  const r = await fetch(ruta);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  // Se acepta lista pelada u objeto envoltorio: el formato lo fija el
  // pipeline de datos y este lector no debe romperse por un sobre de más.
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.[clave])) return d[clave];
  return [];
}

async function cargarCatalogo() {
  if (catEstado === 'listo' || catEstado === 'cargando') return;
  catEstado = 'cargando';
  try {
    catalogo = await cargarJSON('data/ejercicios.json', 'ejercicios');
    porId = new Map(catalogo.map(e => [e.id, e]));
    catEstado = 'listo';
  } catch {
    catalogo = [];
    porId = new Map();
    catEstado = 'fallo';
  }
}

async function cargarRutinas() {
  if (rutEstado === 'listo' || rutEstado === 'cargando') return;
  rutEstado = 'cargando';
  try {
    rutinasBase = await cargarJSON('data/rutinas.json', 'rutinas');
    rutEstado = 'listo';
  } catch {
    rutinasBase = [];
    rutEstado = 'fallo';
  }
}

function unidadPeso() { return estado.perfil?.unidadPeso === 'lb' ? 'lb' : 'kg'; }

// ── Render raíz ──────────────────────────────────────────────────────────────

// Re-render con innerHTML tira el foco del teclado a <body>: tras CADA serie
// palomeada, quien navega con teclado tenía que re-tabular desde el principio.
// Esto describe el control activo por sus data-atributos estables y lo
// re-enfoca en el DOM nuevo, si sigue existiendo.
function selectorFoco(el) {
  if (!el || el === document.body || !ctx.raiz.contains(el)) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const d = el.dataset || {};
  const attrs = ['acc', 'id', 'idx', 'tab', 'sid', 'ej', 'serie'].filter(k => d[k] !== undefined)
    .map(k => `[data-${k}="${CSS.escape(d[k])}"]`).join('');
  return attrs ? el.tagName.toLowerCase() + attrs : null;
}

function render() {
  const foco = selectorFoco(document.activeElement);
  renderVista();
  if (foco) ctx.raiz.querySelector(foco)?.focus({ preventScroll: true });
}

function renderVista() {
  pararReloj();
  const raiz = ctx.raiz;
  // El resumen y el historial necesitan el catálogo (grupos musculares) y las
  // rutinas base (nombre de la sesión): si aún no están, se piden y se
  // repinta al llegar. Los flags de carga evitan pedirlos dos veces.
  if ((sesion || verSesionId) && catEstado === 'nada') cargarCatalogo().then(() => render());
  if ((sesion?.rutinaId || verSesionId) && rutEstado === 'nada') cargarRutinas().then(() => render());
  if (!ctx.getMeta()) {
    cerrarBarraDescanso();
    pintarSinMeta(raiz);
    return;
  }
  if (sesion && !sesion.finMs) {
    if (modoBiblioteca === 'sesion') { pintarBiblioteca(raiz, 'sesion'); return; }
    pintarVivo(raiz);
    return;
  }
  if (sesion && sesion.finMs) {
    pintarResumen(raiz, sesion, { editable: true });
    return;
  }
  if (verSesionId) {
    const s = estado.entreno.sesiones.find(x => x.id === verSesionId);
    if (s) { pintarResumen(raiz, s, { editable: false }); return; }
    verSesionId = null;
  }
  if (fichaId) { pintarFicha(raiz, fichaId); return; }
  pintarInicio(raiz);
}

// Sin meta no hay perfil, y sin perfil no hay unidad de peso ni meta que
// compartir: el mismo paso único de Pedir desbloquea las tres secciones.
function pintarSinMeta(raiz) {
  raiz.innerHTML = `
  <div class="en-wrap">
    <div class="en-ey">Entrenar</div>
    <h2 class="en-titulo">Primero, tu perfil</h2>
    <p class="en-sub">Con tu perfil sabemos tu unidad de peso y tu meta. Se llena una sola vez y sirve para toda la app.</p>
    <button type="button" class="en-btn en-btn-main en-cta-perfil">Completa tu perfil en Pedir</button>
  </div>`;
  raiz.querySelector('.en-cta-perfil').addEventListener('click', () => {
    // goTab lo expone el shell (app.js); si no está, el botón de la tabbar
    // hace el mismo viaje sin acoplar nada más.
    if (typeof globalThis.crearPerfil === 'function') globalThis.crearPerfil('entrenar');
    else if (typeof globalThis.goTab === 'function') globalThis.goTab('pedir');
    else document.getElementById('tab-pedir')?.click();
  });
}

// ── Inicio: Rutinas · Biblioteca · Historial ─────────────────────────────────

function pintarInicio(raiz) {
  raiz.innerHTML = `
  <div class="en-wrap">
    <div class="en-ey">Entrenar</div>
    <h2 class="en-titulo">Tu fuerza</h2>
    <p class="en-sub">Palomea cada serie y el descanso corre solo.</p>
    <div class="en-tabs" role="group" aria-label="Secciones de Entrenar">
      ${['rutinas', 'biblioteca', 'historial'].map(t => `
        <button type="button" class="en-tab${subtab === t ? ' en-tab-on' : ''}"
          aria-pressed="${subtab === t}" data-tab="${t}">${capital(t)}</button>`).join('')}
    </div>
    <div class="en-panel"></div>
    <p class="en-aviso-storage" hidden>No se pudo guardar en este dispositivo. Exporta un respaldo desde Diario antes de cerrar.</p>
    <p class="en-fuentes">Ejercicios e imágenes: free-exercise-db (dominio público). Tus entrenamientos viven solo en este dispositivo.</p>
  </div>`;
  raiz.querySelector('.en-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    subtab = b.dataset.tab;
    verProgresoId = null;
    render();
  });
  const panel = raiz.querySelector('.en-panel');
  if (subtab === 'rutinas') pintarPanelRutinas(panel);
  else if (subtab === 'biblioteca') pintarBiblioteca(panel, null);
  else pintarPanelHistorial(panel);
}

function pintarPanelRutinas(panel) {
  if (rutEstado === 'nada') { cargarRutinas().then(() => { if (subtab === 'rutinas' && !sesion) render(); }); }
  const guardadas = estado.entreno.rutinas;
  const htmlRutina = (r, origen) => {
    const dias = Array.isArray(r.dias) ? r.dias : [];
    const nEj = dias.reduce((a, d) => a + (d.bloques || []).reduce((b, bl) => b + bl.length, 0), 0);
    const nSuper = dias.reduce((a, d) => a + (d.bloques || []).filter(bl => bl.length > 1).length, 0);
    const sub = [nEj + (nEj === 1 ? ' ejercicio' : ' ejercicios'),
                 nSuper ? nSuper + (nSuper === 1 ? ' superserie' : ' superseries') : null,
                 // El objetivo del JSON es un slug estable ('recomposicion'):
                 // al usuario se le muestra con su tilde, nunca el slug crudo.
                 ({ recomposicion: 'recomposición' })[r.objetivo] || r.objetivo,
                 r.equipo].filter(Boolean).join(' · ');
    // Plegada por defecto: con las 10 rutinas expandidas la pantalla era un
    // muro de ~37 botones "Empezar" idénticos. Se toca la rutina y aparecen
    // sus días; un principiante elige entre 10 nombres, no entre 37 botones.
    return `
    <details class="en-card en-rut">
      <summary class="en-rut-sum">
        <span class="en-card-nombre">${esc(r.nombre)}</span>
        <span class="en-card-sub">${esc(sub)}</span>
      </summary>
      <div class="en-card-dias">
        ${dias.map((d, i) => `<button type="button" class="en-btn en-btn-ghost" data-acc="rutina"
          data-origen="${origen}" data-rid="${esc(r.id)}" data-dia="${i}">Empezar${dias.length > 1 ? ' · ' + esc(d.nombre) : ''}</button>`).join('')}
      </div>
    </details>`;
  };
  panel.innerHTML = `
    <button type="button" class="en-btn en-btn-main en-empezar-vacia" data-acc="vacia">Empezar sesión vacía</button>
    ${guardadas.length ? `<div class="en-sec-lbl">Tus rutinas</div>${guardadas.map(r => htmlRutina(r, 'mia')).join('')}` : ''}
    <div class="en-sec-lbl">Rutinas COSECHA</div>
    ${rutEstado === 'listo' && rutinasBase.length
      ? rutinasBase.map(r => htmlRutina(r, 'base')).join('')
      : rutEstado === 'fallo' || (rutEstado === 'listo' && !rutinasBase.length)
        ? '<p class="en-vacio">Aún no hay rutinas sugeridas. Empieza una sesión vacía y guárdala como rutina al terminar.</p>'
        : '<p class="en-vacio">Cargando rutinas…</p>'}`;
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    if (b.dataset.acc === 'vacia') { empezarVacia(); return; }
    if (b.dataset.acc === 'rutina') {
      const lista = b.dataset.origen === 'mia' ? estado.entreno.rutinas : rutinasBase;
      const r = lista.find(x => String(x.id) === b.dataset.rid);
      const d = r?.dias?.[+b.dataset.dia];
      if (r && d) empezarDesdeRutina(r, d);
    }
  });
}

// ── Biblioteca (pestaña y overlay "agregar a la sesión") ─────────────────────

function pintarBiblioteca(cont, destino) {
  const overlay = destino === 'sesion';
  if (catEstado === 'nada') { cargarCatalogo().then(() => render()); }
  if (overlay) {
    // En overlay la biblioteca ocupa la raíz entera, con vuelta a la sesión.
    // La barra de descanso viaja con ella: un descanso corriendo no se
    // esconde porque el usuario fue a buscar el siguiente ejercicio.
    cont.innerHTML = `
    <div class="en-wrap">
      <button type="button" class="en-volver" data-acc="volver">${SVG_VOLVER}<span>Volver a la sesión</span></button>
      <h2 class="en-titulo">Agregar ejercicio</h2>
      <div class="en-panel"></div>
    </div>${htmlBarraDescanso()}`;
    cont.querySelector('[data-acc="volver"]').addEventListener('click', () => {
      modoBiblioteca = null;
      render();
    });
    conectarBarraDescanso(cont);
    cont = cont.querySelector('.en-panel');
  }

  const q = normalizar(consultaBib.trim());
  const filtra = e => {
    if (!q) return true;
    const pajar = normalizar([e.nombre, e.nombreEn, (e.musculosPrimarios || []).join(' '),
      (e.musculosSecundarios || []).join(' '), e.equipo].filter(Boolean).join(' '));
    return q.split(/\s+/).every(t => pajar.includes(t));
  };
  const todas = catEstado === 'listo' ? catalogo.filter(filtra) : [];
  // Tope de filas: pintar 876 botones por tecla congelaba teléfonos medios
  // (long tasks de 65–117 ms medidos) y, con foto por fila, bajaba los JPG
  // completos del CDN (~64 KB cada uno). La lista corta + "sigue escribiendo"
  // es más rápida Y más usable que un rollo infinito.
  const CAP = 60;
  const lista = todas.slice(0, CAP);
  const recortadas = todas.length - lista.length;
  const recientes = !q && catEstado === 'listo'
    ? estado.recientes.ejercicios.map(id => porId.get(id)).filter(Boolean).slice(0, 5)
    : [];
  const accion = overlay ? 'Agregar' : 'Ver';

  // La foto solo en Recientes (máx. 5): el CDN sirve los JPG a tamaño
  // completo y ponerla en cada fila costaba ~55 MB por recorrer la lista.
  const fila = (e, conThumb) => `
    <button type="button" class="en-ej-row" data-acc="ej" data-id="${esc(e.id)}">
      ${conThumb ? `<span class="en-thumb">${e.imagenes?.[0]
        ? `<img loading="lazy" src="${esc(URL_IMG + e.imagenes[0])}" alt="">` : ''}</span>` : ''}
      <span class="en-ej-row-txt">
        <span class="en-ej-row-nombre">${esc(e.nombre)}</span>
        <span class="en-ej-row-sub">${esc([capital(e.musculosPrimarios?.[0]), e.equipo].filter(Boolean).join(' · '))}</span>
      </span>
      <span class="en-ej-row-acc">${accion}</span>
    </button>`;

  cont.innerHTML = `
    <div class="en-busca">
      ${SVG_LUPA}
      <input type="search" class="en-busca-in" placeholder="Buscar por nombre, músculo o equipo"
        value="${esc(consultaBib)}" aria-label="Buscar ejercicio">
    </div>
    <p class="en-sr en-busca-estado" role="status" aria-live="polite"></p>
    <div class="en-busca-res">
    ${catEstado === 'cargando' || catEstado === 'nada' ? '<p class="en-vacio">Cargando ejercicios…</p>'
      : catEstado === 'fallo' || !catalogo.length
        ? `<p class="en-vacio">La biblioteca no está disponible por ahora. Puedes escribir el nombre de tu ejercicio y registrarlo igual.</p>${htmlLibre(q)}`
        : `${recientes.length ? `<div class="en-sec-lbl">Recientes</div>${recientes.map(e => fila(e, true)).join('')}` : ''}
           ${q ? '' : '<div class="en-sec-lbl">Todos</div>'}
           ${lista.length ? lista.map(e => fila(e, false)).join('')
             : `<p class="en-vacio">Nada con «${esc(consultaBib.trim())}».</p>${htmlLibre(q)}`}
           ${recortadas > 0 ? `<p class="en-vacio">Mostrando ${CAP} de ${todas.length}. Sigue escribiendo para afinar.</p>` : ''}`}
    </div>`;

  const input = cont.querySelector('.en-busca-in');
  input.addEventListener('input', () => {
    consultaBib = input.value;
    // Debounce de 160 ms: re-filtrar y re-pintar 876 filas POR TECLA daba
    // long tasks de >100 ms en CPU de teléfono. Solo se repinta la lista:
    // repintar todo robaría el foco del buscador.
    clearTimeout(input._t);
    input._t = setTimeout(() => pintarListaBiblioteca(cont, overlay), 160);
  });
  cont.addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    if (b.dataset.acc === 'ej') elegirEjercicio(b.dataset.id, overlay);
    if (b.dataset.acc === 'libre') elegirLibre(overlay);
  });
  if (overlay) {
    pintarDescanso();
    arrancarReloj();
  }
}

// El buscador se queda; solo la lista de resultados se vuelve a pintar.
function pintarListaBiblioteca(cont, overlay) {
  const marcador = document.createElement('div');
  cont.querySelector('.en-busca-res').replaceWith(marcador);
  const html = document.createElement('div');
  // Reusar pintarBiblioteca entero movería el foco; se reconstruye solo la
  // parte de resultados con el mismo generador.
  pintarBiblioteca(html, overlay ? 'sesion' : null);
  const nueva = html.querySelector('.en-busca-res');
  marcador.replaceWith(nueva);
  // Mensaje de estado (WCAG 4.1.3): el conteo, no la lista.
  const est = cont.querySelector('.en-busca-estado');
  if (est) {
    const n = nueva.querySelectorAll('.en-ej-row').length;
    est.textContent = consultaBib.trim() ? (n ? `${n} ${n === 1 ? 'ejercicio' : 'ejercicios'}` : 'Sin resultados') : '';
  }
  // Los clicks ya los atiende el listener delegado de `cont`.
}

function htmlLibre(q) {
  if (!q) return '';
  return `<button type="button" class="en-btn en-btn-ghost en-libre" data-acc="libre">
    Registrar «${esc(consultaBib.trim())}» como ejercicio libre</button>`;
}

function elegirEjercicio(id, overlay) {
  const f = porId.get(id);
  if (overlay) { consultaBib = ''; agregarEjercicioASesion(id, f?.nombre ?? id); return; }
  // Desde la Biblioteca se abre su FICHA (instrucciones, fotos, músculos): antes
  // tocar la fila arrancaba una sesión al instante, y las instrucciones
  // traducidas de 871 ejercicios no se veían en ninguna pantalla.
  fichaId = id;
  render();
  window.scrollTo(0, 0);
}

function pintarFicha(raiz, id) {
  const e = porId.get(id);
  if (!e) { fichaId = null; pintarInicio(raiz); return; }
  const fotos = (e.imagenes || []).slice(0, 2);
  const pos = ['posición inicial', 'posición final'];
  raiz.innerHTML = `
  <div class="en-wrap">
    <button type="button" class="en-volver" data-acc="ficha-volver">${SVG_VOLVER}<span>Biblioteca</span></button>
    <div class="en-ey">${esc(capital(e.categoria || 'Ejercicio'))}</div>
    <h2 class="en-titulo">${esc(e.nombre)}</h2>
    <p class="en-sub">${esc([capital(e.equipo), capital(e.nivel)].filter(Boolean).join(' · '))}</p>
    ${fotos.length ? `<div class="en-ficha-fotos">${fotos.map((f, i) => `
      <span class="en-ficha-foto"><img loading="lazy" src="${esc(URL_IMG + f)}" alt="${esc(e.nombre)}, ${pos[i]}"></span>`).join('')}
    </div>` : ''}
    <div class="en-sec-lbl">Músculos</div>
    <p class="en-ficha-txt"><b>Principales:</b> ${esc((e.musculosPrimarios || []).map(capital).join(', ') || '—')}${
      (e.musculosSecundarios || []).length ? `<br><b>Secundarios:</b> ${esc(e.musculosSecundarios.map(capital).join(', '))}` : ''}</p>
    ${(e.instrucciones || []).length ? `<div class="en-sec-lbl">Cómo se hace</div>
    <ol class="en-ficha-pasos">${e.instrucciones.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
    <button type="button" class="en-btn en-btn-main en-ficha-cta" data-acc="ficha-empezar">Empezar sesión con este ejercicio</button>
    <p class="en-fuentes">Ejercicio e imágenes: free-exercise-db (dominio público).</p>
  </div>`;
  raiz.querySelector('.en-wrap').addEventListener('click', ev => {
    const b = ev.target.closest('[data-acc]');
    if (!b) return;
    if (b.dataset.acc === 'ficha-volver') { fichaId = null; render(); }
    if (b.dataset.acc === 'ficha-empezar') { const fid = fichaId; fichaId = null; consultaBib = ''; empezarConEjercicio(fid); }
  });
}

// Ejercicio libre: id estable derivado del nombre, así "la última vez" y el
// progreso funcionan entre sesiones aunque no exista en el catálogo.
function elegirLibre(overlay) {
  const nombre = consultaBib.trim();
  if (!nombre) return;
  const id = 'LIBRE-' + normalizar(nombre).replace(/\s+/g, '-');
  consultaBib = '';
  if (overlay) agregarEjercicioASesion(id, nombre);
  else {
    sesion = nuevaSesion(null);
    sesion.ejercicios.push(ejercicioDeSesion(id, nombre, 90, null, 3));
    persistir();
    pedirWakeLock();
    render();
  }
}

// ── Historial y progreso ─────────────────────────────────────────────────────

function pintarPanelHistorial(panel) {
  const sesiones = estado.entreno.sesiones;
  if (verProgresoId) { pintarProgreso(panel, verProgresoId); return; }
  if (!sesiones.length) {
    panel.innerHTML = '<p class="en-vacio">Aquí vivirán tus sesiones. Empieza la primera desde Rutinas.</p>';
    return;
  }
  // Ejercicios con series hechas, el de uso más reciente primero: es la lista
  // de "progreso por ejercicio".
  const vistos = new Map();
  for (let i = sesiones.length - 1; i >= 0; i--) {
    for (const ej of sesiones[i].ejercicios || []) {
      if (!vistos.has(ej.idEjercicio) && (ej.series || []).some(s => s.hecha)) {
        vistos.set(ej.idEjercicio, ej.nombre ?? ej.idEjercicio);
      }
    }
  }
  panel.innerHTML = `
    ${[...sesiones].reverse().map(s => {
      const series = (s.ejercicios || []).reduce((a, e) => a + (e.series || []).filter(x => x.hecha).length, 0);
      const min = s.finMs ? Math.max(1, Math.round((s.finMs - s.inicioMs) / 60000)) : null;
      return `
      <button type="button" class="en-card en-card-btn" data-acc="ver" data-sid="${esc(s.id)}">
        <span class="en-card-nombre">${esc(nombreSesion(s))}</span>
        <span class="en-card-sub">${esc([fechaCorta(s.inicioMs), min ? min + ' min' : null,
          series + (series === 1 ? ' serie' : ' series'),
          // "0 kg de volumen" en una sesión de peso corporal decía que no
          // hiciste nada: el volumen solo se cita cuando lo hay.
          volumenSesion(s) > 0 ? fmtPeso(volumenSesion(s), unidadPeso()) + ' ' + unidadPeso() + ' de volumen' : null].filter(Boolean).join(' · '))}</span>
      </button>`;
    }).join('')}
    ${vistos.size ? `<div class="en-sec-lbl">Progreso por ejercicio</div>
      <div class="en-prog-chips">${[...vistos].map(([id, nombre]) =>
        `<button type="button" class="en-chip" data-acc="prog" data-id="${esc(id)}">${esc(nombre)}</button>`).join('')}
      </div>` : ''}`;
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    if (b.dataset.acc === 'ver') { verSesionId = b.dataset.sid; render(); }
    if (b.dataset.acc === 'prog') { verProgresoId = b.dataset.id; render(); }
  });
}

// Progreso de UN ejercicio en el tiempo: mejor serie y 1RM estimado por
// sesión, lista simple de vieja a nueva — la dirección de lectura de "¿voy
// subiendo?". Sin gráficas en v1: la lista honesta ya responde la pregunta.
function pintarProgreso(panel, id) {
  const unidad = unidadPeso();
  const filas = [];
  let nombre = id;
  for (const s of estado.entreno.sesiones) {
    const ej = (s.ejercicios || []).find(e => e.idEjercicio === id);
    if (!ej) continue;
    nombre = ej.nombre ?? nombre;
    const hechas = (ej.series || []).filter(x => x.hecha);
    if (!hechas.length) continue;
    let mejor = null, mejor1RM = null;
    for (const x of hechas) {
      const rm = epley1RM(x.pesoKg, x.reps);
      if (rm !== null && (mejor1RM === null || rm > mejor1RM)) { mejor1RM = rm; mejor = x; }
    }
    // Si todas las series fueron de >10 reps no hay 1RM estimable: la mejor
    // serie pasa a ser la de más volumen y el 1RM se queda en "—".
    if (!mejor) mejor = hechas.reduce((a, x) => (x.reps * x.pesoKg > a.reps * a.pesoKg ? x : a));
    filas.push({ fecha: fechaCorta(s.inicioMs), mejor, mejor1RM });
  }
  panel.innerHTML = `
    <button type="button" class="en-volver" data-acc="atras">${SVG_VOLVER}<span>Historial</span></button>
    <div class="en-sec-lbl">${esc(nombre)}</div>
    ${filas.map(f => `
      <div class="en-prog-fila">
        <span class="en-prog-fecha">${esc(f.fecha)}</span>
        <span class="en-prog-serie">${f.mejor.reps} × ${fmtPeso(f.mejor.pesoKg, unidad)} ${unidad}</span>
        <span class="en-prog-rm">${f.mejor1RM !== null ? fmtPeso(f.mejor1RM, unidad) + ' ' + unidad + ' est.' : '—'}</span>
      </div>`).join('')}`;
  panel.querySelector('[data-acc="atras"]').addEventListener('click', () => {
    verProgresoId = null;
    render();
  });
}

function nombreSesion(s) {
  if (s.rutinaId) {
    const r = estado.entreno.rutinas.find(x => x.id === s.rutinaId)
      ?? rutinasBase.find(x => x.id === s.rutinaId);
    if (r) return r.nombre;
  }
  return 'Sesión libre';
}

// ── Sesión en vivo ───────────────────────────────────────────────────────────

function pintarVivo(raiz) {
  const unidad = unidadPeso();
  const previos = new Map(sesion.ejercicios.map(e =>
    [e.idEjercicio, ultimaVez(estado.entreno.sesiones, e.idEjercicio)]));

  const htmlEjercicio = (ej, idx) => `
    <section class="en-ej" data-idx="${idx}">
      <div class="en-ej-hd">
        <div class="en-ej-nombre">${esc(ej.nombre)}</div>
        <div class="en-ej-desc" aria-label="Descanso de este ejercicio">
          <button type="button" class="en-mini" data-acc="desc" data-idx="${idx}" data-d="-15" aria-label="Quitar 15 segundos al descanso">−15</button>
          <span class="en-ej-desc-val">${formatear(ej.descansoS)}</span>
          <button type="button" class="en-mini" data-acc="desc" data-idx="${idx}" data-d="15" aria-label="Sumar 15 segundos al descanso">+15</button>
        </div>
      </div>
      <div class="en-tabla" role="group" aria-label="Series de ${esc(ej.nombre)}">
        <div class="en-fila en-fila-hd" aria-hidden="true">
          <span>#</span><span>Previa</span><span>${unidad}</span><span>Reps</span><span>RIR</span><span></span>
        </div>
        ${ej.series.map((s, j) => {
          const prev = previos.get(ej.idEjercicio)?.[j];
          return `
          <div class="en-fila${s.hecha ? ' en-hecha' : ''}" data-serie="${j}">
            <span class="en-num">${j + 1}</span>
            <span class="en-prev">${prev ? `${prev.reps}×${fmtPeso(prev.pesoKg, unidad)}` : '—'}</span>
            <input class="en-in en-in-peso" inputmode="decimal" value="${s.pesoKg ? fmtPeso(s.pesoKg, unidad) : ''}"
              aria-label="Peso de la serie ${j + 1} en ${unidad}">
            <input class="en-in en-in-reps" inputmode="numeric" value="${s.reps || ''}"
              aria-label="Repeticiones de la serie ${j + 1}">
            <input class="en-in en-in-rir" inputmode="numeric" value="${s.rir ?? ''}" placeholder="·"
              aria-label="RIR de la serie ${j + 1}, opcional">
            <button type="button" class="en-check${s.hecha ? ' en-check-on' : ''}" data-acc="check"
              data-idx="${idx}" data-serie="${j}" aria-pressed="${s.hecha}"
              aria-label="Serie ${j + 1} ${s.hecha ? 'hecha; tócala para desmarcarla' : 'por hacer; tócala al terminarla'}">${SVG_CHECK}</button>
          </div>`;
        }).join('')}
        <button type="button" class="en-mas-serie" data-acc="serie" data-idx="${idx}">+ serie</button>
      </div>
    </section>`;

  // Los bloques con el mismo superGrupo se pintan dentro de un marco común
  // con su rótulo: la superserie es un objeto de primera clase (WHOOP), no
  // dos tarjetas que casualmente van juntas.
  const trozos = [];
  for (let i = 0; i < sesion.ejercicios.length; i++) {
    const g = sesion.ejercicios[i].superGrupo;
    if (g == null) { trozos.push(htmlEjercicio(sesion.ejercicios[i], i)); continue; }
    let fin = i;
    while (fin + 1 < sesion.ejercicios.length && sesion.ejercicios[fin + 1].superGrupo === g) fin++;
    const dentro = [];
    for (let k = i; k <= fin; k++) dentro.push(htmlEjercicio(sesion.ejercicios[k], k));
    trozos.push(`<div class="en-super"><div class="en-super-tag">Superserie</div>${dentro.join('')}</div>`);
    i = fin;
  }

  raiz.innerHTML = `
  <div class="en-wrap en-vivo">
    <header class="en-vivo-hd">
      <div>
        <div class="en-ey">Sesión en curso</div>
        <h2 class="en-titulo">${esc(nombreSesion(sesion))}</h2>
      </div>
      <div class="en-crono" aria-label="Tiempo de sesión">${formatear((Date.now() - sesion.inicioMs) / 1000)}</div>
    </header>
    ${trozos.join('') || '<p class="en-vacio">Agrega tu primer ejercicio para empezar.</p>'}
    <button type="button" class="en-btn en-btn-ghost en-add-ej" data-acc="agregar">+ Agregar ejercicio</button>
    <div class="en-vivo-acciones">
      <button type="button" class="en-btn en-btn-main" data-acc="terminar">Terminar sesión</button>
      <button type="button" class="en-peligro" data-acc="descartar">Descartar sesión</button>
    </div>
  </div>
  ${htmlBarraDescanso()}`;

  raiz.querySelector('.en-vivo').addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    const acc = b.dataset.acc;
    if (acc === 'check') {
      alPalomear(+b.dataset.idx, +b.dataset.serie, b.closest('.en-fila'));
    } else if (acc === 'serie') {
      const ej = sesion.ejercicios[+b.dataset.idx];
      ej.series.push(serieVacia(ej.series[ej.series.length - 1]));
      persistir();
      render();
    } else if (acc === 'desc') {
      const ej = sesion.ejercicios[+b.dataset.idx];
      // Piso de 15 s y techo de 10 min: fuera de ahí ya no es un descanso
      // entre series, es un error de dedo.
      ej.descansoS = Math.min(600, Math.max(15, ej.descansoS + (+b.dataset.d)));
      persistir();
      b.parentElement.querySelector('.en-ej-desc-val').textContent = formatear(ej.descansoS);
    } else if (acc === 'agregar') {
      modoBiblioteca = 'sesion';
      consultaBib = '';
      render();
    } else if (acc === 'terminar') {
      const sinHacer = sesion.ejercicios.some(ej => ej.series.some(s => !s.hecha));
      if (sinHacer && confirmando !== 'terminar') {
        confirmarDosToques(b, 'terminar', 'Hay series sin palomear · toca otra vez');
        return;
      }
      confirmando = null;
      terminarSesion();
    } else if (acc === 'descartar') {
      if (confirmando !== 'descartar') {
        confirmarDosToques(b, 'descartar', 'Se pierde la sesión · toca otra vez');
        return;
      }
      confirmando = null;
      descartarSesion();
    }
  });

  // Los valores tecleados se persisten al salir del campo: un reload a mitad
  // de sesión no pierde ni la fila a medias.
  raiz.querySelector('.en-vivo').addEventListener('change', e => {
    const fila = e.target.closest('.en-fila');
    const ejEl = e.target.closest('.en-ej');
    if (!fila || !ejEl || !e.target.classList.contains('en-in')) return;
    const ej = sesion.ejercicios[+ejEl.dataset.idx];
    leerFila(fila, ej.series[+fila.dataset.serie]);
    persistir();
  });

  conectarBarraDescanso(raiz);
  pintarDescanso();
  arrancarReloj();
}

// Confirmación destructiva sin confirm(): el mismo botón pide el segundo
// toque y vuelve solo a los 4 s. Un diálogo nativo en medio del gym es más
// fricción que protección.
function confirmarDosToques(btn, clave, texto) {
  confirmando = clave;
  const original = btn.textContent;
  btn.textContent = texto;
  setTimeout(() => {
    if (confirmando === clave) {
      confirmando = null;
      if (btn.isConnected) btn.textContent = original;
    }
  }, 4000);
}

// ── Barra de descanso (fija, encima de la tabbar) ────────────────────────────

function htmlBarraDescanso() {
  return `
  <div class="en-descanso" hidden>
    <button type="button" class="en-d-aj" data-acc="d-aj" data-d="-15" aria-label="Quitar 15 segundos de descanso">−15</button>
    <div class="en-d-circulo" role="timer">
      <span class="en-d-tiempo">0:00</span>
      <span class="en-d-lbl">descanso</span>
    </div>
    <button type="button" class="en-d-aj" data-acc="d-aj" data-d="15" aria-label="Sumar 15 segundos de descanso">+15</button>
    <button type="button" class="en-d-saltar" data-acc="d-saltar">Saltar</button>
    <span class="en-sr" aria-live="polite"></span>
  </div>`;
}

function conectarBarraDescanso(raiz) {
  raiz.querySelector('.en-descanso').addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    if (b.dataset.acc === 'd-aj') ajustarDescanso(+b.dataset.d);
    if (b.dataset.acc === 'd-saltar') {
      if (descansoObj?.haTerminado()) cerrarBarraDescanso();
      else saltarDescanso();
    }
  });
}

function pintarDescanso() {
  const barra = ctx.raiz.querySelector('.en-descanso');
  if (!barra) return;
  if (!descansoObj) { barra.hidden = true; return; }
  barra.hidden = false;
  const fin = descansoObj.haTerminado();
  barra.querySelector('.en-d-tiempo').textContent = formatear(descansoObj.restanteS());
  if (fin && !avisadoFin) {
    avisadoFin = true;
    avisarFin();
    barra.querySelector('.en-sr').textContent = 'Descanso terminado. A darle.';
    // La barra verde se queda unos segundos como aviso visual y se va sola:
    // el gesto siguiente del usuario es la serie, no cerrar una barra.
    if (sesion?.descanso) { delete sesion.descanso; persistir(); }
    timerOcultar = setTimeout(cerrarBarraDescanso, 5000);
  }
  barra.classList.toggle('en-d-fin', fin);
  barra.querySelector('.en-d-lbl').textContent = fin ? '¡A darle!' : 'descanso';
  barra.querySelector('.en-d-saltar').textContent = fin ? 'Listo' : 'Saltar';
  // Con el descanso terminado los ±15 no significan nada: se ocultan sin
  // soltar su sitio para que la barra no cambie de caja (regla anti-salto).
  barra.querySelectorAll('.en-d-aj').forEach(x => { x.style.visibility = fin ? 'hidden' : 'visible'; });
}

// ── Resumen de sesión (al terminar y desde el historial) ─────────────────────

function pintarResumen(raiz, ses, { editable }) {
  cerrarBarraDescanso();
  const unidad = unidadPeso();
  const min = Math.max(1, Math.round(((ses.finMs ?? Date.now()) - ses.inicioMs) / 60000));
  const nSeries = (ses.ejercicios || []).reduce((a, e) => a + (e.series || []).filter(s => s.hecha).length, 0);
  const vol = volumenSesion(ses);

  const grupos = Object.entries(seriesPorGrupo(ses, porId)).sort((a, b) => b[1] - a[1]);
  const maxG = grupos.length ? grupos[0][1] : 1;

  // Récords: el mejor 1RM estimado (Epley, solo ≤10 reps) de cada ejercicio,
  // comparado contra TODO su historial previo. Siempre rotulado "estimado":
  // es una fórmula, no una barra levantada.
  const records = [];
  for (const ej of ses.ejercicios || []) {
    let mejor = null;
    for (const s of (ej.series || []).filter(x => x.hecha)) {
      const rm = epley1RM(s.pesoKg, s.reps);
      if (rm !== null && (mejor === null || rm > mejor)) mejor = rm;
    }
    if (mejor === null) continue;
    let previo = null;
    for (const vieja of estado.entreno.sesiones) {
      if (vieja.id === ses.id) continue;
      const e2 = (vieja.ejercicios || []).find(x => x.idEjercicio === ej.idEjercicio);
      for (const s of (e2?.series || []).filter(x => x.hecha)) {
        const rm = epley1RM(s.pesoKg, s.reps);
        if (rm !== null && (previo === null || rm > previo)) previo = rm;
      }
    }
    records.push({ nombre: ej.nombre, rm: mejor, esRecord: previo === null || mejor > previo });
  }

  raiz.innerHTML = `
  <div class="en-wrap">
    ${editable
      // "Terminar sesión" ya no es un callejón: se puede volver a la sesión
      // (un toque de más no obliga a guardar) o descartarla con doble toque.
      ? `<button type="button" class="en-volver" data-acc="reanudar">${SVG_VOLVER}<span>Volver a la sesión</span></button>`
      : `<button type="button" class="en-volver" data-acc="cerrar">${SVG_VOLVER}<span>Historial</span></button>`}
    <div class="en-ey">${editable ? 'Sesión completa' : 'Sesión del historial'}</div>
    <h2 class="en-titulo">${esc(nombreSesion(ses))}</h2>
    <p class="en-sub">${esc(fechaCorta(ses.inicioMs))}</p>

    <div class="en-stats">
      <div class="en-stat"><span class="en-stat-val">${min}</span><span class="en-stat-lbl">min</span></div>
      <div class="en-stat"><span class="en-stat-val">${nSeries}</span><span class="en-stat-lbl">${nSeries === 1 ? 'serie' : 'series'}</span></div>
      <div class="en-stat"><span class="en-stat-val">${vol > 0 ? fmtPeso(vol, unidad) : '—'}</span><span class="en-stat-lbl">${vol > 0 ? unidad + ' de volumen' : 'peso corporal'}</span></div>
    </div>

    ${grupos.length ? `<div class="en-sec-lbl">Series por grupo muscular</div>
    ${grupos.map(([g, n]) => `
      <div class="en-g-fila">
        <span class="en-g-nombre">${esc(capital(g))}</span>
        <span class="en-g-rail"><span class="en-g-fill" style="transform:scaleX(${(n / maxG).toFixed(3)})"></span></span>
        <span class="en-g-n">${n}</span>
      </div>`).join('')}` : ''}

    ${records.length ? `<div class="en-sec-lbl">1RM estimado</div>
    ${records.map(r => `
      <div class="en-rec-fila">
        <span class="en-rec-nombre">${esc(r.nombre)}</span>
        <span class="en-rec-val">${fmtPeso(r.rm, unidad)} ${unidad} <em>estimado</em></span>
        ${r.esRecord ? '<span class="en-rec-tag">Récord</span>' : ''}
      </div>`).join('')}` : ''}

    <div class="en-sec-lbl">Series</div>
    ${(ses.ejercicios || []).map(ej => `
      <div class="en-res-ej">
        <span class="en-res-ej-nombre">${esc(ej.nombre)}</span>
        <span class="en-res-ej-series">${(ej.series || []).filter(s => s.hecha)
          .map(s => s.pesoKg > 0 ? `${s.reps}×${fmtPeso(s.pesoKg, unidad)}` : `${s.reps} reps`).join(' · ') || 'sin series hechas'}</span>
      </div>`).join('')}

    ${editable ? `
    <label class="en-notas-lbl">Notas
      <textarea class="en-notas" rows="2" placeholder="¿Cómo te sentiste?">${esc(ses.notas ?? '')}</textarea>
    </label>
    <div class="en-rutina-de-sesion">
      <button type="button" class="en-btn en-btn-ghost" data-acc="como-rutina">Guardar como rutina</button>
      <div class="en-rutina-form" hidden>
        <input class="en-rutina-nombre" maxlength="40" placeholder="Nombre de la rutina" aria-label="Nombre de la rutina">
        <button type="button" class="en-btn en-btn-ghost" data-acc="rutina-ok">Guardar</button>
      </div>
    </div>
    <button type="button" class="en-btn en-btn-main en-guardar" data-acc="guardar">Guardar sesión</button>
    <div class="en-vivo-acciones"><button type="button" class="en-peligro" data-acc="descartar-fin">Descartar esta sesión</button></div>`
    : (ses.notas ? `<div class="en-sec-lbl">Notas</div><p class="en-notas-ro">${esc(ses.notas)}</p>` : '')}
    <p class="en-aviso-storage" hidden>No se pudo guardar en este dispositivo. Exporta un respaldo desde Diario antes de cerrar.</p>
  </div>`;

  raiz.querySelector('.en-wrap').addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    const acc = b.dataset.acc;
    if (acc === 'cerrar') { verSesionId = null; render(); }
    else if (acc === 'reanudar') {
      delete sesion.finMs;
      persistir();
      pedirWakeLock();
      render();
    } else if (acc === 'descartar-fin') {
      // Doble toque: destruir una sesión no puede costar un solo toque.
      if (b.dataset.confirmar === '1') descartarSesion();
      else { b.dataset.confirmar = '1'; b.textContent = 'Toca otra vez para descartarla'; }
    }
    else if (acc === 'guardar') guardarSesionFinal();
    else if (acc === 'como-rutina') {
      const form = raiz.querySelector('.en-rutina-form');
      form.hidden = false;
      b.hidden = true;
      form.querySelector('.en-rutina-nombre').focus();
    } else if (acc === 'rutina-ok') {
      const nombre = raiz.querySelector('.en-rutina-nombre').value.trim() || 'Mi rutina';
      escribir(e => almacen.guardarRutina(e, sesionARutina(ses, nombre)));
      const form = raiz.querySelector('.en-rutina-form');
      form.innerHTML = `<span class="en-rutina-ok">Guardada: ${esc(nombre)}</span>`;
    }
  });

  // Las notas se guardan al escribir: si el usuario cierra sin tocar
  // "Guardar sesión", el reload lo trae de vuelta aquí con todo intacto.
  if (editable) {
    raiz.querySelector('.en-notas').addEventListener('change', e => {
      ses.notas = e.target.value;
      persistir();
    });
  }
}
