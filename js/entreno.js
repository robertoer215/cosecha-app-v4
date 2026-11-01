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
import { construirMaestros, buscarMaestros, filtrosVacios, cuentaFiltros, marcarFiltro, quitarFiltro,
         partesMarcadas, zonasParaAfinar, nombreParte, ZONAS, OPCIONES_FILTRO, NOMBRES_FILTRO } from './biblioteca.js';
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
      // El calentamiento no cuenta; rest-pause y drop set suman sus partes.
      if (s.hecha && !esCalentamiento(s) && Number.isFinite(s.reps) && Number.isFinite(s.pesoKg)) v += volumenDeSerie(s);
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
    const n = (ej.series || []).filter(s => s.hecha && !esCalentamiento(s)).length;
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
    if (hechas.length) return hechas.map(s => ({ reps: s.reps, pesoKg: s.pesoKg, ...(s.tipo ? { tipo: s.tipo } : {}) }));
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
// La siguiente serie por hacer, en el ORDEN en que se entrena: un ejercicio
// suelto agota sus series; una superserie alterna por rondas (A1, B1, A2, B2…).
// Lo que se palomeó en desorden desde la lista simplemente se salta.
// → { idx, serie } o null si ya no queda ninguna.
export function siguientePendiente(ejercicios) {
  const ejs = Array.isArray(ejercicios) ? ejercicios : [];
  for (let i = 0; i < ejs.length; i++) {
    const g = ejs[i]?.superGrupo;
    if (g == null) {
      const j = (ejs[i].series || []).findIndex(s => !s.hecha);
      if (j >= 0) return { idx: i, serie: j };
      continue;
    }
    let fin = i;
    while (fin + 1 < ejs.length && ejs[fin + 1]?.superGrupo === g) fin++;
    const rondas = Math.max(...ejs.slice(i, fin + 1).map(e => (e.series || []).length));
    for (let r = 0; r < rondas; r++) {
      for (let k = i; k <= fin; k++) {
        const s = ejs[k].series?.[r];
        if (s && !s.hecha) return { idx: k, serie: r };
      }
    }
    i = fin;
  }
  return null;
}

// La referencia de «la última vez» de cada serie de hoy: los calentamientos se
// comparan con los calentamientos y las series de trabajo con las de trabajo,
// cada uno por su orden. Si una lista se acaba, se repite su último valor.
// `tipos` es el tipo de cada serie de hoy ('calentamiento' o cualquier otro).
export function previasPorSerie(tipos, previas) {
  const w = (previas || []).filter(esCalentamiento), t = (previas || []).filter(p => !esCalentamiento(p));
  let iw = 0, it = 0;
  return (tipos || []).map(tipo => tipo === 'calentamiento'
    ? (w[iw++] ?? (w.length ? w[w.length - 1] : null))
    : (t[it++] ?? (t.length ? t[t.length - 1] : null)));
}

// ── Progreso: cálculos puros (sin DOM, testeados) ─────────────────────────────
//
// "Mejor serie" = la de MÁS PESO; a igual peso, la de más repeticiones. En
// peso corporal (todo a 0 kg) manda la de más repeticiones. Es el criterio
// con el que la gente cuenta sus récords en el gym ("¿cuánto levantaste?").
export function mejorSerie(series) {
  // El récord es de la parte principal de una serie de trabajo: el
  // calentamiento no compite y las partes (mini-series, bajadas) no suman.
  const hechas = (series || []).filter(s => s && s.hecha && !esCalentamiento(s) && (s.reps || 0) > 0);
  if (!hechas.length) return null;
  return hechas.reduce((a, s) => ((s.pesoKg || 0) > (a.pesoKg || 0)
    || ((s.pesoKg || 0) === (a.pesoKg || 0) && s.reps > a.reps)) ? s : a);
}

// Un ejercicio dentro de una sesión: sus series hechas, su mejor serie,
// cuántas repeticiones y cuánto volumen (Σ reps × kg) movió.
export function resumenEjercicio(ej) {
  const hechas = (ej?.series || []).filter(s => s && s.hecha && !esCalentamiento(s));
  return {
    series: hechas,
    mejor: mejorSerie(hechas),
    totalReps: hechas.reduce((a, s) => a + repsDeSerie(s), 0),
    volumen: hechas.reduce((a, s) => a + volumenDeSerie(s), 0)
  };
}

// Todas las veces que se hizo un ejercicio, de la más vieja a la más nueva.
export function historialEjercicio(sesiones, id) {
  const out = [];
  for (const s of sesiones || []) {
    for (const ej of s?.ejercicios || []) {
      if (ej.idEjercicio !== id) continue;
      const r = resumenEjercicio(ej);
      if (!r.mejor) continue;
      out.push({ sesionId: s.id, inicioMs: s.inicioMs, nombre: ej.nombre, ...r });
    }
  }
  return out.sort((a, b) => a.inicioMs - b.inicioMs);
}

// Los récords de un ejercicio: las sesiones con la mejor serie más alta
// (peso, luego reps; a empate, la que se logró PRIMERO conserva el lugar).
export function recordsEjercicio(sesiones, id, n = 3) {
  return historialEjercicio(sesiones, id)
    .sort((a, b) => (b.mejor.pesoKg || 0) - (a.mejor.pesoKg || 0) || b.mejor.reps - a.mejor.reps || a.inicioMs - b.inicioMs)
    .slice(0, n);
}

// El récord vigente de cada ejercicio entrenado, el más reciente primero.
export function prsPorEjercicio(sesiones) {
  const ids = new Set();
  for (const s of sesiones || []) for (const ej of s?.ejercicios || []) ids.add(ej.idEjercicio);
  return [...ids].map(id => {
    const top = recordsEjercicio(sesiones, id, 1)[0];
    return top ? { idEjercicio: id, nombre: top.nombre, mejor: top.mejor, inicioMs: top.inicioMs } : null;
  }).filter(Boolean).sort((a, b) => b.inicioMs - a.inicioMs);
}

// Lo entrenado en [desde, hasta): sesiones, series hechas y volumen. Con `id`,
// solo ese ejercicio (cuenta las sesiones donde se hizo).
export function estadisticasPeriodo(sesiones, desdeMs, hastaMs, id = null) {
  let n = 0, series = 0, volumen = 0;
  for (const s of sesiones || []) {
    if (!(s?.inicioMs >= desdeMs && s.inicioMs < hastaMs)) continue;
    const ejs = (s.ejercicios || []).filter(e => !id || e.idEjercicio === id);
    const r = ejs.map(resumenEjercicio);
    const ser = r.reduce((a, x) => a + x.series.length, 0);
    if (!ser) continue;
    n++;
    series += ser;
    volumen += r.reduce((a, x) => a + x.volumen, 0);
  }
  return { sesiones: n, series, volumen, promedio: n ? volumen / n : 0 };
}

// % de cambio frente al periodo anterior; null si antes no había nada con
// qué comparar (decir "+∞ %" o "+100 %" a quien empieza sería mentir).
export function cambioPct(actual, anterior) {
  return anterior > 0 ? Math.round(((actual - anterior) / anterior) * 100) : null;
}

export function aKg(valor, unidad) {
  if (!Number.isFinite(valor) || valor < 0) return 0;
  const kg = unidad === 'lb' ? valor * 0.45359237 : valor;
  return Math.round(kg * 100) / 100;
}

// ── Técnicas por serie: cálculos puros (testeados) ───────────────────────────
// Decisión de Roberto (30-oct-2026): rest-pause y drop set, con parámetros
// editables. El volumen suma todas las partes, pero el récord (1RM estimado)
// usa SOLO la parte principal (si no, se inflaría).
// El calentamiento (W) se quitó el 31-oct-2026 («la serie de calentar no debe
// contar como una serie formal»): ya no se puede elegir y las rutinas que lo
// tenían pierden esas series al leerse (sinCalentamientos). Las sesiones ya
// guardadas conservan su tipo y siguen sin contarlo (esCalentamiento).
export const TECNICAS = {
  normal: { nombre: 'Normal', insignia: '', descripcion: 'Una serie como siempre.' },
  restpause: { nombre: 'Rest-pause', insignia: 'RP', descripcion: 'Llegas al fallo, descansas unos segundos y haces mini-series con el mismo peso.' },
  drop: { nombre: 'Drop set', insignia: 'D', descripcion: 'Al terminar bajas el peso y sigues sin descansar.' },
};
export const PARAMS_TECNICA = {
  restpause: {
    mini: { min: 1, max: 4, paso: 1, def: 2, nombre: 'Mini-series' },
    microS: { min: 10, max: 30, paso: 5, def: 15, nombre: 'Micro-descanso', unidad: 's' },
  },
  drop: {
    bajadas: { min: 1, max: 3, paso: 1, def: 1, nombre: 'Bajadas' },
    pct: { min: 10, max: 40, paso: 5, def: 20, nombre: 'Bajar el peso', unidad: '%' },
  },
};

// Una técnica saneada: tipo conocido y parámetros dentro de su rango.
export function limpiarTecnica(t) {
  const tipo = typeof t?.tipo === 'string' && Object.hasOwn(TECNICAS, t.tipo) ? t.tipo : 'normal';
  const out = { tipo };
  for (const [k, r] of Object.entries(PARAMS_TECNICA[tipo] || {})) {
    const v = Number.isFinite(t?.[k]) ? Math.round(t[k] / r.paso) * r.paso : r.def;
    out[k] = Math.min(r.max, Math.max(r.min, v));
  }
  return out;
}

// El plan de N series: una técnica por serie; lo que falta, normal.
export function normalizarPlan(n, plan) {
  return Array.from({ length: Math.max(0, n) }, (_, i) => limpiarTecnica(plan?.[i]));
}

export function planEsNormal(plan) {
  return !Array.isArray(plan) || plan.every(t => (t?.tipo ?? 'normal') === 'normal');
}

export const esCalentamiento = s => s?.tipo === 'calentamiento';

// La técnica con la que se PINTA una serie. Una W que quedó en una sesión
// empezada antes del 31-oct se sigue marcando (no cuenta, y debe notarse).
const W_DE_ANTES = { nombre: 'Calentamiento', insignia: 'W', descripcion: 'Serie de calentamiento de antes: no cuenta.' };
export const tecnicaDe = s => TECNICAS[s?.tipo] ?? (esCalentamiento(s) ? W_DE_ANTES : null);

// Rutina con calentamientos de antes: se quitan esas series del plan (y del
// número de series, mínimo 1) en vez de volverlas series de trabajo.
export function sinCalentamientos(series, plan) {
  if (!Array.isArray(plan) || !plan.some(esCalentamiento)) return { series, plan };
  const n = plan.slice(0, series).filter(esCalentamiento).length;
  return { series: Math.max(1, series - n), plan: plan.filter(t => !esCalentamiento(t)) };
}

// Repeticiones y volumen de UNA serie: la parte principal más sus partes
// (mini-series del rest-pause con el mismo peso, o bajadas del drop set).
export function repsDeSerie(s) {
  return (s?.reps || 0) + (s?.partes || []).reduce((a, p) => a + (p?.reps || 0), 0);
}
export function volumenDeSerie(s) {
  const base = (s?.reps || 0) * (s?.pesoKg || 0);
  return base + (s?.partes || []).reduce((a, p) => a + (p?.reps || 0) * (p?.pesoKg ?? s?.pesoKg ?? 0), 0);
}

// Peso de una bajada del drop set: `pct` menos que el anterior, redondeado a
// lo que se puede cargar en el gym (2,5 kg o 5 lb). Nunca llega a cero.
export function pesoBajada(pesoKg, pct, unidad = 'kg') {
  if (!(pesoKg > 0)) return 0;
  const lb = unidad === 'lb';
  const paso = lb ? 5 : 2.5;
  const actual = lb ? pesoKg / 0.45359237 : pesoKg;
  const crudo = actual * (1 - pct / 100);
  let v = Math.round(crudo / paso) * paso;
  // Con cargas pequeñas el redondeo puede dejar el mismo peso (o más): un
  // escalón por debajo; si eso llega a cero, medio kilo (o una libra) de
  // precisión, que es lo que traen las mancuernas ligeras.
  // (Se compara con medio escalón de margen: 10 lb guardadas como 4,54 kg
  // vuelven como 10,009 lb y el redondeo creía haber bajado.)
  if (v > actual - paso / 2) v = Math.floor((actual - paso / 2) / paso) * paso;
  if (v <= 0) v = Math.round(crudo * 2) / 2;
  if (v <= 0 || v > actual - 0.25) return pesoKg;
  return lb ? aKg(v, 'lb') : v;
}

// Qué toca en una serie con técnica después de su parte principal:
// 'micro' (rest-pause: micro-descanso antes de la mini-serie k), 'parte'
// (drop set: la bajada k) o 'fin'. Para una serie normal, siempre 'fin'.
export function siguienteParte(s) {
  const t = limpiarTecnica(s);
  const hechas = (s?.partes || []).length;
  if (t.tipo === 'restpause') return hechas < t.mini ? { fase: 'micro', k: hechas, total: t.mini, microS: t.microS } : { fase: 'fin' };
  if (t.tipo === 'drop') return hechas < t.bajadas ? { fase: 'parte', k: hechas, total: t.bajadas, pct: t.pct } : { fase: 'fin' };
  return { fase: 'fin' };
}

// Una serie como texto para resumen e historial: «8×60 + 3 + 2 RP»,
// «10×60 + 8×47.5 D», «15 reps» (y «12×20 W» en los calentamientos de antes).
// Sin insignia cuando ya la pinta otra cosa (la línea naranja de «Ejercicios»).
export function textoSerie(s, unidad = 'kg', conInsignia = true) {
  const base = s?.pesoKg > 0 ? `${s.reps}×${fmtPeso(s.pesoKg, unidad)}` : `${s?.reps ?? 0} reps`;
  const partes = (s?.partes || []).map(p => s.tipo === 'drop' && p.pesoKg > 0 ? `${p.reps}×${fmtPeso(p.pesoKg, unidad)}` : `${p.reps}`);
  const cuerpo = partes.length ? `${base} + ${partes.join(' + ')}` : base;
  const ins = conInsignia && tecnicaDe(s)?.insignia;
  return ins ? `${cuerpo} ${ins}` : cuerpo;
}

// La técnica de una serie en palabras, para la línea naranja de «Ejercicios»:
// «Rest-pause · 2 mini-series, 15 s entre ellas», «Drop set · 1 bajada del 20 %».
export function resumenTecnica(s) {
  const t = limpiarTecnica(s);
  if (t.tipo === 'restpause') return `Rest-pause · ${t.mini} ${t.mini === 1 ? 'mini-serie' : 'mini-series'}, ${t.microS} s entre ellas`;
  if (t.tipo === 'drop') return `Drop set · ${t.bajadas} ${t.bajadas === 1 ? 'bajada' : 'bajadas'} del ${t.pct} %`;
  return esCalentamiento(s) ? 'Calentamiento de antes · no cuenta como serie' : '';
}

// «Guardar como rutina»: las técnicas de las series pasan al plan (o nada si
// todas eran normales, para no cambiar la forma de las rutinas de siempre).
export function planDesdeSeries(series) {
  const plan = (series || []).map(limpiarTecnica);
  return planEsNormal(plan) ? null : plan;
}

// ── Crear rutina y elegir descanso: cálculos puros (testeados) ───────────────

// Descanso entre series que se elige al empezar CUALQUIER rutina (pedido de
// Roberto, 30-oct-2026). Se aplica a todos los ejercicios de la sesión y
// luego se ajusta por ejercicio en "Ejercicios", como siempre.
export const OPCIONES_DESCANSO = [60, 90, 120, 180];

export function etiquetaDescanso(s) {
  if (!Number.isFinite(s) || s <= 0) return '—';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  if (!m) return `${r} s`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

// Rango de descansos que trae un día de rutina: si varía por ejercicio (las
// rutinas COSECHA dan más a los básicos), se ofrece "lo que sugiere la rutina".
export function rangoDescanso(dia) {
  const vals = (dia?.bloques || []).flat().map(b => b.descansoS).filter(v => Number.isFinite(v) && v > 0);
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
}

// Ejercicio nuevo del editor: 3 series de 8–12, lo que piden la mayoría de
// las rutinas COSECHA. El descanso no se edita aquí: se elige al empezar.
export function ejercicioDeRutina(idEjercicio, nombre) {
  return { idEjercicio, nombre, series: 3, repsMin: 8, repsMax: 12, descansoS: 90 };
}

const entre = (v, min, max, def) => Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;

// Normaliza lo que el usuario escribió: series 1–10, reps 1–50 y el máximo
// nunca por debajo del mínimo (8–6 se lee como 6–8, no como error).
export function limpiarEjercicioRutina(ej) {
  const { series, plan } = sinCalentamientos(entre(ej.series, 1, 10, 3), ej.plan);
  const a = entre(ej.repsMin, 1, 50, 8), b = entre(ej.repsMax, 1, 50, Number.isFinite(ej.repsMin) ? a : 12);
  // El plan de técnicas sigue al número de series: «+» añade una normal al
  // final y «−» quita la última.
  return { ...ej, series, repsMin: Math.min(a, b), repsMax: Math.max(a, b), ...(plan ? { plan: normalizarPlan(series, plan) } : {}) };
}

export function validarBorrador(b) {
  const errores = {};
  if (!String(b?.nombre ?? '').trim()) errores.nombre = 'Ponle un nombre para encontrarla después.';
  if (!(b?.ejercicios || []).length) errores.ejercicios = 'Agrega al menos un ejercicio.';
  return { ok: !Object.keys(errores).length, errores };
}

// Rutina guardada → borrador del editor (editar "Tus rutinas", pedido de
// Roberto, 30-oct-2026). Se edita el primer día; cada ejercicio recuerda su
// superserie (`grupo`) para volver a agruparse al guardar. `original` guarda
// la rutina tal cual: lo que el editor no toca (otros días, notas) se conserva.
export function borradorDesdeRutina(r) {
  const bloques = r?.dias?.[0]?.bloques || [];
  const ejercicios = bloques.flatMap((bloque, g) => bloque.map(it => ({
    ...limpiarEjercicioRutina({
      idEjercicio: it.idEjercicio, nombre: it.nombre ?? it.idEjercicio,
      series: it.series, repsMin: it.repsMin ?? it.repsMax, repsMax: it.repsMax ?? it.repsMin, descansoS: it.descansoS ?? 90,
      ...(Array.isArray(it.plan) ? { plan: it.plan } : {})
    }),
    grupo: bloque.length > 1 ? g : null
  })));
  return { id: r.id, nombre: r.nombre ?? '', ejercicios: normalizarGrupos(ejercicios), original: r };
}

// Borrador del editor → rutina con la misma forma que sesionARutina:
// "Tus rutinas" la pinta y la empieza igual. Los ejercicios seguidos del mismo
// `grupo` vuelven a ser una superserie; los nuevos van cada uno en su bloque.
export function rutinaDesdeBorrador(b, id) {
  const bloques = [];
  let previo;
  for (const ej of b.ejercicios) {
    const e = limpiarEjercicioRutina(ej);
    const item = { idEjercicio: e.idEjercicio, nombre: e.nombre, series: e.series, repsMin: e.repsMin, repsMax: e.repsMax, descansoS: e.descansoS ?? 90,
      // El plan solo se guarda si hay alguna técnica: las rutinas de siempre no cambian de forma.
      ...(planEsNormal(e.plan) ? {} : { plan: normalizarPlan(e.series, e.plan) }) };
    if (ej.grupo != null && ej.grupo === previo) bloques[bloques.length - 1].push(item);
    else bloques.push([item]);
    previo = ej.grupo;
  }
  const nombre = String(b.nombre).trim().slice(0, 40);
  const o = b.original;
  if (o) {
    const [dia1, ...resto] = o.dias || [];
    return { ...o, nombre, dias: [{ ...(dia1 || {}), nombre: dia1?.nombre ?? 'Día 1', bloques }, ...resto] };
  }
  return {
    id, nombre, nivel: null, objetivo: null, equipo: null,
    diasSemana: null, dias: [{ nombre: 'Día 1', bloques }], notas: ''
  };
}

// Superseries de 2 a 4 ejercicios (decisión de Roberto, 30-oct-2026): con
// más ya es un circuito y en el teléfono no se sigue.
export const MAX_SUPERSERIE = 4;

// Cada tramo seguido con el mismo `grupo` es UNA superserie: se renumeran por
// orden de aparición (0, 1, 2…) y un tramo de un solo ejercicio deja de serlo.
// Así ningún movimiento deja dos superseries partidas con el mismo número.
export function normalizarGrupos(ejercicios) {
  const out = ejercicios.map(e => ({ ...e }));
  let n = 0;
  for (let i = 0; i < out.length;) {
    const g = out[i].grupo;
    let fin = i;
    while (g != null && fin + 1 < out.length && out[fin + 1].grupo === g) fin++;
    const nuevo = g != null && fin > i ? n++ : null;
    for (let k = i; k <= fin; k++) out[k].grupo = nuevo;
    i = fin + 1;
  }
  return out;
}

// Letra de cada superserie en el editor y en la sesión: A, B, C… por orden de
// aparición (los grupos ya vienen renumerados por normalizarGrupos).
export function letraGrupo(g) { return g == null ? '' : String.fromCharCode(65 + (g % 26)); }

// Tramos [ini, fin] de la lista: cada superserie es UN tramo y cada ejercicio
// suelto, otro. Es la unidad que se mueve al arrastrar una superserie entera.
export function tramos(ejercicios) {
  const out = [];
  for (let i = 0; i < ejercicios.length;) {
    const g = ejercicios[i].grupo;
    let fin = i;
    while (g != null && fin + 1 < ejercicios.length && ejercicios[fin + 1].grupo === g) fin++;
    out.push([i, fin]);
    i = fin + 1;
  }
  return out;
}

const tamGrupo = (l, e) => e.grupo == null ? 1 : l.filter(x => x.grupo === e.grupo).length;

// ¿Se pueden unir el ejercicio i y el siguiente sin pasar de 4 por superserie?
export function puedeUnir(ejercicios, i) {
  const a = ejercicios[i], b = ejercicios[i + 1];
  if (!a || !b) return false;
  if (a.grupo != null && a.grupo === b.grupo) return true;
  return tamGrupo(ejercicios, a) + tamGrupo(ejercicios, b) <= MAX_SUPERSERIE;
}

// Une el ejercicio i con el siguiente: dos sueltos forman una superserie; uno
// suelto se suma a la superserie de al lado; dos superseries seguidas se
// funden. Nunca pasa de 4 (devuelve `error` y la lista sin cambios).
export function unirConSiguiente(ejercicios, i) {
  const l = normalizarGrupos(ejercicios);
  const a = l[i], b = l[i + 1];
  if (!a || !b) return { ejercicios: l, error: 'No hay un ejercicio siguiente para unir.' };
  if (a.grupo != null && a.grupo === b.grupo) return { ejercicios: l };
  if (!puedeUnir(l, i)) return { ejercicios: l, error: `Una superserie lleva como máximo ${MAX_SUPERSERIE} ejercicios.` };
  const nuevo = a.grupo ?? b.grupo ?? Math.max(-1, ...l.map(e => e.grupo ?? -1)) + 1;
  const deB = b.grupo;
  return {
    ejercicios: normalizarGrupos(l.map((e, k) =>
      k === i || k === i + 1 || (deB != null && e.grupo === deB) ? { ...e, grupo: nuevo } : e))
  };
}

// Separa la superserie entre i e i+1: lo de después forma otra (o queda suelto
// si es uno solo; lo de antes, igual).
export function separarDeSiguiente(ejercicios, i) {
  const l = normalizarGrupos(ejercicios);
  const a = l[i], b = l[i + 1];
  if (!a || !b || a.grupo == null || a.grupo !== b.grupo) return { ejercicios: l };
  const nuevo = Math.max(...l.map(e => e.grupo ?? -1)) + 1;
  return { ejercicios: normalizarGrupos(l.map((e, k) => k > i && e.grupo === a.grupo ? { ...e, grupo: nuevo } : e)) };
}

// Mueve un tramo entero (una superserie o un suelto) a la posición `hasta`,
// contada en tramos: nunca cae dentro de otra superserie.
export function moverTramo(ejercicios, desde, hasta) {
  const l = normalizarGrupos(ejercicios);
  const ts = tramos(l);
  if (!(desde >= 0 && desde < ts.length) || !(hasta >= 0 && hasta < ts.length) || desde === hasta) return l;
  const bloques = ts.map(([a, b]) => l.slice(a, b + 1));
  const [mov] = bloques.splice(desde, 1);
  bloques.splice(hasta, 0, mov);
  return normalizarGrupos(bloques.flat());
}

// Un paso arriba (dir -1) o abajo (+1) desde el menú «⋯» o con las flechas.
// Nunca mete un ejercicio en una superserie ajena por el camino: la salta
// entera. Si estaba en el borde de la suya, el primer paso lo saca de ella sin
// moverlo; dentro de la suya, cambia de sitio con su vecino.
// → { ejercicios, idx (dónde queda), cambio: 'dentro'|'salio'|'salto'|'paso'|null }
export function pasoEjercicio(ejercicios, i, dir) {
  const l = normalizarGrupos(ejercicios);
  const j = i + dir;
  const e = l[i];
  if (!e) return { ejercicios: l, idx: i, cambio: null };
  if (e.grupo != null) {
    if (l[j]?.grupo === e.grupo) { [l[i], l[j]] = [l[j], l[i]]; return { ejercicios: normalizarGrupos(l), idx: j, cambio: 'dentro' }; }
    l[i] = { ...e, grupo: null };
    return { ejercicios: normalizarGrupos(l), idx: i, cambio: 'salio' };
  }
  if (j < 0 || j >= l.length) return { ejercicios: l, idx: i, cambio: null };
  if (l[j].grupo == null) { [l[i], l[j]] = [l[j], l[i]]; return { ejercicios: normalizarGrupos(l), idx: j, cambio: 'paso' }; }
  const [ini, fin] = tramos(l).find(([a, z]) => j >= a && j <= z);
  const [mov] = l.splice(i, 1);
  const destino = dir > 0 ? fin : ini;
  l.splice(destino, 0, mov);
  return { ejercicios: normalizarGrupos(l), idx: destino, cambio: 'salto' };
}

// Mueve un ejercicio de `desde` a `hasta` (reordenar del editor). El que se
// mueve sigue en su superserie si queda junto a ella; si cae ENTRE dos de otra
// superserie con sitio, se une; en cualquier otro caso queda suelto.
export function moverEjercicio(ejercicios, desde, hasta) {
  const n = ejercicios.length;
  if (!(desde >= 0 && desde < n) || !(hasta >= 0 && hasta < n) || desde === hasta) return ejercicios.map(e => ({ ...e }));
  const lista = ejercicios.map(e => ({ ...e }));
  const [ej] = lista.splice(desde, 1);
  lista.splice(hasta, 0, ej);
  const prev = lista[hasta - 1], next = lista[hasta + 1];
  const propio = ej.grupo;
  if (propio != null && (prev?.grupo === propio || next?.grupo === propio)) {
    // sigue junto a su superserie
  } else if (prev && next && prev.grupo != null && prev.grupo === next.grupo
    && lista.filter(e => e !== ej && e.grupo === prev.grupo).length < MAX_SUPERSERIE) {
    ej.grupo = prev.grupo;
  } else {
    ej.grupo = null;
  }
  return normalizarGrupos(lista);
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
  if (!Number.isFinite(ms)) return 'Sin fecha';
  const f = new Date(ms).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
  return f.charAt(0).toUpperCase() + f.slice(1);
}

function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

const SVG_SUMAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const SVG_RESTAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SVG_LUPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8L20.5 20.5"/></svg>';
const SVG_VOLVER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';
const SVG_ASA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>';
const SVG_MAS = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>';
const SVG_CERRAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SVG_FILTROS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const SVG_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5L12 15l5.5-5.5"/></svg>';
const SVG_PAPELERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.5h6V7"/></svg>';
const SVG_ESLABON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>';

// ── Estado del módulo ────────────────────────────────────────────────────────
// `sesion` apunta al MISMO objeto que estado.entreno.sesionActiva: se edita en
// sitio y cada cambio pasa por persistir(), que lo reenvuelve en un estado
// nuevo del almacén. El módulo es el único escritor de entreno.*, así que la
// mutación local no cruza con nadie.

let ctx = null;              // { raiz, getMeta } que entrega app.js
let estado = null;
let sesion = null;

// Orden de las secciones de Entrenar (pedido de Roberto, 30-oct-2026): Rutinas
// va primero y es la que se abre al entrar, haya o no sesiones guardadas.
export const PESTANAS = ['rutinas', 'progreso', 'historial', 'biblioteca'];

let subtab = PESTANAS[0];    // 'rutinas' | 'progreso' | 'historial' | 'biblioteca'
let periodoProg = '1m';      // '1m' | '6m' (gráficas y comparaciones de Progreso)
let detalleTab = 'progreso'; // pestaña del detalle de un ejercicio
let modoBiblioteca = null;   // null (pestaña) | 'sesion' | 'rutina' (overlay "agregar a…")
let borrador = null;         // rutina en el editor de "Crear rutina": { nombre, ejercicios }
let erroresBorrador = {};
let relojDeshacer = null;    // cierra el aviso «Quitaste… · Deshacer» del editor    // errores del último intento de guardar (se ven junto a su campo)
let inicioPendiente = null;  // { rutina, dia }: falta elegir el descanso antes de empezar
let rutinaAbiertaId = null;  // rutina recién guardada: su tarjeta se pinta abierta una vez
let avisoRutina = '';        // "Rutina guardada" / "Cambios guardados" para lectores de pantalla
let menuEjIdx = null;        // ejercicio del editor con su menú "⋯" abierto
let asaLevantada = null;     // reordenar con teclado: { tipo: 'ej'|'grupo', idx, idxInicio, inicio, sucioAntes }
let arrastrando = false;     // hay un arrastre con el dedo en curso (bloquea el scroll del navegador)
let finArrastreMs = 0;       // cuándo terminó el último arrastre (el click que lo sigue no cuenta)
let hojaTecnica = null;      // hoja inferior abierta: { idx, serie, todas, planInicial } (técnica de una serie)
let escapeHojaInstalado = false;
let repintandoAsa = false;   // el teclado está repintando: perder el foco aquí no suelta nada
let verSesionId = null;      // sesión del historial abierta en modo lectura
let verProgresoId = null;    // ejercicio abierto en "progreso"
let fichaId = null;          // ejercicio abierto en su ficha (Biblioteca o sesión)
let vistaVivo = 'foco';      // 'foco' (Sesión en vivo) | 'ejercicios' (lista editable)
let filtrosBib = filtrosVacios(); // casillas de la Biblioteca (combinables con la búsqueda)
let panelFiltros = false;    // panel de casillas abierto
let abiertosBib = new Map(); // maestro → abierto/cerrado a mano (si no, se abre solo con pocos resultados)
let masBib = new Set();      // grupos de variantes con «+N más» ya desplegado
let volverBib = null;        // { y, id }: dónde estaba la Biblioteca al abrir una ficha
let consultaBib = '';        // texto del buscador (sobrevive repintados)

let descansoObj = null;      // objeto de crearDescanso() del descanso vivo
let avisadoFin = false;      // para avisar UNA vez al llegar a cero
let reloj = null;            // intervalo que REPINTA (nunca cuenta) crono y descanso
let timerOcultar = null;

// Catálogo y rutinas base: lazy, cada JSON se pide la primera vez que su
// pestaña lo necesita. 'fallo' pinta estado vacío claro, nunca pantalla rota.
let catEstado = 'nada';      // 'nada' | 'cargando' | 'listo' | 'fallo'
let catalogo = [];
let porId = new Map();
let maestrosCat = [];        // catálogo agrupado en ejercicios maestros (biblioteca.js)
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
  if (!sesion || sesion.finMs || !sesion.descanso) { descansoObj = null; avisadoFin = true; }
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
  if (restanteS <= 0 && d.micro) {
    empezarParteTrasMicro();
    persistir();
    return;
  }
  if (restanteS <= 0) {
    delete sesion.descanso;
    sesion.listoDesdeMs = d.finMs;
    persistir();
    return;
  }
  descansoObj = crearDescanso({ duracionS: restanteS });
  avisadoFin = false;
}

// ── Sesiones: crear, marcar, cerrar ──────────────────────────────────────────

// Descanso de un ejercicio añadido a mitad de sesión: el de la sesión (el que se
// eligió al empezar), no 90 s fijos; ya no hay control de descanso por tarjeta.
const descansoDeSesion = () => sesion?.ejercicios?.at(-1)?.descansoS ?? 90;

function nuevaSesion(rutinaId) {
  return { id: 'S-' + Date.now(), inicioMs: Date.now(), finMs: null, rutinaId: rutinaId ?? null, ejercicios: [], notas: '' };
}

function serieVacia(prev) {
  // La serie nueva hereda reps y peso de la anterior: en el gym lo normal es
  // repetir carga, y escribir de cero cada fila es la fricción que Hevy evita.
  return { reps: prev?.reps ?? 0, pesoKg: prev?.pesoKg ?? 0, rir: null, hecha: false, tsHecha: null };
}

function ejercicioDeSesion(idEjercicio, nombre, descansoS, superGrupo, nSeries, repsBase, rango = null, plan = null) {
  const tecnicas = planEsNormal(plan) ? null : normalizarPlan(nSeries, plan);
  // La última vez, emparejada por tipo: un calentamiento nuevo no le roba el
  // peso de trabajo a la primera serie (ni al revés).
  const previas = previasPorSerie(Array.from({ length: nSeries }, (_, i) => tecnicas?.[i]?.tipo ?? 'normal'),
    ultimaVez(estado.entreno.sesiones, idEjercicio));
  const series = [];
  for (let i = 0; i < nSeries; i++) {
    // Solo las series con técnica llevan `tipo` (y sus parámetros): una serie
    // normal conserva la forma de siempre.
    const t = tecnicas?.[i];
    series.push({
      reps: repsBase ?? previas[i]?.reps ?? 0,
      // El peso se precarga de la última vez (misma serie del mismo tipo): la
      // referencia ya está en el input y solo se corrige si hoy cambia.
      pesoKg: previas[i]?.pesoKg ?? 0,
      rir: null, hecha: false, tsHecha: null,
      ...(t && t.tipo !== 'normal' ? t : {})
    });
  }
  // El rango de la rutina (8–12) se muestra: varias rutinas progresan "al
  // llegar al tope del rango" y sin verlo no hay forma de seguirlas.
  return { idEjercicio, nombre, descansoS, superGrupo, series, ...(rango && rango.max ? { rango } : {}) };
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
  sesion.ejercicios.push(ejercicioDeSesion(id, f?.nombre ?? id, descansoDeSesion(), null, 3));
  persistir();
  pedirWakeLock();
  modoBiblioteca = null;
  render();
}

// `descansoS` es lo que el usuario eligió al empezar; null = lo que trae cada
// ejercicio de la rutina ("lo que sugiere la rutina").
async function empezarDesdeRutina(rutina, dia, descansoS = null) {
  inicioPendiente = null;
  sesionArrancando = true;
  // Los nombres salen del catálogo; si no carga, el id hace de nombre y la
  // sesión funciona igual (el nombre es presentación, no dato). Si la carga
  // que había en curso (p. ej. la del editor, para sus fotos) falló, se
  // intenta una vez más: la señal pudo volver.
  await cargarCatalogo();
  if (catEstado !== 'listo') await cargarCatalogo();
  if (!sesionArrancando) return;
  sesionArrancando = false;
  sesion = nuevaSesion(rutina.id);
  let grupo = 0;
  for (const bloque of dia.bloques || []) {
    const g = bloque.length > 1 ? ++grupo : null;
    for (const b of bloque) {
      const f = porId.get(b.idEjercicio);
      const { series, plan } = sinCalentamientos(b.series ?? 3, b.plan ?? null);
      sesion.ejercicios.push(ejercicioDeSesion(
        b.idEjercicio, f?.nombre ?? b.nombre ?? b.idEjercicio, descansoS ?? b.descansoS ?? 90, g, series, b.repsMin ?? null,
        b.repsMax ? { min: b.repsMin ?? b.repsMax, max: b.repsMax } : null, plan));
    }
  }
  persistir();
  pedirWakeLock();
  vistaVivo = 'foco';
  render();
  // Empezar desde una rutina de abajo de la lista dejaba la sesión a media
  // pantalla (el ejercicio 3 parecía el primero): siempre arriba.
  window.scrollTo(0, 0);
}

function agregarEjercicioASesion(id, nombre) {
  sesion.ejercicios.push(ejercicioDeSesion(id, nombre, descansoDeSesion(), null, 3));
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
  // Palomear a mano (esta u otra serie) a mitad de un rest-pause o un drop set
  // cierra antes esa serie con sus partes hechas.
  const pend = parteEnCursoValida() || (sesion.descanso?.micro ? { idx: sesion.descanso.idx, serie: sesion.descanso.micro.serie } : null);
  if (pend) {
    const mismo = pend.idx === idxEj && pend.serie === idxSerie;
    cerrarTecnicaPendiente();
    if (mismo) { persistir(); render(); return; }
  }
  // La fila se LEE en el toque: en móvil el blur del input no siempre llega
  // antes del tap y palomear con el teclado abierto perdía lo tecleado.
  leerFila(fila, serie);
  serie.hecha = !serie.hecha;
  serie.tsHecha = serie.hecha ? Date.now() : null;
  const c = sesion.serieEnCurso;
  if (c && c.idx === idxEj && c.serie === idxSerie) {
    if (serie.hecha) serie.durS = Math.round((serie.tsHecha - c.inicioMs) / 1000);
    sesion.serieEnCurso = null;
  }
  prepararAudio();
  if (serie.hecha) heredarASiguiente(ej, idxSerie);
  if (serie.hecha && siguientePendiente(sesion.ejercicios) && debeArrancarDescanso(sesion.ejercicios, idxEj, idxSerie)) {
    const idxRest = ej.superGrupo == null ? idxEj : ultimoDelGrupo(ej.superGrupo);
    arrancarDescanso(idxRest);
  } else if (serie.hecha) {
    sesion.listoDesdeMs = Date.now();
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
  cerrarTecnicaPendiente();
  sesion.finMs = Date.now();
  delete sesion.descanso;
  sesion.serieEnCurso = null;
  descansoObj = null;
  liberarWakeLock();
  persistir();
  render();
  window.scrollTo(0, 0);
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
    // Los calentamientos de antes no pasan a la rutina: no son series formales.
    const trabajo = ej.series.filter(s => !esCalentamiento(s));
    const hechas = trabajo.filter(s => s.hecha);
    const reps = hechas.map(s => s.reps).filter(r => r > 0);
    const plan = planDesdeSeries(hechas.length ? hechas : trabajo);
    const item = {
      idEjercicio: ej.idEjercicio,
      nombre: ej.nombre,
      series: hechas.length || trabajo.length || 1,
      repsMin: reps.length ? Math.min(...reps) : null,
      repsMax: reps.length ? Math.max(...reps) : null,
      descansoS: ej.descansoS,
      ...(plan ? { plan } : {})
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

function arrancarDescanso(idx, duracionS) {
  const ej = sesion.ejercicios[idx];
  const dur = duracionS ?? ej.descansoS;
  descansoObj = crearDescanso({ duracionS: dur });
  avisadoFin = false;
  if (timerOcultar) { clearTimeout(timerOcultar); timerOcultar = null; }
  // Se guarda la hora de FIN: tras un reload (o 2 min con la pestaña dormida)
  // el restante se deriva de ella y es exacto sin hacer nada.
  sesion.descanso = { finMs: descansoObj.finMs, duracionS: dur, idx };
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
  if (sesion?.descanso?.micro) {
    // En un rest-pause, saltar el micro-descanso es empezar la mini-serie.
    const k = sesion.descanso.micro.k;
    empezarParteTrasMicro();
    cerrarBarraDescanso();
    persistir();
    anunciar(`Mini-serie ${k + 1}: ¡a darle!`);
    render();
    return;
  }
  descansoObj.saltar();
  // Persistir el salto: sin esto el descanso saltado resucitaba (con alarma)
  // al volver a la pestaña o recargar, porque el disco guardaba su fin viejo.
  if (sesion) { delete sesion.descanso; sesion.listoDesdeMs = Date.now(); persistir(); }
  cerrarBarraDescanso();
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
  pintarFoco();
}

function arrancarReloj() {
  pararReloj();
  reloj = setInterval(tic, 1000);
}

function pararReloj() {
  if (reloj) { clearInterval(reloj); reloj = null; }
}

// ── Datos lazy: catálogo de ejercicios y rutinas sugeridas ───────────────────

// Se corta si la descarga se queda SIN AVANZAR (no si es lenta): una señal
// que se va a medias dejaba la promesa colgada para siempre y, con ella, a
// todas las pantallas que la esperan. Mientras lleguen datos, sigue. Al
// cortarse pasa a 'fallo' y el reintento normal se encarga.
const SIN_AVANCE_MS = 8000;
async function pedirConLimite(ruta) {
  const corte = new AbortController();
  let t = 0;
  const vigilar = () => { clearTimeout(t); t = setTimeout(() => corte.abort(), SIN_AVANCE_MS); };
  vigilar();
  try {
    const r = await fetch(ruta, { signal: corte.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (!r.body?.getReader) return await r.json();
    vigilar();
    const lector = r.body.getReader();
    const partes = [];
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      partes.push(value);
      vigilar();
    }
    return JSON.parse(await new Blob(partes).text());
  } finally { clearTimeout(t); }
}
async function cargarJSON(ruta, clave) {
  const d = await pedirConLimite(ruta);
  // Se acepta lista pelada u objeto envoltorio: el formato lo fija el
  // pipeline de datos y este lector no debe romperse por un sobre de más.
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.[clave])) return d[clave];
  return [];
}

let catPromesa = null, rutPromesa = null, catFalloMs = 0;
// Mientras empezarDesdeRutina espera el catálogo (los nombres salen de ahí):
// si la persona se va con «Rutinas», la sesión ya no arranca por sorpresa.
let sesionArrancando = false;
// ¿Le toca a esta pantalla pedir el catálogo y repintarse al llegar? También
// mientras está 'cargando': quien lo pidió primero pudo ser otra pantalla (el
// editor lo pide solo para las fotos y no repinta la Biblioteca). Tras un
// fallo se reintenta, pero no en cada repintado: sin señal en el gimnasio,
// cada toque lanzaría otra descarga de 850 KB.
function faltaCatalogo(esperaTrasFalloMs = 20000) {
  if (catEstado === 'nada' || catEstado === 'cargando') return true;
  return catEstado === 'fallo' && Date.now() - catFalloMs >= esperaTrasFalloMs;
}
// Repintar porque llegó el catálogo sin pisar lo que se está escribiendo: con
// un campo de texto en uso (reps, peso, notas, nombre de la rutina) solo se
// ponen las fotos en su sitio, porque repintar tiraría lo tecleado que aún no
// se guardó (se guarda al salir del campo); lo demás sale en el siguiente
// repintado normal. Si la carga falló no hay nada nuevo que pintar, salvo
// donde un «Cargando…» tiene que cambiar (conFallo).
function repintarConCatalogo(siSigue, conFallo = false) {
  if (!siSigue() || (catEstado !== 'listo' && !conFallo)) return;
  const a = document.activeElement;
  if (a && ctx.raiz.contains(a) && (a.tagName === 'TEXTAREA'
    || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset)$/i.test(a.type)))) {
    rellenarFotos(ctx.raiz);
    return;
  }
  render();
}
function cargarCatalogo() {
  if (catEstado === 'listo') return Promise.resolve();
  if (!catPromesa) catPromesa = cargarCatalogoReal().finally(() => { catPromesa = null; });
  return catPromesa;
}
async function cargarCatalogoReal() {
  catEstado = 'cargando';
  try {
    // Los grupos son opcionales: si no llegan, cada ejercicio va solo y la
    // biblioteca sigue funcionando igual que antes.
    const [cat, grupos] = await Promise.all([
      cargarJSON('data/ejercicios.json', 'ejercicios'),
      pedirConLimite('data/grupos-ejercicios.json').catch(() => null),
    ]);
    catalogo = cat;
    porId = new Map(catalogo.map(e => [e.id, e]));
    maestrosCat = construirMaestros(catalogo, grupos);
    catEstado = 'listo';
  } catch {
    catalogo = [];
    porId = new Map();
    maestrosCat = [];
    catEstado = 'fallo';
    catFalloMs = Date.now();
  }
}

function cargarRutinas() {
  if (rutEstado === 'listo') return Promise.resolve();
  if (!rutPromesa) rutPromesa = cargarRutinasReal().finally(() => { rutPromesa = null; });
  return rutPromesa;
}
async function cargarRutinasReal() {
  rutEstado = 'cargando';
  try {
    rutinasBase = await cargarJSON('data/rutinas.json', 'rutinas');
    rutEstado = 'listo';
  } catch {
    rutinasBase = [];
    rutEstado = 'fallo';
  }
}

function unidadPeso() { return (estado.preferencias?.unidadPeso || estado.perfil?.unidadPeso) === 'lb' ? 'lb' : 'kg'; }

// ── Render raíz ──────────────────────────────────────────────────────────────

// Re-render con innerHTML tira el foco del teclado a <body>: tras CADA serie
// palomeada, quien navega con teclado tenía que re-tabular desde el principio.
// Esto describe el control activo por sus data-atributos estables y lo
// re-enfoca en el DOM nuevo, si sigue existiendo.
function selectorFoco(el) {
  if (!el || el === document.body || !ctx.raiz.contains(el)) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const d = el.dataset || {};
  const attrs = ['acc', 'id', 'idx', 'tramo', 'tab', 'sid', 'ej', 'serie', 'v', 'f', 'clave', 'k', 'lugar', 'campo', 'dtab', 'periodo'].filter(k => d[k] !== undefined)
    .map(k => `[data-${k}="${CSS.escape(d[k])}"]`).join('');
  return attrs ? el.tagName.toLowerCase() + attrs : null;
}

function render() {
  const a = document.activeElement;
  const foco = selectorFoco(a);
  // El cursor de un campo de texto vuelve a su sitio: sin esto, lo que se
  // escribía tras un repintado (p. ej. al llegar el catálogo mientras se
  // busca) caía al principio: «press» + « banca» → « bancapress».
  let cursor = null;
  try { if (foco && typeof a.selectionStart === 'number') cursor = [a.selectionStart, a.selectionEnd]; } catch { /* sin cursor */ }
  renderVista();
  if (!foco) return;
  const n = ctx.raiz.querySelector(foco);
  n?.focus({ preventScroll: true });
  if (cursor && n && typeof n.value === 'string' && n.value.length >= cursor[1]) {
    try { n.setSelectionRange(cursor[0], cursor[1]); } catch { /* tipo sin cursor */ }
  }
}

function renderVista() {
  pararReloj();
  const raiz = ctx.raiz;
  // El resumen y el historial necesitan el catálogo (grupos musculares) y las
  // rutinas base (nombre de la sesión): si aún no están, se piden y se
  // repinta al llegar. Los flags de carga evitan pedirlos dos veces.
  if ((sesion || verSesionId) && faltaCatalogo()) cargarCatalogo().then(() => repintarConCatalogo(() => !!(sesion || verSesionId)));
  if ((sesion?.rutinaId || verSesionId) && rutEstado === 'nada') cargarRutinas().then(() => render());
  if (sesion && !sesion.finMs) {
    if (fichaId) { pintarFicha(raiz, fichaId); return; }
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
  if (inicioPendiente) { pintarElegirDescanso(raiz); return; }
  if (borrador) {
    if (modoBiblioteca === 'rutina') { pintarBiblioteca(raiz, 'rutina'); return; }
    pintarEditorRutina(raiz);
    return;
  }
  if (fichaId) { pintarFicha(raiz, fichaId); return; }
  if (verProgresoId) { pintarDetalleEjercicio(raiz, verProgresoId); return; }
  pintarInicio(raiz);
}

// ── Inicio: Rutinas · Progreso · Historial · Biblioteca ──────────────────────

function pintarInicio(raiz) {
  raiz.innerHTML = `
  <div class="en-wrap">
    <div class="en-ey">Entrenar</div>
    <h2 class="en-titulo">Tu fuerza</h2>
    <p class="en-sub">Empieza una serie, termínala y el descanso corre solo.</p>

    <div class="en-tabs" role="group" aria-label="Secciones de Entrenar">
      ${PESTANAS.map(t => `
        <button type="button" class="en-tab${subtab === t ? ' en-tab-on' : ''}"
          aria-pressed="${subtab === t}" data-tab="${t}">${capital(t)}</button>`).join('')}
    </div>
    <div class="en-panel"></div>
    <p class="en-aviso-storage" hidden>No se pudo guardar en este dispositivo. Exporta un respaldo desde Diario antes de cerrar.</p>
    ${true ? `<div class="en-unidad en-unidad-pie" role="group" aria-label="Unidad de peso">
      <span>Unidad de peso</span>
      ${['kg', 'lb'].map(u => `<button type="button" class="en-unidad-btn${unidadPeso() === u ? ' en-unidad-on' : ''}" aria-pressed="${unidadPeso() === u}" data-unidad="${u}">${u}</button>`).join('')}
    </div>` : ''}
    <p class="en-fuentes">Ejercicios e imágenes: free-exercise-db (dominio público). Tus entrenamientos viven solo en este dispositivo.</p>
  </div>`;
  raiz.querySelector('.en-unidad')?.addEventListener('click', e => {
    const b = e.target.closest('[data-unidad]');
    if (!b) return;
    // En México los discos y mancuernas suelen venir en libras: se guarda en
    // el perfil (los pesos se siguen guardando en kg; solo cambia la vista).
    const u = b.dataset.unidad;
    escribir(est => {
      const conPref = { ...est, preferencias: { ...(est.preferencias || {}), unidadPeso: u } };
      return est.perfil ? almacen.guardarPerfil(conPref, { ...est.perfil, unidadPeso: u }) : conPref;
    });
    render();
  });
  raiz.querySelector('.en-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    subtab = b.dataset.tab;
    verProgresoId = null;
    rutinaAbiertaId = null;
    render();
  });
  const panel = raiz.querySelector('.en-panel');
  if (subtab === 'progreso') pintarPanelProgreso(panel);
  else if (subtab === 'rutinas') pintarPanelRutinas(panel);
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
    // Lo que decide un principiante: nivel y cuántos días; y ejercicios POR
    // DÍA (la suma de todos los días, "38 ejercicios", asustaba y engañaba).
    const nDias = r.diasSemana || dias.length;
    const porDia = dias.length ? Math.round(nEj / dias.length) : 0;
    const sub = [
                 nDias ? `${nDias} ${nDias === 1 ? 'día' : 'días'} por semana` : null,
                 porDia ? `${porDia} ejercicios por día` : null,
                 nSuper ? nSuper + (nSuper === 1 ? ' superserie' : ' superseries') : null,
                 // El objetivo del JSON es un slug estable ('recomposicion'):
                 // al usuario se le muestra con su tilde, nunca el slug crudo.
                 ({ recomposicion: 'recomposición' })[r.objetivo] || r.objetivo,
                 r.equipo].filter(Boolean).join(' · ');
    // Plegada por defecto: con las 10 rutinas expandidas la pantalla era un
    // muro de ~37 botones "Empezar" idénticos. Se toca la rutina y aparecen
    // sus días; un principiante elige entre 10 nombres, no entre 37 botones.
    return `
    <details class="en-card en-rut"${origen === 'mia' && String(r.id) === rutinaAbiertaId ? ' open' : ''}>
      <summary class="en-rut-sum">
        ${r.nivel ? `<span class="en-nivel en-nivel-${esc(r.nivel)}">${esc(capital(r.nivel))}</span>` : ''}
        <span class="en-card-nombre">${esc(r.nombre)}</span>
        <span class="en-card-sub">${esc(sub)}</span>
      </summary>
      ${r.notas ? `<p class="en-rut-notas">${esc(r.notas)}</p>` : ''}
      <div class="en-card-dias">
        ${dias.map((d, i) => `<button type="button" class="en-btn en-btn-ghost" data-acc="rutina"
          data-origen="${origen}" data-rid="${esc(r.id)}" data-dia="${i}">Empezar${dias.length > 1 ? ' · ' + esc(d.nombre) : ''}</button>`).join('')}
      </div>
      ${origen === 'mia' ? `<div class="en-rut-borrar">
        <button type="button" class="en-rut-editar" data-acc="editar-rutina" data-rid="${esc(r.id)}" aria-label="Editar ${esc(r.nombre)}">Editar</button>
        <button type="button" class="en-peligro" data-acc="borrar-rutina" data-rid="${esc(r.id)}">Borrar rutina</button>
      </div>` : ''}
    </details>`;
  };
  // Una sola acción principal: crear la rutina propia. Entrenar sin plan
  // sigue a un toque, pero como secundaria (pedido de Roberto, 30-oct-2026).
  panel.innerHTML = `
    <div class="en-rut-acciones">
      <button type="button" class="en-btn en-btn-main" data-acc="crear-rutina">Crear rutina</button>
      <button type="button" class="en-btn en-btn-ghost en-empezar-vacia" data-acc="vacia">Empezar sesión vacía</button>
    </div>
    <p class="en-sr" role="status">${esc(avisoRutina)}</p>
    ${guardadas.length ? `<div class="en-sec-lbl">Tus rutinas</div>${guardadas.map(r => htmlRutina(r, 'mia')).join('')}` : ''}
    <div class="en-sec-lbl">Rutinas COSECHA</div>
    ${rutEstado === 'listo' && rutinasBase.length
      ? rutinasBase.map(r => htmlRutina(r, 'base')).join('')
      : rutEstado === 'fallo' || (rutEstado === 'listo' && !rutinasBase.length)
        ? '<p class="en-vacio">Aún no hay rutinas sugeridas. Crea la tuya con «Crear rutina».</p>'
        : '<p class="en-vacio">Cargando rutinas…</p>'}`;
  panel.addEventListener('click', e => {
    // La tarjeta recién guardada se abre una vez; cualquier toque la libera.
    rutinaAbiertaId = null;
    avisoRutina = '';
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    if (b.dataset.acc === 'editar-rutina') {
      const r = estado.entreno.rutinas.find(x => String(x.id) === b.dataset.rid);
      if (!r) return;
      borrador = borradorDesdeRutina(r);
      erroresBorrador = {};
      hojaTecnica = null;
      menuEjIdx = null;
      asaLevantada = null;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (b.dataset.acc === 'crear-rutina') {
      borrador = { nombre: '', ejercicios: [] };
      erroresBorrador = {};
      hojaTecnica = null;
      menuEjIdx = null;
      asaLevantada = null;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (b.dataset.acc === 'vacia') { empezarVacia(); return; }
    if (b.dataset.acc === 'borrar-rutina') {
      if (!armarDosToques(b, 'Toca otra vez para borrarla')) return;
      const rid = b.dataset.rid;
      escribir(e => ({ ...e, entreno: { ...e.entreno, rutinas: e.entreno.rutinas.filter(x => String(x.id) !== rid) } }));
      render();
      return;
    }
    if (b.dataset.acc === 'rutina') {
      const lista = b.dataset.origen === 'mia' ? estado.entreno.rutinas : rutinasBase;
      const r = lista.find(x => String(x.id) === b.dataset.rid);
      const d = r?.dias?.[+b.dataset.dia];
      // Antes de arrancar se elige el descanso entre series.
      if (r && d) { inicioPendiente = { rutina: r, dia: d }; render(); window.scrollTo(0, 0); }
    }
  });
}

// ── Elegir el descanso antes de empezar una rutina ──────────────────────────

function pintarElegirDescanso(raiz) {
  const { rutina, dia } = inicioPendiente;
  const rango = rangoDescanso(dia);
  // "Lo que sugiere la rutina" solo aporta si no coincide con una opción fija.
  const sugerida = rango && (rango.min !== rango.max || !OPCIONES_DESCANSO.includes(rango.min));
  const pistas = { 60: 'Ritmo ágil', 90: 'Equilibrado', 120: 'Más recuperación', 180: 'Cargas pesadas' };
  const opcion = (valor, titulo, pista) => `
    <button type="button" class="en-card en-card-btn en-desc-op" data-acc="descanso" data-v="${valor}">
      <span class="en-card-nombre">${esc(titulo)}</span>
      <span class="en-card-sub">${esc(pista)}</span>
    </button>`;
  const nombreDia = (rutina.dias || []).length > 1 ? ` · ${dia.nombre}` : '';
  raiz.innerHTML = `
  <div class="en-wrap">
    <button type="button" class="en-volver" data-acc="desc-volver">${SVG_VOLVER}<span>Rutinas</span></button>
    <div class="en-ey">${esc(rutina.nombre + nombreDia)}</div>
    <h2 class="en-titulo">Descanso entre series</h2>
    <p class="en-sub">Elige cuánto descansas entre cada serie. El descanso arranca solo al terminar una serie, y en la sesión lo puedes ajustar por ejercicio.</p>
    <div class="en-desc-ops" role="group" aria-label="Descanso entre series">
      ${OPCIONES_DESCANSO.map(s => opcion(s, etiquetaDescanso(s), pistas[s])).join('')}
      ${sugerida ? opcion('rutina', 'Lo que sugiere la rutina',
        rango.min === rango.max ? etiquetaDescanso(rango.min) : `De ${etiquetaDescanso(rango.min)} a ${etiquetaDescanso(rango.max)}, según el ejercicio`) : ''}
    </div>
    <p class="en-sub en-desc-espera" role="status" aria-live="polite"></p>
  </div>`;
  raiz.querySelector('.en-wrap').addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    if (b.dataset.acc === 'desc-volver') { inicioPendiente = null; sesionArrancando = false; render(); return; }
    if (b.dataset.acc === 'descanso') {
      if (!inicioPendiente) return;   // doble toque: la sesión ya está arrancando
      const v = b.dataset.v === 'rutina' ? null : +b.dataset.v;
      // Si hay que esperar al catálogo, que se note: antes el toque no hacía
      // nada visible hasta que llegaba.
      if (catEstado !== 'listo') {
        b.setAttribute('aria-busy', 'true');
        raiz.querySelector('.en-desc-espera').textContent = 'Preparando tu rutina…';
      }
      empezarDesdeRutina(rutina, dia, v);
    }
  });
}

// ── Crear rutina (editor) ────────────────────────────────────────────────────

function pintarEditorRutina(raiz) {
  const b = borrador;
  const err = erroresBorrador;
  const editando = !!b.original;   // editar una de "Tus rutinas" o crear una nueva
  const l = b.ejercicios;
  const n = l.length;
  const ts = tramos(l);
  const tramoDe = i => ts.findIndex(([a, z]) => i >= a && i <= z);
  const lev = asaLevantada;
  // «Deshacer» solo vale mientras la lista siga tal cual quedó al quitar: con
  // cualquier otro cambio, devolver la foto de antes lo pisaría.
  if (b.deshacer && JSON.stringify(l) !== b.deshacer.despues) delete b.deshacer;
  const tarjeta = (ej, i) => {
    const enGrupo = ej.grupo != null;
    const t = tramoDe(i);
    const inicioGrupo = enGrupo && ts[t][0] === i;
    const tam = enGrupo ? ts[t][1] - ts[t][0] + 1 : 1;
    const letra = letraGrupo(ej.grupo);
    const etiqueta = enGrupo ? `${letra}${i - ts[t][0] + 1}` : '';
    const sig = l[i + 1];
    const unidoSig = enGrupo && sig?.grupo === ej.grupo;
    const levantado = lev && (lev.tipo === 'grupo' ? lev.idx === t : lev.idx === i);
    const nombre = esc(ej.nombre);
    return `
    <li class="en-ed-item${enGrupo ? ' en-ed-en-grupo' : ''}${unidoSig ? ' en-ed-unido' : ''}" data-idx="${i}">
      ${inicioGrupo ? `<div class="en-ed-grupo-cab">
        ${ts.length > 1 ? `<button type="button" class="en-ed-asa" data-acc="ed-asa-grupo" data-tramo="${t}" aria-pressed="${lev?.tipo === 'grupo' && lev.idx === t}"
          aria-label="Mover la superserie ${letra} completa, posición ${t + 1} de ${ts.length}" aria-describedby="en-ed-asa-ayuda">${SVG_ASA}</button>` : ''}
        <span class="en-ed-grupo-tit">Superserie ${letra} · ${tam} ejercicios</span>
      </div>` : ''}
      <div class="en-card en-ed-ej${levantado ? ' en-ed-levantada' : ''}">
        <div class="en-ed-ej-top">
          ${n > 1 ? `<button type="button" class="en-ed-asa" data-acc="ed-asa" data-idx="${i}" aria-pressed="${lev?.tipo === 'ej' && lev.idx === i}"
            aria-label="Mover ${etiqueta ? etiqueta + ', ' : ''}${nombre}, posición ${i + 1} de ${n}" aria-describedby="en-ed-asa-ayuda">${SVG_ASA}</button>` : ''}
          ${etiqueta ? `<span class="en-ed-etq" aria-hidden="true">${etiqueta}</span>` : ''}
          ${miniatura(ej.idEjercicio)}
          <span class="en-card-nombre">${nombre}</span>
          <button type="button" class="en-ed-quitar" data-acc="ed-quitar" data-idx="${i}" aria-label="Quitar ${nombre} de la rutina">${SVG_PAPELERA}</button>
          ${n > 1 ? `<button type="button" class="en-ed-mas" data-acc="ed-menu" data-idx="${i}" aria-expanded="${menuEjIdx === i}"
            aria-controls="en-ed-menu-${i}" aria-label="Más opciones de ${nombre}">${SVG_MAS}</button>` : ''}
        </div>
        <div class="en-ed-menu" id="en-ed-menu-${i}"${menuEjIdx === i ? '' : ' hidden'}>
          <button type="button" class="en-ed-op" data-acc="ed-subir" data-idx="${i}"${i === 0 && !enGrupo ? ' aria-disabled="true"' : ''}>Subir</button>
          <button type="button" class="en-ed-op" data-acc="ed-bajar" data-idx="${i}"${i === n - 1 && !enGrupo ? ' aria-disabled="true"' : ''}>Bajar</button>
          ${enGrupo ? `
          <button type="button" class="en-ed-op" data-acc="ed-subir-grupo" data-idx="${i}"${t === 0 ? ' aria-disabled="true"' : ''}>Subir superserie</button>
          <button type="button" class="en-ed-op" data-acc="ed-bajar-grupo" data-idx="${i}"${t === ts.length - 1 ? ' aria-disabled="true"' : ''}>Bajar superserie</button>` : ''}
        </div>
        <div class="en-ed-campos">
          <div class="en-ed-campo">
            <span class="en-ed-lbl" id="en-ed-series-${i}">Series</span>
            <div class="en-ed-step" role="group" aria-labelledby="en-ed-series-${i}">
              <button type="button" class="en-d-aj" data-acc="ed-series" data-idx="${i}" data-v="-1" aria-label="Una serie menos de ${nombre}"${ej.series <= 1 ? ' aria-disabled="true"' : ''}>−</button>
              <output class="en-ed-val" aria-live="polite">${ej.series}</output>
              <button type="button" class="en-d-aj" data-acc="ed-series" data-idx="${i}" data-v="1" aria-label="Una serie más de ${nombre}"${ej.series >= 10 ? ' aria-disabled="true"' : ''}>+</button>
            </div>
          </div>
          <div class="en-ed-campo">
            <span class="en-ed-lbl" id="en-ed-reps-${i}">Repeticiones</span>
            <div class="en-ed-reps" role="group" aria-labelledby="en-ed-reps-${i}">
              <input class="en-in en-ed-in" inputmode="numeric" maxlength="2" value="${ej.repsMin}"
                data-campo="repsMin" data-idx="${i}" aria-label="Mínimo de repeticiones de ${nombre}">
              <span aria-hidden="true">–</span>
              <input class="en-in en-ed-in" inputmode="numeric" maxlength="2" value="${ej.repsMax}"
                data-campo="repsMax" data-idx="${i}" aria-label="Máximo de repeticiones de ${nombre}">
            </div>
          </div>
        </div>
        <div class="en-ed-tecnicas">
          <span class="en-ed-lbl" id="en-ed-tec-${i}">Técnica por serie</span>
          <div class="en-ed-pildoras" role="group" aria-labelledby="en-ed-tec-${i}">
            ${normalizarPlan(ej.series, ej.plan).map((t, j) => {
              const T = TECNICAS[t.tipo];
              return `<button type="button" class="en-ed-pildora${t.tipo !== 'normal' ? ' en-ed-pildora-con' : ''}" data-acc="ed-tecnica" data-idx="${i}" data-serie="${j}"
                aria-haspopup="dialog" aria-label="Serie ${j + 1}: ${T.nombre}. Cambiar técnica">${j + 1}${T.insignia ? `<span class="en-ed-pildora-ins" aria-hidden="true">${T.insignia}</span>` : ''}</button>`;
            }).join('')}
          </div>
        </div>
      </div>
      ${sig ? `<div class="en-ed-enlace">${unidoSig
        ? `<button type="button" class="en-ed-unir en-ed-unir-on" data-acc="ed-separar" data-idx="${i}"
            aria-label="Separar ${nombre} y ${esc(sig.nombre)}">${SVG_ESLABON}<span>Separar</span></button>`
        : puedeUnir(l, i)
          ? `<button type="button" class="en-ed-unir" data-acc="ed-unir" data-idx="${i}"
              aria-label="Unir en superserie ${nombre} y ${esc(sig.nombre)}">${SVG_ESLABON}<span>Unir en superserie</span></button>`
          : `<span class="en-ed-unir-lleno">${tamGrupo(l, ej) >= MAX_SUPERSERIE || tamGrupo(l, sig) >= MAX_SUPERSERIE
              ? `Superserie llena · máximo ${MAX_SUPERSERIE}` : `Juntas pasarían de ${MAX_SUPERSERIE} ejercicios`}</span>`}</div>` : ''}
    </li>`;
  };
  if (hojaTecnica && !l[hojaTecnica.idx]) { hojaTecnica = null; inertesFuera(false); }
  raiz.innerHTML = `
  <div class="en-wrap en-editor"${hojaTecnica ? ' inert' : ''}>
    <button type="button" class="en-volver" data-acc="ed-cancelar">${SVG_VOLVER}<span>Rutinas</span></button>
    <div class="en-ey">${editando ? 'Tus rutinas' : 'Nueva rutina'}</div>
    <h2 class="en-titulo">${editando ? 'Editar rutina' : 'Crear rutina'}</h2>
    <p class="en-sub">${editando
      ? 'Cambia el nombre, los ejercicios, las series o las repeticiones. Tus sesiones anteriores no cambian.'
      : 'Elige tus ejercicios y cuántas series y repeticiones harás. Se guarda en Tus rutinas; el descanso lo eliges al empezarla.'}</p>

    <label class="en-ed-lbl" for="en-ed-nombre">Nombre</label>
    <input id="en-ed-nombre" class="en-rutina-nombre en-ed-nombre" maxlength="40" autocomplete="off" value="${esc(b.nombre)}"
      ${err.nombre ? 'aria-invalid="true" aria-describedby="en-ed-nombre-err"' : ''}>
    ${err.nombre ? `<p class="en-ed-err" id="en-ed-nombre-err">${esc(err.nombre)}</p>` : ''}

    <div class="en-sec-lbl">Ejercicios</div>
    ${n > 1 ? '<p class="en-ed-pista">Mantén presionado un ejercicio para cambiar el orden. «Unir en superserie» alterna dos o más ejercicios y descansas al terminar la ronda.</p>' : ''}
    ${n
      ? `<ol class="en-ed-lista">${l.map(tarjeta).join('')}</ol>`
      : '<p class="en-vacio">Todavía no hay ejercicios. Agrega el primero desde la biblioteca.</p>'}
    <p class="en-sr" id="en-ed-asa-ayuda">Arrastra este botón o mantén presionada la tarjeta. Al tocarlo se abren Subir y Bajar. Con teclado: Enter para levantar, flechas para mover, Enter para soltar y Escape para cancelar.</p>
    <p class="en-sr" id="en-ed-anuncio" role="status"></p>
    ${b.deshacer ? `<div class="en-ed-deshacer">
      <span>Quitaste ${esc(b.deshacer.nombre)}</span>
      <button type="button" data-acc="ed-deshacer">Deshacer</button>
    </div>` : ''}
    ${err.ejercicios ? `<p class="en-ed-err" id="en-ed-ej-err">${esc(err.ejercicios)}</p>` : ''}
    <button type="button" class="en-btn en-btn-ghost en-ed-agregar" data-acc="ed-agregar"
      ${err.ejercicios ? 'aria-describedby="en-ed-ej-err"' : ''}>Agregar ejercicio</button>

    <button type="button" class="en-btn en-btn-main en-ed-guardar" data-acc="ed-guardar">${editando ? 'Guardar cambios' : 'Guardar rutina'}</button>
    <p class="en-aviso-storage" hidden>No se pudo guardar en este dispositivo. Exporta un respaldo desde Diario antes de cerrar.</p>
  </div>
  ${hojaTecnica ? htmlHojaTecnica() : ''}`;

  if (hojaTecnica) conectarHojaTecnica(raiz);
  // Las fotos de las tarjetas salen del catálogo; si aún no está, se pide una
  // sola vez y se ponen en su sitio al llegar (sin repintar: hay campos a
  // medio escribir).
  if (faltaCatalogo()) cargarCatalogo().then(() => { if (borrador) rellenarFotos(raiz); });
  const wrap = raiz.querySelector('.en-wrap');
  wrap.querySelector('#en-ed-nombre').addEventListener('input', e => {
    soltarSinRepintar();
    b.nombre = e.target.value;
    b.sucio = true;
    if (erroresBorrador.nombre && b.nombre.trim()) {
      delete erroresBorrador.nombre;
      e.target.removeAttribute('aria-invalid');
      wrap.querySelector('#en-ed-nombre-err')?.remove();
    }
  });
  // Las repeticiones se normalizan al salir del campo, no por tecla: escribir
  // "1" camino de "12" no debe saltar a otro valor. Se corrigen en sitio, sin
  // repintar: el foco ya va camino del siguiente campo.
  wrap.querySelectorAll('.en-ed-in').forEach(inp => inp.addEventListener('change', () => {
    soltarSinRepintar();
    const i = +inp.dataset.idx;
    b.ejercicios[i] = limpiarEjercicioRutina({ ...b.ejercicios[i], [inp.dataset.campo]: parseInt(inp.value, 10) });
    b.sucio = true;
    wrap.querySelectorAll(`.en-ed-in[data-idx="${i}"]`).forEach(x => { x.value = b.ejercicios[i][x.dataset.campo]; });
  }));
  wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-acc]');
    if (!btn) return;
    const acc = btn.dataset.acc;
    const i = +btn.dataset.idx;
    if (acc === 'ed-asa' || acc === 'ed-asa-grupo') {
      // El click que deja un arrastre no hace nada. Un toque sin arrastrar
      // (o el doble toque de VoiceOver, que no puede arrastrar ni usar
      // flechas) abre «⋯» de ese ejercicio con Subir y Bajar a mano.
      if (Date.now() - finArrastreMs < 700) return;
      const k = acc === 'ed-asa' ? i : tramos(b.ejercicios)[+btn.dataset.tramo]?.[0];
      if (k == null) return;
      asaLevantada = null;
      menuEjIdx = k;
      render();
      enfocar(...(acc === 'ed-asa'
        ? [`[data-acc="ed-subir"][data-idx="${k}"]`, `[data-acc="ed-bajar"][data-idx="${k}"]`]
        : [`[data-acc="ed-subir-grupo"][data-idx="${k}"]`, `[data-acc="ed-bajar-grupo"][data-idx="${k}"]`]),
        `[data-acc="ed-menu"][data-idx="${k}"]`);
      return;
    }
    asaLevantada = null;
    const desactivado = btn.getAttribute('aria-disabled') === 'true';
    if (acc === 'ed-cancelar') {
      // Perder una rutina a medio armar por un toque en "volver" dolería:
      // con algo escrito, doble toque, igual que los demás descartes.
      if (b.sucio && !armarDosToques(btn.querySelector('span'), editando ? 'Toca otra vez para descartar los cambios' : 'Toca otra vez para descartarla')) return;
      borrador = null;
      erroresBorrador = {};
      menuEjIdx = null;
      render();
    } else if (acc === 'ed-agregar') {
      modoBiblioteca = 'rutina';
      consultaBib = '';
      menuEjIdx = null;
      render();
      window.scrollTo(0, 0);
    } else if (acc === 'ed-menu') {
      menuEjIdx = menuEjIdx === i ? null : i;
      render();
    } else if (acc === 'ed-subir' || acc === 'ed-bajar') {
      if (desactivado) return;
      // Un paso: salta las superseries ajenas, nunca entra en ellas.
      const r = pasoEjercicio(b.ejercicios, i, acc === 'ed-subir' ? -1 : 1);
      if (!r.cambio) return;
      b.ejercicios = r.ejercicios;
      b.sucio = true;
      menuEjIdx = r.idx;
      render();
      // El foco sigue al ejercicio movido, en el mismo botón, para poder
      // seguir subiendo o bajando sin buscarlo.
      enfocar(`[data-acc="${acc}"][data-idx="${r.idx}"]`, `[data-acc="ed-menu"][data-idx="${r.idx}"]`);
      anunciarPaso(r);
    } else if (acc === 'ed-subir-grupo' || acc === 'ed-bajar-grupo') {
      if (desactivado) return;
      const t = tramos(b.ejercicios).findIndex(([a, z]) => i >= a && i <= z);
      const u = acc === 'ed-subir-grupo' ? t - 1 : t + 1;
      const offset = i - tramos(b.ejercicios)[t][0];
      moverTramoEnEditor(t, u);
      const j = tramos(b.ejercicios)[u][0] + offset;
      menuEjIdx = j;
      render();
      enfocar(`[data-acc="${acc}"][data-idx="${j}"]`, `[data-acc="ed-menu"][data-idx="${j}"]`);
      anunciarTramo(u);
    } else if (acc === 'ed-unir' || acc === 'ed-separar') {
      const r = acc === 'ed-unir' ? unirConSiguiente(b.ejercicios, i) : separarDeSiguiente(b.ejercicios, i);
      if (r.error) { anunciarEditor(r.error); return; }
      b.ejercicios = r.ejercicios;
      b.sucio = true;
      menuEjIdx = null;
      render();
      enfocar(`[data-acc="${acc === 'ed-unir' ? 'ed-separar' : 'ed-unir'}"][data-idx="${i}"]`, `[data-acc="ed-menu"][data-idx="${i}"]`);
      const g = b.ejercicios[i].grupo;
      anunciarEditor(acc === 'ed-unir'
        ? `Superserie ${letraGrupo(g)}: ${b.ejercicios.filter(x => x.grupo === g).map(x => x.nombre).join(' y ')}.`
        : `Separados: ${b.ejercicios[i].nombre} y ${b.ejercicios[i + 1].nombre}.`);
    } else if (acc === 'ed-quitar') {
      // Papelera a la vista en cada tarjeta (antes vivía escondida en ⋯). Un
      // toque quita; el error se arregla con «Deshacer», sin confirmar antes.
      const quitado = b.ejercicios[i]?.nombre;
      const antes = structuredClone(b.ejercicios);
      b.ejercicios = normalizarGrupos(b.ejercicios.filter((_, k) => k !== i));
      b.deshacer = { nombre: quitado, idx: i, antes, despues: JSON.stringify(b.ejercicios) };
      b.sucio = true;
      menuEjIdx = null;
      render();
      const aviso = b.deshacer;
      clearTimeout(relojDeshacer);
      relojDeshacer = setTimeout(() => {
        if (borrador?.deshacer !== aviso) return;
        delete borrador.deshacer;
        ctx.raiz.querySelector('.en-ed-deshacer')?.remove();
      }, 8000);
      // El foco no se pierde: va al ejercicio que ocupa su lugar (o a Agregar).
      enfocar(`[data-acc="ed-quitar"][data-idx="${Math.min(i, b.ejercicios.length - 1)}"]`, '[data-acc="ed-agregar"]');
      anunciarEditor(`${quitado} quitado. Puedes deshacerlo.`);
    } else if (acc === 'ed-deshacer') {
      const d = b.deshacer;
      // Las reps y el arrastre cambian la lista sin repintar: si pasó algo
      // después de quitar, el aviso caduca en vez de pisar ese cambio.
      if (!d || JSON.stringify(b.ejercicios) !== d.despues) { delete b.deshacer; wrap.querySelector('.en-ed-deshacer')?.remove(); return; }
      b.ejercicios = d.antes;
      delete b.deshacer;
      clearTimeout(relojDeshacer);
      render();
      enfocar(`[data-acc="ed-quitar"][data-idx="${d.idx}"]`, '[data-acc="ed-agregar"]');
      anunciarEditor(`${d.nombre} vuelve a la rutina.`);
    } else if (acc === 'ed-series') {
      if (desactivado) return;
      b.ejercicios[i] = limpiarEjercicioRutina({ ...b.ejercicios[i], series: b.ejercicios[i].series + (+btn.dataset.v) });
      b.sucio = true;
      render();
    } else if (acc === 'ed-tecnica') {
      hojaTecnica = { idx: i, serie: +btn.dataset.serie, todas: false, animar: true, planInicial: normalizarPlan(b.ejercicios[i].series, b.ejercicios[i].plan) };
      menuEjIdx = null;
      render();
      ctx.raiz.querySelector('.en-hoja input[name="en-tecnica"]:checked')?.focus();
    } else if (acc === 'ed-guardar') guardarBorrador(wrap);
  });
  wrap.addEventListener('keydown', teclaAsa);
  // Espacio activa los botones al soltar la tecla: en un asa ya actuó keydown.
  wrap.addEventListener('keyup', e => { if (e.key === ' ' && e.target.closest?.('.en-ed-asa')) e.preventDefault(); });
  // Si el foco sale del asa levantada (Tab, otro control), queda soltada donde está.
  wrap.addEventListener('focusout', e => {
    if (!asaLevantada || repintandoAsa) return;
    const lev = asaLevantada;
    const sigue = e.relatedTarget?.matches?.(lev.tipo === 'grupo'
      ? `[data-acc="ed-asa-grupo"][data-tramo="${lev.idx}"]` : `[data-acc="ed-asa"][data-idx="${lev.idx}"]`);
    if (!sigue) { soltarSinRepintar(); anunciarEditor('Soltado.'); }
  });
  wrap.addEventListener('pointerdown', empezarPresion);
  // Registrado ANTES de cualquier gesto y no pasivo: Safari de iPhone trata como
  // pasivos los listeners de touch añadidos a mitad del gesto, y sin esto el
  // arrastre se convertía en scroll. Solo bloquea mientras se arrastra.
  wrap.addEventListener('touchmove', e => { if (arrastrando) e.preventDefault(); }, { passive: false });
  // Mantener presionado no debe abrir el menú contextual del sistema (Android).
  wrap.addEventListener('contextmenu', e => { if (e.target.closest('.en-ed-item') && !e.target.closest('input')) e.preventDefault(); });
}

// ── Reordenar en el editor: teclado, menú y arrastre ─────────────────────────

function moverEnEditor(desde, hasta) {
  borrador.ejercicios = moverEjercicio(borrador.ejercicios, desde, hasta);
  borrador.sucio = true;
}

function moverTramoEnEditor(desde, hasta) {
  borrador.ejercicios = moverTramo(borrador.ejercicios, desde, hasta);
  borrador.sucio = true;
}

// Enfoca el primer selector que exista y no esté deshabilitado.
function enfocar(...selectores) {
  for (const sel of selectores) {
    const el = ctx.raiz.querySelector(sel);
    if (el && el.getAttribute('aria-disabled') !== 'true') { el.focus(); return; }
  }
}

// Suelta lo levantado con teclado sin repintar (el foco está en un campo).
function soltarSinRepintar() {
  if (!asaLevantada) return;
  asaLevantada = null;
  ctx.raiz.querySelectorAll('.en-ed-levantada').forEach(x => x.classList.remove('en-ed-levantada'));
  ctx.raiz.querySelectorAll('.en-ed-asa[aria-pressed="true"]').forEach(x => x.setAttribute('aria-pressed', 'false'));
}

// Un aviso para lectores de pantalla tras repintar: se escribe un instante
// después para que la región viva nueva lo anuncie.
function anunciarEditor(texto) {
  setTimeout(() => { const el = ctx.raiz.querySelector('#en-ed-anuncio'); if (el) el.textContent = texto; }, 60);
}

function anunciarPosicion(i, prefijo = '') {
  const ej = borrador?.ejercicios[i];
  if (ej) anunciarEditor(`${prefijo}${ej.nombre}, posición ${i + 1} de ${borrador.ejercicios.length}.`);
}

function anunciarPaso(r, prefijo = '') {
  const ej = borrador?.ejercicios[r.idx];
  if (!ej) return;
  if (r.cambio === 'salio') anunciarEditor(`${prefijo}${ej.nombre} sale de la superserie.`);
  else if (r.cambio === 'salto') anunciarEditor(`${prefijo}${ej.nombre} pasa la superserie, posición ${r.idx + 1} de ${borrador.ejercicios.length}.`);
  else anunciarPosicion(r.idx, prefijo);
}

function anunciarTramo(t, prefijo = '') {
  const ts = tramos(borrador?.ejercicios || []);
  const ej = borrador?.ejercicios[ts[t]?.[0]];
  if (!ej) return;
  const nombre = ej.grupo != null ? `Superserie ${letraGrupo(ej.grupo)}` : ej.nombre;
  anunciarEditor(`${prefijo}${nombre}, posición ${t + 1} de ${ts.length}.`);
}

// Teclado (patrón de arrastrar y soltar accesible): Enter o Espacio levanta,
// flechas mueven, Enter o Espacio suelta, Escape devuelve el orden como estaba.
// Con un ejercicio, cada flecha es un paso (pasoEjercicio: salta superseries
// ajenas). El asa de la cabecera mueve la superserie entera, tramo a tramo.
function teclaAsa(e) {
  const asa = e.target.closest?.('.en-ed-asa');
  if (!asa || !borrador) return;
  const grupo = asa.dataset.acc === 'ed-asa-grupo';
  const tipo = grupo ? 'grupo' : 'ej';
  const i = grupo ? +asa.dataset.tramo : +asa.dataset.idx;
  const total = grupo ? tramos(borrador.ejercicios).length : borrador.ejercicios.length;
  const repintarYEnfocar = (k, t = tipo) => {
    repintandoAsa = true;
    render();
    repintandoAsa = false;
    ctx.raiz.querySelector(t === 'grupo' ? `[data-acc="ed-asa-grupo"][data-tramo="${k}"]` : `[data-acc="ed-asa"][data-idx="${k}"]`)?.focus();
  };
  const decir = (k, pre, t = tipo) => t === 'grupo' ? anunciarTramo(k, pre) : anunciarPosicion(k, pre);
  const lev = asaLevantada;
  const esLaLevantada = lev && lev.tipo === tipo && lev.idx === i;
  const tecla = e.key;
  if (tecla === 'Enter' || tecla === ' ') {
    e.preventDefault();
    if (lev) {
      asaLevantada = null;
      repintarYEnfocar(lev.idx, lev.tipo);
      decir(lev.idx, 'Soltado. ', lev.tipo);
    } else {
      if (total < 2) return;
      asaLevantada = { tipo, idx: i, idxInicio: i, inicio: borrador.ejercicios.map(x => ({ ...x })), sucioAntes: !!borrador.sucio };
      menuEjIdx = null;
      repintarYEnfocar(i);
      decir(i, 'Levantado. Usa las flechas para moverlo. ');
    }
  } else if ((tecla === 'ArrowUp' || tecla === 'ArrowDown') && esLaLevantada) {
    e.preventDefault();
    const dir = tecla === 'ArrowUp' ? -1 : 1;
    if (grupo) {
      const j = i + dir;
      if (j < 0 || j >= total) return;
      moverTramoEnEditor(i, j);
      asaLevantada.idx = j;
      repintarYEnfocar(j);
      decir(j);
    } else {
      const r = pasoEjercicio(borrador.ejercicios, i, dir);
      if (!r.cambio) return;
      borrador.ejercicios = r.ejercicios;
      borrador.sucio = true;
      asaLevantada.idx = r.idx;
      repintarYEnfocar(r.idx);
      anunciarPaso(r);
    }
  } else if (tecla === 'Escape' && esLaLevantada) {
    e.preventDefault();
    const { inicio, sucioAntes, idxInicio } = lev;
    borrador.ejercicios = inicio;
    borrador.sucio = sucioAntes;
    asaLevantada = null;
    repintarYEnfocar(idxInicio);
    decir(idxInicio, 'Cancelado. ');
  }
}

// Arrastre con el dedo o el ratón (Pointer Events, sin librerías). Desde un
// asa empieza al mover; desde la tarjeta (o la cabecera de una superserie),
// tras mantenerla presionada 400 ms sin moverse más de 8 px (si se mueve
// antes, era scroll). Mientras se arrastra solo se anima transform.
const PRESION_MS = 400, UMBRAL_PX = 8, BORDE_AUTOSCROLL = 90, ALTO_TABBAR = 64;

function empezarPresion(e) {
  if (e.button !== 0 || !borrador || borrador.ejercicios.length < 2 || arrastrando) return;
  const li = e.target.closest('.en-ed-item');
  if (!li) return;
  const asa = e.target.closest('.en-ed-asa');
  const enCabecera = !!e.target.closest('.en-ed-grupo-cab');
  if (!asa && e.target.closest('button, input, .en-ed-menu, .en-ed-enlace')) return;
  const grupo = asa ? asa.dataset.acc === 'ed-asa-grupo' : enCabecera;
  const idx = +li.dataset.idx;
  const ts = tramos(borrador.ejercicios);
  if (grupo && ts.length < 2) return;
  const u = grupo ? ts.findIndex(([a, z]) => idx >= a && idx <= z) : idx;
  const p = { grupo, u, li, id: e.pointerId, x0: e.clientX, y0: e.clientY, ultimoY: e.clientY, timer: null };
  const limpiar = () => {
    clearTimeout(p.timer);
    document.removeEventListener('pointermove', mover);
    document.removeEventListener('pointerup', limpiar);
    document.removeEventListener('pointercancel', limpiar);
  };
  // Si la pantalla se repintó mientras se mantenía presionado (otro toque,
  // un render), esa presión ya no vale: nunca levanta otra tarjeta.
  const vigente = () => !!borrador && p.li.isConnected && !arrastrando;
  const mover = ev => {
    if (ev.pointerId !== p.id) return;
    p.ultimoY = ev.clientY;
    if (Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0) <= (asa ? 3 : UMBRAL_PX)) return;
    limpiar();
    if (asa && vigente()) iniciarArrastre(p, ev.clientY);   // desde la tarjeta, moverse antes de tiempo = scroll
  };
  document.addEventListener('pointermove', mover);
  document.addEventListener('pointerup', limpiar);
  document.addEventListener('pointercancel', limpiar);
  if (!asa) p.timer = setTimeout(() => { limpiar(); if (vigente()) iniciarArrastre(p, p.ultimoY); }, PRESION_MS);
}

function iniciarArrastre(p, clientY) {
  const items = [...ctx.raiz.querySelectorAll('.en-ed-item')];
  const ol = ctx.raiz.querySelector('.en-ed-lista');
  // Unidades que se mueven: cada ejercicio, o cada tramo si se arrastra una
  // superserie entera (así nunca cae dentro de otra).
  const rangos = p.grupo ? tramos(borrador.ejercicios) : items.map((_, k) => [k, k]);
  const unidades = rangos.map(([a, z]) => items.slice(a, z + 1));
  if (!unidades[p.u]?.length) return;
  const desdeScroll = window.scrollY;
  const cajas = unidades.map(us => {
    const r1 = us[0].getBoundingClientRect(), r2 = us[us.length - 1].getBoundingClientRect();
    return { top: r1.top + desdeScroll, alto: r2.bottom - r1.top };
  });
  const centroDe = c => c.top + c.alto / 2;
  const c0 = cajas[p.u], ultima = cajas[cajas.length - 1];
  // Lo que ocupa la unidad levantada (con su hueco): lo que se apartan las demás.
  const paso = p.u + 1 < cajas.length ? cajas[p.u + 1].top - c0.top : c0.alto + (p.u > 0 ? c0.top - (cajas[p.u - 1].top + cajas[p.u - 1].alto) : 0);
  // Límites: la unidad no sale de la zona de la lista y la página no se
  // desplaza más allá de su final real (si no, la tarjeta movida alargaba la
  // página y el autoscroll no paraba nunca).
  const minDy = Math.min(cajas[0].top - c0.top, centroDe(cajas[0]) - centroDe(c0));
  const maxDy = Math.max(ultima.top + ultima.alto - c0.alto - c0.top, centroDe(ultima) - centroDe(c0));
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  // El autoscroll solo se arma cuando el dedo se mueve de verdad: levantar
  // una tarjeta que ya está cerca del borde no debe desplazar nada sola.
  const a = { y0Pagina: p.y0 + desdeScroll, yInicio: clientY, hasta: p.u, yCliente: clientY, raf: 0, armado: false };
  menuEjIdx = null;
  arrastrando = true;
  ol?.classList.add('en-ed-lista-arrastre');
  unidades[p.u].forEach(el => el.classList.add('en-ed-arrastrando'));
  unidades.forEach((us, k) => { if (k !== p.u) us.forEach(el => el.classList.add('en-ed-desplazable')); });
  navigator.vibrate?.(12);   // Android; Safari de iPhone no vibra desde la web
  const pintar = () => {
    const dy = Math.min(maxDy, Math.max(minDy, a.yCliente + window.scrollY - a.y0Pagina));
    unidades[p.u].forEach(el => { el.style.transform = `translateY(${dy}px) scale(1.02)`; });
    // Cuenta el borde que va delante: bajando, el de abajo; subiendo, el de
    // arriba. Así una superserie alta cambia de sitio con su vecino al cubrir
    // la mitad de ese vecino, no la mitad de sí misma.
    let hasta = p.u;
    if (dy > 0) {
      const borde = c0.top + c0.alto + dy;
      for (let k = p.u + 1; k < cajas.length; k++) if (borde >= centroDe(cajas[k])) hasta = k;
    } else if (dy < 0) {
      const borde = c0.top + dy;
      for (let k = p.u - 1; k >= 0; k--) if (borde <= centroDe(cajas[k])) hasta = k;
    }
    a.hasta = hasta;
    unidades.forEach((us, k) => {
      if (k === p.u) return;
      const t = p.u < hasta && k > p.u && k <= hasta ? -paso : hasta < p.u && k >= hasta && k < p.u ? paso : 0;
      us.forEach(el => { el.style.transform = t ? `translateY(${t}px)` : ''; });
    });
  };
  // Cerca de los bordes (o de la tabbar) la página se desplaza sola. La zona
  // se achica en pantallas bajas (12 % del alto como máximo).
  const autoscroll = () => {
    const zona = Math.min(BORDE_AUTOSCROLL, Math.round(window.innerHeight * 0.12));
    const abajo = window.innerHeight - zona - ALTO_TABBAR;
    let v = !a.armado ? 0
      : a.yCliente < zona ? -Math.ceil((zona - a.yCliente) / 6)
      : a.yCliente > abajo ? Math.ceil((a.yCliente - abajo) / 6) : 0;
    if ((v > 0 && window.scrollY >= maxScroll) || (v < 0 && window.scrollY <= 0)) v = 0;
    if (v) { window.scrollTo(0, Math.min(maxScroll, Math.max(0, window.scrollY + v))); pintar(); }
    a.raf = requestAnimationFrame(autoscroll);
  };
  const mover = ev => {
    if (ev.pointerId !== p.id) return;
    a.yCliente = ev.clientY;
    if (Math.abs(ev.clientY - a.yInicio) > UMBRAL_PX) a.armado = true;
    pintar();
  };
  const terminar = (aplicar) => {
    cancelAnimationFrame(a.raf);
    document.removeEventListener('pointermove', mover);
    document.removeEventListener('pointerup', soltar);
    document.removeEventListener('pointercancel', cancelar);
    document.removeEventListener('keydown', escape, true);
    arrastrando = false;
    finArrastreMs = Date.now();
    // El navegador sintetiza un click al soltar y lo manda a lo que quede bajo
    // el dedo (p. ej. «Unir en superserie»): ese click no debe hacer nada.
    const tragarClick = ev => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', tragarClick, true);
    setTimeout(() => document.removeEventListener('click', tragarClick, true), 500);
    ol?.classList.remove('en-ed-lista-arrastre');
    items.forEach(el => { el.style.transform = ''; el.classList.remove('en-ed-desplazable', 'en-ed-arrastrando'); });
    if (aplicar && a.hasta !== p.u) {
      if (p.grupo) moverTramoEnEditor(p.u, a.hasta); else moverEnEditor(p.u, a.hasta);
      render();
      if (p.grupo) anunciarTramo(a.hasta, 'Movida. '); else anunciarPosicion(a.hasta, 'Movido. ');
    }
  };
  const soltar = ev => { if (ev.pointerId === p.id) terminar(true); };
  const cancelar = ev => { if (ev.pointerId === p.id) terminar(false); };
  const escape = ev => { if (ev.key === 'Escape') { ev.preventDefault(); terminar(false); } };
  document.addEventListener('pointermove', mover);
  document.addEventListener('pointerup', soltar);
  document.addEventListener('pointercancel', cancelar);
  document.addEventListener('keydown', escape, true);
  pintar();
  a.raf = requestAnimationFrame(autoscroll);
}

// ── Hoja inferior: técnica de una serie ─────────────────────────────────────
// Diálogo modal: el editor queda inerte detrás, el foco no sale de la hoja,
// Escape, la X, «Listo» o tocar fuera la cierran, y el foco vuelve a la
// píldora. Los cambios se aplican en el acto: cerrar nunca pierde nada.

function htmlHojaTecnica() {
  const { idx, serie, todas } = hojaTecnica;
  const ej = borrador.ejercicios[idx];
  const t = normalizarPlan(ej.series, ej.plan)[serie];
  const opciones = Object.entries(TECNICAS).map(([k, T]) => {
    const on = t.tipo === k;
    const params = on && PARAMS_TECNICA[k] ? `
      <div class="en-hoja-params">${Object.entries(PARAMS_TECNICA[k]).map(([pk, r]) => `
        <div class="en-hoja-param">
          <span class="en-ed-lbl" id="en-hp-${pk}">${r.nombre}</span>
          <div class="en-ed-step" role="group" aria-labelledby="en-hp-${pk}">
            <button type="button" class="en-d-aj" data-acc="hoja-param" data-campo="${pk}" data-v="-1" aria-label="${r.nombre}: menos"${t[pk] <= r.min ? ' aria-disabled="true"' : ''}>−</button>
            <output class="en-ed-val en-hoja-val" aria-live="polite">${t[pk]}${r.unidad ? ` ${r.unidad}` : ''}</output>
            <button type="button" class="en-d-aj" data-acc="hoja-param" data-campo="${pk}" data-v="1" aria-label="${r.nombre}: más"${t[pk] >= r.max ? ' aria-disabled="true"' : ''}>+</button>
          </div>
        </div>`).join('')}
      </div>` : '';
    return `
      <label class="en-hoja-op${on ? ' en-hoja-op-on' : ''}" for="en-tec-${k}">
        <input type="radio" name="en-tecnica" id="en-tec-${k}" value="${k}"${on ? ' checked' : ''}>
        <span class="en-hoja-op-txt">
          <span class="en-hoja-op-nom">${T.nombre}${T.insignia ? ` <span class="en-ed-etq">${T.insignia}</span>` : ''}</span>
          <span class="en-hoja-op-desc">${T.descripcion}</span>
        </span>
      </label>${params}`;
  }).join('');
  return `
  <div class="en-hoja-fondo" data-acc="hoja-cerrar"></div>
  <div class="en-hoja${hojaTecnica.animar ? ' en-hoja-anim' : ''}" role="dialog" aria-modal="true" aria-labelledby="en-hoja-tit" aria-describedby="en-hoja-sub" tabindex="-1">
    <div class="en-hoja-cab">
      <div>
        <h3 class="en-hoja-tit" id="en-hoja-tit">Serie ${serie + 1}</h3>
        <p class="en-hoja-sub" id="en-hoja-sub">${esc(ej.nombre)}</p>
      </div>
      <button type="button" class="en-ed-mas" data-acc="hoja-cerrar" aria-label="Cerrar">${SVG_CERRAR}</button>
    </div>
    <fieldset class="en-hoja-ops">
      <legend class="en-sr">Técnica de la serie ${serie + 1}</legend>
      ${opciones}
    </fieldset>
    ${ej.series > 1 ? `<label class="en-hoja-todas" for="en-hoja-todas">
      <input type="checkbox" id="en-hoja-todas"${todas ? ' checked' : ''}> Aplicar a todas las series
    </label>` : ''}
    <p class="en-sr" id="en-hoja-anuncio" role="status"></p>
    <button type="button" class="en-btn en-btn-main en-hoja-listo" data-acc="hoja-cerrar" id="en-hoja-listo">Listo</button>
  </div>`;
}

// Aplica un cambio a la serie abierta, o a todas si está marcada la casilla.
function aplicarTecnica(cambio) {
  const { idx, serie, todas } = hojaTecnica;
  const ej = borrador.ejercicios[idx];
  const plan = normalizarPlan(ej.series, ej.plan);
  const base = limpiarTecnica(cambio(plan[serie]));
  borrador.ejercicios[idx] = { ...ej, plan: plan.map((t, j) => j === serie || todas ? { ...base } : t) };
  borrador.sucio = true;
}

// Aviso dentro de la hoja (el del editor queda detrás, inerte).
function anunciarHoja(texto) {
  setTimeout(() => { const el = ctx.raiz.querySelector('#en-hoja-anuncio'); if (el) el.textContent = texto; }, 60);
}

// Con la hoja abierta, lo de fuera del módulo (cabecera y tabbar) también queda inerte.
function inertesFuera(on) {
  document.querySelectorAll('.app > .header, .tabbar').forEach(el => el.toggleAttribute('inert', on));
}

function cerrarHojaTecnica() {
  const { idx, serie } = hojaTecnica;
  hojaTecnica = null;
  inertesFuera(false);
  render();
  enfocar(`[data-acc="ed-tecnica"][data-idx="${idx}"][data-serie="${serie}"]`);
  const t = normalizarPlan(borrador.ejercicios[idx].series, borrador.ejercicios[idx].plan)[serie];
  anunciarEditor(`Serie ${serie + 1}: ${TECNICAS[t.tipo].nombre}.`);
}

// Repinta conservando el desplazamiento de la hoja: sin esto cada toque en
// − o + la devolvía arriba y el siguiente toque caía en otra opción.
function repintarHoja() {
  const y = ctx.raiz.querySelector('.en-hoja')?.scrollTop ?? 0;
  render();
  const h = ctx.raiz.querySelector('.en-hoja');
  if (h) h.scrollTop = y;
}

function conectarHojaTecnica(raiz) {
  const hoja = raiz.querySelector('.en-hoja');
  hojaTecnica.animar = false;   // la entrada se anima una sola vez, al abrir
  inertesFuera(true);
  // Deslizar la cabecera hacia abajo cierra la hoja (gesto estándar de iOS);
  // la X, «Listo», el fondo y Escape siguen ahí.
  const cab = hoja.querySelector('.en-hoja-cab');
  cab.addEventListener('pointerdown', ev => {
    if (ev.target.closest('button')) return;
    const y0 = ev.clientY;
    let dy = 0;
    const mover = e2 => { dy = Math.max(0, e2.clientY - y0); hoja.style.transform = dy ? `translateY(${dy}px)` : ''; };
    const soltar = () => {
      document.removeEventListener('pointermove', mover);
      document.removeEventListener('pointerup', soltar);
      document.removeEventListener('pointercancel', soltar);
      if (dy > 80) cerrarHojaTecnica(); else hoja.style.transform = '';
    };
    document.addEventListener('pointermove', mover);
    document.addEventListener('pointerup', soltar);
    document.addEventListener('pointercancel', soltar);
  });
  // Escape cierra aunque el foco haya caído fuera de la hoja (tocar un área
  // vacía lo manda a <body>): un solo listener de documento, instalado una vez.
  if (!escapeHojaInstalado) {
    escapeHojaInstalado = true;
    document.addEventListener('keydown', e => {
      if (hojaTecnica && e.key === 'Escape' && !e.target.closest?.('.en-hoja')) { e.preventDefault(); cerrarHojaTecnica(); }
    });
  }
  raiz.querySelector('.en-hoja-fondo').addEventListener('click', cerrarHojaTecnica);
  hoja.addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    if (b.dataset.acc === 'hoja-cerrar') { cerrarHojaTecnica(); return; }
    if (b.dataset.acc === 'hoja-param') {
      if (b.getAttribute('aria-disabled') === 'true') return;
      const pk = b.dataset.campo;
      const tipo = normalizarPlan(borrador.ejercicios[hojaTecnica.idx].series, borrador.ejercicios[hojaTecnica.idx].plan)[hojaTecnica.serie].tipo;
      const r = PARAMS_TECNICA[tipo]?.[pk];
      aplicarTecnica(t => ({ ...t, [pk]: t[pk] + (+b.dataset.v) * (r?.paso ?? 1) }));
      repintarHoja();
      const t2 = normalizarPlan(borrador.ejercicios[hojaTecnica.idx].series, borrador.ejercicios[hojaTecnica.idx].plan)[hojaTecnica.serie];
      anunciarHoja(`${r?.nombre}: ${t2[pk]}${r?.unidad ? ' ' + (r.unidad === 's' ? 'segundos' : 'por ciento') : ''}.`);
    }
  });
  hoja.addEventListener('change', e => {
    if (e.target.name === 'en-tecnica') {
      const v = e.target.value;
      aplicarTecnica(t => t.tipo === v ? t : { tipo: v });
      repintarHoja();
      anunciarHoja(`${TECNICAS[v].nombre}${hojaTecnica.todas ? ', en todas las series' : ''}.`);
    } else if (e.target.id === 'en-hoja-todas') {
      hojaTecnica.todas = e.target.checked;
      if (hojaTecnica.todas) {
        aplicarTecnica(t => t);   // la técnica de esta serie pasa a todas
      } else {
        // Desmarcar devuelve las demás series a como estaban al abrir la hoja.
        const { idx, serie, planInicial } = hojaTecnica;
        const ej = borrador.ejercicios[idx];
        const plan = normalizarPlan(ej.series, ej.plan);
        borrador.ejercicios[idx] = { ...ej, plan: plan.map((t, j) => j === serie ? t : (planInicial?.[j] ?? t)) };
      }
      repintarHoja();
      anunciarHoja(hojaTecnica.todas ? 'Se aplica a todas las series.' : 'Solo a esta serie.');
    }
  });
  // Escape cierra; Tab no sale de la hoja (el editor de detrás está inerte).
  hoja.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); cerrarHojaTecnica(); return; }
    if (e.key !== 'Tab') return;
    const focos = [...hoja.querySelectorAll('button:not([aria-disabled="true"]), input')].filter(x => !(x.type === 'radio' && !x.checked));
    if (!focos.length) return;
    const primero = focos[0], ultimo = focos[focos.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  });
}

function guardarBorrador(wrap) {
  const { ok, errores } = validarBorrador(borrador);
  erroresBorrador = errores;
  if (!ok) {
    render();
    // El foco va al primer campo con error (WCAG 3.3.1): el nombre o el botón
    // de agregar, que lleva el mensaje en su aria-describedby.
    ctx.raiz.querySelector(errores.nombre ? '#en-ed-nombre' : '[data-acc="ed-agregar"]')?.focus();
    return;
  }
  // Editar reemplaza la misma rutina (mismo id, mismo sitio en la lista).
  const editando = !!borrador.original;
  const rutina = rutinaDesdeBorrador(borrador, 'R-' + Date.now());
  const guardada = escribir(e => almacen.guardarRutina(e, rutina));
  if (!guardada) { wrap.querySelector('.en-aviso-storage').hidden = false; return; }
  borrador = null;
  erroresBorrador = {};
  menuEjIdx = null;
  asaLevantada = null;
  hojaTecnica = null;
  subtab = 'rutinas';
  rutinaAbiertaId = String(rutina.id);
  avisoRutina = editando ? 'Cambios guardados.' : 'Rutina guardada en Tus rutinas.';
  render();
  window.scrollTo(0, 0);
}

function agregarEjercicioARutina(id, nombre) {
  borrador.ejercicios.push(ejercicioDeRutina(id, nombre));
  borrador.sucio = true;
  if (erroresBorrador.ejercicios) delete erroresBorrador.ejercicios;
  modoBiblioteca = null;
  render();
  // El ejercicio recién agregado queda a la vista (no al fondo de la página),
  // con el foco en su «⋯» y un aviso para lectores de pantalla.
  const k = borrador.ejercicios.length - 1;
  ctx.raiz.querySelector(`.en-ed-item[data-idx="${k}"]`)?.scrollIntoView({ block: 'center' });
  ctx.raiz.querySelector(`[data-acc="ed-menu"][data-idx="${k}"]`)?.focus({ preventScroll: true });
  anunciarEditor(`${nombre} agregado, posición ${k + 1} de ${k + 1}.`);
}

// ── Biblioteca (pestaña y overlay "agregar a la sesión") ─────────────────────

// Tope de maestros pintados: pintar 876 botones por tecla congelaba teléfonos
// medios (long tasks de 65–117 ms medidos) y, con foto por fila, bajaba los
// JPG completos del CDN (~64 KB cada uno). La lista corta + "sigue
// escribiendo" es más rápida Y más usable que un rollo infinito.
const CAP_MAESTROS = 60;
// Un grupo con muchas variantes enseña las primeras (las más usadas) y un
// «+N más»: 17 etiquetas juntas eran justo la sopa que se quería evitar.
const VARIANTES_VISIBLES = 6;

// destino: null (pestaña Biblioteca), 'sesion' o 'rutina' (overlay que agrega
// el ejercicio a la sesión viva o a la rutina del editor).
function pintarBiblioteca(cont, destino) {
  const overlay = destino === 'sesion' || destino === 'rutina';
  const enSesion = destino === 'sesion';
  // La Biblioteca es lo esencial: tras un fallo reintenta en cuanto se vuelve
  // a abrir (los 3 s solo evitan el bucle con el repintado que sigue al fallo).
  if (faltaCatalogo(3000)) {
    // Solo repinta si sigue en la Biblioteca: si ya volvió al editor, un
    // repintado borraría las reps a medio escribir.
    cargarCatalogo().then(() => { if (destino ? modoBiblioteca === destino : subtab === 'biblioteca' && !modoBiblioteca) render(); });
  }
  if (overlay) {
    // En overlay la biblioteca ocupa la raíz entera, con vuelta a la sesión.
    // La barra de descanso viaja con ella: un descanso corriendo no se
    // esconde porque el usuario fue a buscar el siguiente ejercicio.
    cont.innerHTML = `
    <div class="en-wrap">
      <button type="button" class="en-volver" data-acc="volver">${SVG_VOLVER}<span>${enSesion ? 'Volver a la sesión' : 'Volver a la rutina'}</span></button>
      <h2 class="en-titulo">Agregar ejercicio</h2>
      <div class="en-panel"></div>
    </div>${enSesion ? htmlBarraDescanso() : ''}`;
    cont.querySelector('[data-acc="volver"]').addEventListener('click', () => {
      modoBiblioteca = null;
      panelFiltros = false;
      render();
    });
    if (enSesion) conectarBarraDescanso(cont);
    cont = cont.querySelector('.en-panel');
  }

  const listo = catEstado === 'listo';
  const res = datosBiblioteca();
  const nf = cuentaFiltros(filtrosBib);
  cont.innerHTML = `
    <div class="en-busca">
      ${SVG_LUPA}
      <input type="search" id="en-busca-in" class="en-busca-in" placeholder="Buscar ejercicio"
        value="${esc(consultaBib)}" aria-label="Buscar ejercicio">
      ${listo ? `<button type="button" class="en-filtros-btn${nf ? ' en-filtros-btn-on' : ''}" data-acc="filtros"
        aria-expanded="${panelFiltros}" aria-controls="en-fpanel">${SVG_FILTROS}<span>${textoBotonFiltros(nf)}</span></button>` : ''}
    </div>
    ${listo ? htmlFiltrosActivos() + htmlPanelFiltros(res) : ''}
    <p class="en-sr en-busca-estado" role="status" aria-live="polite"></p>
    ${htmlResultadosBiblioteca(destino, res)}`;

  const input = cont.querySelector('.en-busca-in');
  input.addEventListener('input', () => {
    consultaBib = input.value;
    // Búsqueda nueva, estado nuevo: lo que abriste o cerraste a mano en otra
    // búsqueda no debe esconder el mejor resultado de esta.
    abiertosBib = new Map();
    // Debounce de 160 ms: re-filtrar y re-pintar POR TECLA daba long tasks
    // de >100 ms en CPU de teléfono. Solo se repinta la lista: repintar
    // todo robaría el foco del buscador.
    clearTimeout(input._t);
    input._t = setTimeout(() => actualizarBiblioteca(cont, destino), 160);
  });
  // Casillas: dentro de un filtro suman, entre filtros se combinan. Cada
  // cambio repinta la lista al momento y el panel se queda abierto.
  cont.addEventListener('change', e => {
    const c = e.target.closest('input[type="checkbox"][data-f]');
    if (!c) return;
    marcarFiltro(filtrosBib, c.dataset.f, c.value, c.checked);
    actualizarBiblioteca(cont, destino);
  });
  cont.addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    const acc = b.dataset.acc;
    if (acc === 'ej') elegirEjercicio(b.dataset.id, destino);
    else if (acc === 'libre') elegirLibre(destino);
    else if (acc === 'reintentar-cat') {
      // A mano, sin esperar: la señal pudo volver hace un segundo.
      cargarCatalogo().then(() => { if (destino ? modoBiblioteca === destino : subtab === 'biblioteca' && !modoBiblioteca) render(); });
      render();
    }
    else if (acc === 'maestro') {
      const clave = b.dataset.clave;
      abiertosBib.set(clave, b.getAttribute('aria-expanded') !== 'true');
      actualizarBiblioteca(cont, destino);
      cont.querySelector(`[data-acc="maestro"][data-clave="${CSS.escape(clave)}"]`)?.focus({ preventScroll: true });
    } else if (acc === 'var-mas') {
      const k = b.dataset.k;
      masBib.add(k);
      actualizarBiblioteca(cont, destino);
      // El foco cae en la primera variante que estaba escondida.
      cont.querySelector(`.en-var-grupo[data-k="${CSS.escape(k)}"]`)
        ?.querySelectorAll('.en-var')[VARIANTES_VISIBLES]?.focus({ preventScroll: true });
    } else if (acc === 'filtros') {
      panelFiltros = !panelFiltros;
      b.setAttribute('aria-expanded', String(panelFiltros));
      cont.querySelector('.en-fpanel').hidden = !panelFiltros;
      cont.querySelector('.en-factivos')?.replaceWith(htmlANodo(htmlFiltrosActivos()));
    } else if (acc === 'filtros-ver') {
      panelFiltros = false;
      cont.querySelector('.en-fpanel').hidden = true;
      cont.querySelector('.en-factivos')?.replaceWith(htmlANodo(htmlFiltrosActivos()));
      const fb = cont.querySelector('[data-acc="filtros"]');
      fb.setAttribute('aria-expanded', 'false');
      // El buscador queda arriba de la pantalla, con el botón Filtros (que
      // recibe el foco) a la vista y los resultados justo debajo.
      cont.querySelector('.en-busca')?.scrollIntoView({ block: 'start' });
      fb.focus({ preventScroll: true });
    } else if (acc === 'quitar-filtro') {
      const todas = [...cont.querySelectorAll('[data-acc="quitar-filtro"]')];
      const i = todas.indexOf(b);
      quitarFiltro(filtrosBib, b.dataset.f, b.dataset.v);
      actualizarBiblioteca(cont, destino);
      // El foco pasa a la etiqueta que quedó en su lugar, o al botón Filtros.
      const quedan = cont.querySelectorAll('[data-acc="quitar-filtro"]');
      (quedan[Math.min(i, quedan.length - 1)] || cont.querySelector('[data-acc="filtros"]'))?.focus({ preventScroll: true });
    } else if (acc === 'limpiar-filtros') {
      const enPanel = !!b.closest('.en-fpanel');
      filtrosBib = filtrosVacios();
      actualizarBiblioteca(cont, destino);
      // Desde el pie del panel el foco se queda ahí («Limpiar» se deshabilita
      // y el botón Filtros puede estar muy arriba, fuera de la pantalla).
      cont.querySelector(enPanel ? '.en-fver' : '[data-acc="filtros"]')?.focus({ preventScroll: true });
    }
  });
  if (enSesion) {
    pintarDescanso();
    arrancarReloj();
  }
}

function datosBiblioteca() {
  return catEstado === 'listo' ? buscarMaestros(maestrosCat, consultaBib, filtrosBib) : [];
}

function textoBotonFiltros(nf) { return nf ? `Filtros (${nf})` : 'Filtros'; }

function textoEjercicios(n) { return `${n} ${n === 1 ? 'ejercicio' : 'ejercicios'}`; }

// Etiquetas de lo marcado, arriba de la lista: se ve qué filtra y se quita
// con un toque sin abrir el panel. Siempre existe el contenedor (vacío y
// oculto si no hay nada) para poder reemplazarlo al actualizar. Con el panel
// abierto se esconden: cada fila nueva de etiquetas empujaba las casillas
// hacia abajo y el siguiente toque caía en otra (las casillas ya dicen qué
// está marcado).
function htmlFiltrosActivos() {
  // Una zona afinada se ve por sus partes («Bíceps»), no como «Brazos».
  const activos = ZONAS.filter(z => filtrosBib.musculo.has(z.v)).flatMap(z => {
    const finas = partesMarcadas(filtrosBib, z.v);
    return finas.length ? finas.map(p => ({ f: 'parte', v: p, txt: nombreParte(p) })) : [{ f: 'musculo', v: z.v, txt: z.v }];
  }).concat(['equipo', 'tipo', 'nivel'].flatMap(f =>
    OPCIONES_FILTRO[f].filter(v => filtrosBib[f].has(v)).map(v => ({ f, v, txt: v }))));
  if (!activos.length) return '<div class="en-factivos" hidden></div>';
  return `<div class="en-factivos"${panelFiltros ? ' hidden' : ''}>${activos.map(({ f, v, txt }) => `
    <button type="button" class="en-fchip" data-acc="quitar-filtro" data-f="${f}" data-v="${esc(v)}"
      aria-label="${esc(capital(txt))}, quitar filtro"><span>${esc(capital(txt))}</span>${SVG_CERRAR}</button>`).join('')}
    <button type="button" class="en-flimpiar" data-acc="limpiar-filtros">Limpiar</button></div>`;
}

function htmlCasilla(f, v, txt) {
  return `
          <label class="en-fcasilla"><input type="checkbox" data-f="${f}" data-v="${esc(v)}" value="${esc(v)}"${
            filtrosBib[f].has(v) ? ' checked' : ''}><span>${esc(capital(txt))}</span></label>`;
}

// «Afinar»: debajo de las zonas, una fila por cada zona marcada que tiene
// partes. Es opcional y lo dice: sin tocarla, la zona trae todo. Va DEBAJO de
// las zonas para que aparecer no mueva la casilla que se acaba de tocar.
function htmlAfinar() {
  const zs = zonasParaAfinar(filtrosBib);
  return `<div class="en-fafinar" data-zonas="${esc(zs.join('|'))}"${zs.length ? '' : ' hidden'}>${zs.map(v => `
        <fieldset class="en-fsub">
          <legend class="en-fsub-lbl">Afinar ${esc(v)} <span>(opcional)</span></legend>
          <div class="en-fopc">${ZONAS.find(z => z.v === v).partes.map(p => htmlCasilla('parte', p, nombreParte(p))).join('')}
          </div>
        </fieldset>`).join('')}
      </div>`;
}

function htmlPanelFiltros(res) {
  const nf = cuentaFiltros(filtrosBib);
  return `
    <div class="en-fpanel" id="en-fpanel"${panelFiltros ? '' : ' hidden'}>
      ${Object.keys(OPCIONES_FILTRO).map(f => `
      <fieldset class="en-fgrupo">
        <legend class="en-flegend">${NOMBRES_FILTRO[f]}</legend>
        <div class="en-fopc">${OPCIONES_FILTRO[f].map(v => htmlCasilla(f, v, v)).join('')}
        </div>
        ${f === 'musculo' ? htmlAfinar() : ''}
      </fieldset>`).join('')}
      <div class="en-fpie">
        <button type="button" class="en-btn en-btn-ghost" data-acc="limpiar-filtros"${nf ? '' : ' disabled'}>Limpiar</button>
        <button type="button" class="en-btn en-btn-main en-fver" data-acc="filtros-ver">${textoVer(res)}</button>
      </div>
    </div>`;
}

function textoVer(res) {
  const n = res.reduce((s, r) => s + r.n, 0);
  return n ? `Ver ${textoEjercicios(n)}` : 'Sin resultados';
}

function htmlResultadosBiblioteca(destino, res) {
  const overlay = destino === 'sesion' || destino === 'rutina';
  if (catEstado === 'cargando' || catEstado === 'nada') return '<div class="en-busca-res"><p class="en-vacio">Cargando ejercicios…</p></div>';
  const q = consultaBib.trim();
  if (catEstado === 'fallo' || !catalogo.length) {
    return `<div class="en-busca-res"><p class="en-vacio">La biblioteca no está disponible por ahora. Puedes escribir el nombre de tu ejercicio y registrarlo igual.</p>
      <button type="button" class="en-btn en-btn-ghost en-reintentar" data-acc="reintentar-cat">Reintentar</button>${htmlLibre(q)}</div>`;
  }
  const filtrando = !!(q || cuentaFiltros(filtrosBib));
  const total = res.reduce((s, r) => s + r.n, 0);
  const lista = res.slice(0, CAP_MAESTROS);
  // Con pocos resultados los maestros se abren solos, y al escribir se abre
  // siempre el primero: buscar «press militar» y tener que tocar otra vez
  // para ver las variantes sería un paso de más.
  const pocos = filtrando && res.filter(r => r.m.n > 1).length <= 3;
  const primero = q ? res.find(r => r.m.n > 1)?.m.clave : null;
  const recientes = !filtrando
    ? estado.recientes.ejercicios.map(id => porId.get(id)).filter(Boolean).slice(0, 5)
    : [];
  const accion = overlay ? 'Agregar' : 'Ver';
  return `<div class="en-busca-res">
    ${recientes.length ? `<div class="en-sec-lbl">Recientes</div>${recientes.map(e => htmlFilaEjercicio(e, accion)).join('')}` : ''}
    <div class="en-sec-lbl">${filtrando ? textoEjercicios(total) : 'Todos · los más usados primero'}</div>
    ${lista.length ? lista.map(r => htmlMaestro(r, overlay, accion, pocos || r.m.clave === primero)).join('')
      : `<p class="en-vacio">${q ? `Nada con «${esc(q)}»` : 'Nada con esos filtros'}.</p>${htmlLibre(q)}`}
    ${res.length > lista.length ? `<p class="en-vacio">Mostrando ${CAP_MAESTROS} de ${res.length} grupos. Sigue escribiendo o usa Filtros para afinar.</p>` : ''}
  </div>`;
}

// Foto en cada fila, perezosa: con el tope de filas y loading="lazy" solo
// bajan las que entran en pantalla (el CDN sirve los JPG completos, así que
// sin tope ni lazy recorrer la lista costaba ~55 MB).
function htmlFoto(e) {
  return `<span class="en-thumb">${e.imagenes?.[0] ? `<img loading="lazy" src="${esc(URL_IMG + e.imagenes[0])}" alt="">` : ''}</span>`;
}

function htmlFilaEjercicio(e, accion) {
  return `
    <button type="button" class="en-ej-row" data-acc="ej" data-id="${esc(e.id)}">
      ${htmlFoto(e)}
      <span class="en-ej-row-txt">
        <span class="en-ej-row-nombre">${esc(e.nombre)}</span>
        <span class="en-ej-row-sub">${esc([capital(e.musculosPrimarios?.[0]), e.equipo].filter(Boolean).join(' · '))}</span>
      </span>
      <span class="en-ej-row-acc">${accion}</span>
    </button>`;
}

// Un maestro con una sola variante es una fila normal. Con varias, la fila
// se despliega ahí mismo y enseña sus grupos (ángulo o tipo) con las
// variantes como etiquetas; tocar una etiqueta es elegir ese ejercicio.
function htmlMaestro(r, overlay, accion, auto) {
  if (r.m.n === 1) return htmlFilaEjercicio(r.grupos[0].variantes[0].e, accion);
  const abierto = abiertosBib.has(r.m.clave) ? abiertosBib.get(r.m.clave) : auto;
  const top = r.grupos[0].variantes[0].e;
  const cuantas = r.n === r.m.n ? `${r.n} variantes` : `${r.n} de ${r.m.n} variantes`;
  const id = 'en-var-' + r.m.clave.replace(/[^a-z0-9]+/g, '-');
  return `
    <div class="en-maestro${abierto ? ' en-maestro-on' : ''}">
      <button type="button" class="en-ej-row en-maestro-btn" data-acc="maestro" data-clave="${esc(r.m.clave)}"
        aria-expanded="${abierto}"${abierto ? ` aria-controls="${id}"` : ''}>
        ${htmlFoto(top)}
        <span class="en-ej-row-txt">
          <span class="en-ej-row-nombre">${esc(r.m.nombre)}</span>
          <span class="en-ej-row-sub">${esc([capital(top.musculosPrimarios?.[0]), cuantas].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="en-maestro-chev">${SVG_CHEV}</span>
      </button>
      ${abierto ? `<div class="en-variantes" id="${id}">${r.grupos.map(g => htmlGrupoVariantes(r.m, g, overlay)).join('')}</div>` : ''}
    </div>`;
}

function htmlGrupoVariantes(m, g, overlay) {
  const k = m.clave + '|' + g.nombre;
  // Solo se recorta si quedan escondidas al menos 3: un «+1 más» cuesta lo
  // mismo que enseñar la etiqueta.
  const corto = g.variantes.length > VARIANTES_VISIBLES + 2 && !masBib.has(k);
  const vs = corto ? g.variantes.slice(0, VARIANTES_VISIBLES) : g.variantes;
  const contexto = m.nombre + (g.nombre ? ' ' + g.nombre.toLowerCase() : '');
  return `
    <div class="en-var-grupo" data-k="${esc(k)}">
      ${g.nombre ? `<div class="en-var-lbl">${esc(g.nombre)}</div>` : ''}
      <div class="en-var-chips">${vs.map(v => `
        <button type="button" class="en-var" data-acc="ej" data-lugar="var" data-id="${esc(v.e.id)}"
          aria-label="${esc(v.etiqueta)}, ${esc(contexto)}">${overlay ? SVG_SUMAR : ''}<span>${esc(v.etiqueta)}</span></button>`).join('')}
        ${corto ? `<button type="button" class="en-var en-var-mas" data-acc="var-mas" data-k="${esc(k)}">+${g.variantes.length - VARIANTES_VISIBLES} más</button>` : ''}
      </div>
    </div>`;
}

function htmlANodo(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Repinta resultados y etiquetas de filtros sin tocar el buscador ni el panel
// de casillas: así ni el teclado ni la casilla recién tocada pierden el foco.
function actualizarBiblioteca(cont, destino) {
  const res = datosBiblioteca();
  const nf = cuentaFiltros(filtrosBib);
  cont.querySelector('.en-busca-res')?.replaceWith(htmlANodo(htmlResultadosBiblioteca(destino, res)));
  cont.querySelector('.en-factivos')?.replaceWith(htmlANodo(htmlFiltrosActivos()));
  const fb = cont.querySelector('[data-acc="filtros"]');
  if (fb) {
    fb.classList.toggle('en-filtros-btn-on', nf > 0);
    fb.querySelector('span').textContent = textoBotonFiltros(nf);
  }
  // La fila de «Afinar» se rehace solo si cambió qué zonas la llevan: rehacerla
  // al tocar una de sus casillas le quitaría el foco.
  const af = cont.querySelector('.en-fafinar');
  if (af && af.dataset.zonas !== zonasParaAfinar(filtrosBib).join('|')) af.replaceWith(htmlANodo(htmlAfinar()));
  cont.querySelectorAll('.en-fpanel input[data-f]').forEach(c => { c.checked = filtrosBib[c.dataset.f].has(c.value); });
  const ver = cont.querySelector('.en-fver');
  if (ver) ver.textContent = textoVer(res);
  const lim = cont.querySelector('.en-fpanel [data-acc="limpiar-filtros"]');
  if (lim) lim.disabled = !nf;
  // Mensaje de estado (WCAG 4.1.3): el conteo, no la lista.
  const est = cont.querySelector('.en-busca-estado');
  if (est) {
    const n = res.reduce((s, r) => s + r.n, 0);
    est.textContent = (consultaBib.trim() || nf) ? (n ? textoEjercicios(n) : 'Sin resultados') : '';
  }
}

function htmlLibre(q) {
  if (!q) return '';
  return `<button type="button" class="en-btn en-btn-ghost en-libre" data-acc="libre">
    Registrar «${esc(consultaBib.trim())}» como ejercicio libre</button>`;
}

function elegirEjercicio(id, destino) {
  const f = porId.get(id);
  // La próxima vez que se abra la biblioteca empieza con el panel cerrado (los
  // filtros marcados siguen, visibles como etiquetas).
  panelFiltros = false;
  if (destino === 'sesion') { consultaBib = ''; agregarEjercicioASesion(id, f?.nombre ?? id); return; }
  if (destino === 'rutina') { consultaBib = ''; agregarEjercicioARutina(id, f?.nombre ?? id); return; }
  // Desde la Biblioteca se abre su FICHA (instrucciones, fotos, músculos): antes
  // tocar la fila arrancaba una sesión al instante, y las instrucciones
  // traducidas de 871 ejercicios no se veían en ninguna pantalla.
  volverBib = { y: window.scrollY, id };
  fichaId = id;
  render();
  window.scrollTo(0, 0);
}

function pintarFicha(raiz, id) {
  const e = porId.get(id);
  const enSesion = !!(sesion && !sesion.finMs);
  if (!e) { fichaId = null; render(); return; }
  const fotos = (e.imagenes || []).slice(0, 2);
  const pos = ['posición inicial', 'posición final'];
  raiz.innerHTML = `
  <div class="en-wrap">
    <button type="button" class="en-volver" data-acc="ficha-volver">${SVG_VOLVER}<span>${enSesion ? 'Volver a la sesión' : 'Biblioteca'}</span></button>
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
    ${enSesion ? '' : '<button type="button" class="en-btn en-btn-main en-ficha-cta" data-acc="ficha-empezar">Empezar sesión con este ejercicio</button>'}
    <p class="en-fuentes">Ejercicio e imágenes: free-exercise-db (dominio público).</p>
  </div>${enSesion ? htmlBarraDescanso() : ''}`;
  raiz.querySelector('.en-wrap').addEventListener('click', ev => {
    const b = ev.target.closest('[data-acc]');
    if (!b) return;
    if (b.dataset.acc === 'ficha-volver') {
      fichaId = null;
      render();
      // De vuelta en la Biblioteca: misma altura y foco en la etiqueta o fila
      // de donde se salió, para revisar variantes una tras otra sin perderse.
      const v = volverBib;
      volverBib = null;
      if (v) {
        window.scrollTo(0, v.y);
        const sel = `[data-acc="ej"][data-id="${CSS.escape(v.id)}"]`;
        (ctx.raiz.querySelector(`.en-variantes ${sel}`) || ctx.raiz.querySelector(`.en-busca-res ${sel}`))?.focus({ preventScroll: true });
      }
    }
    if (b.dataset.acc === 'ficha-empezar') { const fid = fichaId; fichaId = null; consultaBib = ''; empezarConEjercicio(fid); }
  });
  // Dentro de la sesión, leer la ficha no pausa nada: el crono y el descanso
  // siguen corriendo y el aviso de fin suena igual.
  if (enSesion) {
    conectarBarraDescanso(raiz);
    pintarDescanso();
    arrancarReloj();
  }
}

// Ejercicio libre: id estable derivado del nombre, así "la última vez" y el
// progreso funcionan entre sesiones aunque no exista en el catálogo.
function elegirLibre(destino) {
  const nombre = consultaBib.trim();
  if (!nombre) return;
  const id = 'LIBRE-' + normalizar(nombre).replace(/\s+/g, '-');
  consultaBib = '';
  if (destino === 'sesion') agregarEjercicioASesion(id, nombre);
  else if (destino === 'rutina') agregarEjercicioARutina(id, nombre);
  else {
    sesion = nuevaSesion(null);
    sesion.ejercicios.push(ejercicioDeSesion(id, nombre, descansoDeSesion(), null, 3));
    persistir();
    pedirWakeLock();
    render();
  }
}

// ── Historial y progreso ─────────────────────────────────────────────────────

function pintarPanelHistorial(panel) {
  const sesiones = estado.entreno.sesiones;
  if (!sesiones.length) {
    panel.innerHTML = '<p class="en-vacio">Aquí vivirán tus sesiones. Empieza la primera desde Rutinas.</p>';
    return;
  }
  // Ejercicios con series hechas, el de uso más reciente primero: es la lista
  // de "progreso por ejercicio".
  const vistos = new Map();
  for (let i = sesiones.length - 1; i >= 0; i--) {
    for (const ej of sesiones[i].ejercicios || []) {
      if (!vistos.has(ej.idEjercicio) && (ej.series || []).some(s => s.hecha && !esCalentamiento(s))) {
        vistos.set(ej.idEjercicio, ej.nombre ?? ej.idEjercicio);
      }
    }
  }
  panel.innerHTML = `
    ${[...sesiones].reverse().map(s => {
      const series = (s.ejercicios || []).reduce((a, e) => a + (e.series || []).filter(x => x.hecha && !esCalentamiento(x)).length, 0);
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
    if (b.dataset.acc === 'prog') { verProgresoId = b.dataset.id; detalleTab = 'progreso'; render(); window.scrollTo(0, 0); }
  });
}

// ── Progreso (pestaña) ───────────────────────────────────────────────────────
//
// Patrón de experiencia de WHOOP (volumen promedio con comparación, gráfica,
// récords con medalla, historial por ejercicio) calculado con TUS datos; sin
// métricas de sensor. Todo sale de las funciones puras de arriba.

const DIA_MS = 86400000;

function rangoPeriodo(periodo, ahora = Date.now()) {
  const dias = periodo === '6m' ? 182 : 30;
  return { desde: ahora - dias * DIA_MS, hasta: ahora + 1, antesDesde: ahora - 2 * dias * DIA_MS, antesHasta: ahora - dias * DIA_MS };
}

// Barras de la gráfica: por sesión en 1 mes; por mes (promedio por sesión) en 6.
function barrasPeriodo(sesiones, periodo, id, metrica) {
  const valor = s => {
    const ejs = (s.ejercicios || []).filter(e => !id || e.idEjercicio === id).map(resumenEjercicio);
    if (!ejs.some(r => r.series.length)) return null;
    return ejs.reduce((a, r) => a + (metrica === 'reps' ? r.totalReps : r.volumen), 0);
  };
  const { desde } = rangoPeriodo(periodo);
  if (periodo === '1m') {
    return sesiones.filter(s => s.inicioMs >= desde).map(s => ({ s, v: valor(s) })).filter(x => x.v !== null)
      .map(x => ({ valor: x.v, etiqueta: new Date(x.s.inicioMs).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) }));
  }
  const hoy = new Date();
  const barras = [];
  for (let i = 5; i >= 0; i--) {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1).getTime();
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 1).getTime();
    const vals = sesiones.filter(s => s.inicioMs >= ini && s.inicioMs < fin).map(valor).filter(v => v !== null);
    barras.push({ valor: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
      etiqueta: new Date(ini).toLocaleDateString('es-MX', { month: 'short' }).replace('.', '') });
  }
  return barras;
}

const fmtNum = (n, unidad) => Math.round(unidad === 'lb' ? n / 0.45359237 : n).toLocaleString('es-MX');
// "13.1 mil", no "13.1 k": así se dice en español.
const fmtCompacto = (n, unidad) => {
  const v = unidad === 'lb' ? n / 0.45359237 : n;
  return v >= 1000 ? `${(Math.round(v / 100) / 10).toLocaleString('es-MX')} mil` : Math.round(v).toLocaleString('es-MX');
};

// Gráfica de barras en SVG propio (sin librerías): valor encima de cada barra,
// etiqueta debajo; resumen para lector de pantalla y lista accesible aparte.
function htmlGrafica(barras, unidad, titulo) {
  if (!barras.length || !barras.some(b => b.valor > 0)) {
    return '<p class="en-vacio">Aún no hay datos en este periodo.</p>';
  }
  const W = 335, H = 200, ARR = 30, ABA = 30, n = barras.length;
  const max = Math.max(...barras.map(b => b.valor)) || 1;
  const slot = (W - 8) / n;
  const ancho = Math.min(34, slot * 0.62);
  const salto = n > 10 ? Math.ceil(n / 6) : 1;
  const util = H - ARR - ABA;
  const barrasSvg = barras.map((b, i) => {
    const h = b.valor > 0 ? Math.max(3, (b.valor / max) * util) : 0;
    const cx = 4 + slot * i + slot / 2;
    const y = H - ABA - h;
    return `${h ? `<rect class="gr-bar" x="${(cx - ancho / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${ancho.toFixed(1)}" height="${h.toFixed(1)}" rx="6"/>` : ''}
      ${b.valor > 0 && (n <= 10 || i % salto === 0 || i === n - 1) ? `<text class="gr-val" x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle">${esc(unidad === 'reps' ? Math.round(b.valor) : fmtCompacto(b.valor, unidad))}</text>` : ''}
      ${i % salto === 0 || i === n - 1 ? `<text class="gr-x" x="${cx.toFixed(1)}" y="${H - 9}" text-anchor="middle">${esc(b.etiqueta)}</text>` : ''}`;
  }).join('');
  const resumen = `${titulo}: ${barras.map(b => `${b.etiqueta} ${unidad === 'reps' ? Math.round(b.valor) + ' reps' : fmtNum(b.valor, unidad) + ' ' + unidad}`).join(', ')}`;
  return `<svg class="en-grafica" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(resumen)}">
    <line class="gr-base" x1="0" x2="${W}" y1="${H - ABA}" y2="${H - ABA}"/>
    <line class="gr-guia" x1="0" x2="${W}" y1="${ARR + util / 2}" y2="${ARR + util / 2}"/>
    ${barrasSvg}
  </svg>`;
}

function htmlCambio(pct, etiquetaPeriodo) {
  if (pct === null) return `<span class="en-cambio en-cambio-nuevo">Sin periodo anterior para comparar</span>`;
  const sube = pct > 0, baja = pct < 0;
  const flecha = sube ? '<path d="M6 15l6-6 6 6"/>' : baja ? '<path d="M6 9l6 6 6-6"/>' : '<path d="M6 12h12"/>';
  return `<span class="en-cambio${sube ? ' en-cambio-sube' : ''}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${flecha}</svg>
    ${sube ? '+' : ''}${pct} % vs. ${etiquetaPeriodo}</span>`;
}

function htmlPeriodo() {
  return `<div class="en-periodo" role="group" aria-label="Periodo">
    ${[['1m', '1 mes'], ['6m', '6 meses']].map(([k, l]) => `<button type="button" class="en-periodo-btn${periodoProg === k ? ' en-periodo-on' : ''}" aria-pressed="${periodoProg === k}" data-periodo="${k}">${l}</button>`).join('')}
  </div>`;
}

function textoMejor(m, unidad) {
  return m.pesoKg > 0 ? `${fmtPeso(m.pesoKg, unidad)} ${unidad} × ${m.reps} reps` : `${m.reps} reps`;
}

function pintarPanelProgreso(panel) {
  const sesiones = estado.entreno.sesiones;
  if (faltaCatalogo()) cargarCatalogo().then(() => repintarConCatalogo(() => subtab === 'progreso' && !sesion, true));
  if (!sesiones.length) {
    panel.innerHTML = `<div class="en-prog-vacio">
      <p class="en-vacio">Aquí verás cuánto levantas, tus series y tus récords. Termina tu primera sesión y empieza la cuenta.</p>
      <button type="button" class="en-btn en-btn-main" data-acc="ir-rutinas">Elegir una rutina</button>
    </div>`;
    panel.querySelector('[data-acc="ir-rutinas"]').addEventListener('click', () => { subtab = 'rutinas'; render(); });
    return;
  }
  const unidad = unidadPeso();
  const r = rangoPeriodo(periodoProg);
  const act = estadisticasPeriodo(sesiones, r.desde, r.hasta);
  const ant = estadisticasPeriodo(sesiones, r.antesDesde, r.antesHasta);
  const etqAnt = periodoProg === '6m' ? 'los 6 meses anteriores' : 'el mes anterior';
  const prs = prsPorEjercicio(sesiones);
  panel.innerHTML = `
    <div class="en-prog-hd">
      <h3 class="en-prog-t">Volumen promedio por sesión</h3>
      ${htmlPeriodo()}
    </div>
    <div class="en-kpi"><span class="en-kpi-n">${fmtNum(act.promedio, unidad)}</span><span class="en-kpi-u">${unidad}</span></div>
    ${htmlCambio(cambioPct(act.promedio, ant.promedio), etqAnt)}
    <div class="en-mini-stats">
      <span><b>${act.sesiones}</b> ${act.sesiones === 1 ? 'sesión' : 'sesiones'}</span>
      <span><b>${act.series}</b> series</span>
      <span><b>${fmtCompacto(act.volumen, unidad)}</b> ${unidad} en total</span>
    </div>
    ${htmlGrafica(barrasPeriodo(sesiones, periodoProg, null, 'vol'), unidad, 'Volumen por ' + (periodoProg === '6m' ? 'mes' : 'sesión'))}
    <div class="en-sec-lbl">Récords personales</div>
    ${prs.map(p => `
      <button type="button" class="en-pr-fila" data-acc="prog" data-id="${esc(p.idEjercicio)}">
        ${miniatura(p.idEjercicio)}
        <span class="en-pr-txt"><span class="en-pr-n">${esc(p.nombre || p.idEjercicio)}</span><span class="en-pr-f">${esc(fechaCorta(p.inicioMs))}</span></span>
        <span class="en-pr-v">${p.mejor.pesoKg > 0 ? `<span><b>${fmtPeso(p.mejor.pesoKg, unidad)}</b> ${unidad}</span><small>× ${p.mejor.reps} reps</small>` : `<span><b>${p.mejor.reps}</b> reps</span>`}</span>
        <svg class="en-pr-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>
      </button>`).join('') || '<p class="en-vacio">Todavía no hay series hechas.</p>'}`;
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-periodo], [data-acc]');
    if (!b) return;
    if (b.dataset.periodo) { periodoProg = b.dataset.periodo; render(); return; }
    if (b.dataset.acc === 'prog') { verProgresoId = b.dataset.id; detalleTab = 'progreso'; render(); window.scrollTo(0, 0); }
  });
}

// ── Detalle de un ejercicio: Progreso · Historial · Instrucciones ────────────

const MEDALLA = n => `<svg class="en-medalla en-medalla-${n}" viewBox="0 0 28 32" role="img" aria-label="Récord ${n}"><path d="M8 0h4l3 7-4 2zM20 0h-4l-3 7 4 2z" class="en-medalla-cinta"/><circle cx="14" cy="19" r="11"/><text x="14" y="24" text-anchor="middle">${n}</text></svg>`;

function htmlSesionEjercicio(h, unidad, n) {
  const pr = h.mejor;
  return `<details class="en-rec">
    <summary class="en-rec-sum">
      ${n ? MEDALLA(n) : ''}
      <span class="en-rec-v">${textoMejor(pr, unidad)}</span>
      <span class="en-rec-f">${esc(fechaCorta(h.inicioMs))}</span>
    </summary>
    <div class="en-rec-cuerpo">
      <div class="en-rec-fila en-rec-hd" aria-hidden="true"><span>Reps</span><span>Peso</span></div>
      ${h.series.map(x => `<div class="en-rec-fila"><span>${x.reps}${x.partes?.length ? ` + ${x.partes.map(pt => x.tipo === 'drop' && pt.pesoKg > 0 ? `${pt.reps}×${fmtPeso(pt.pesoKg, unidad)}` : pt.reps).join(' + ')}` : ''}${TECNICAS[x.tipo]?.insignia ? ` <span class="en-tec"><span aria-hidden="true">${TECNICAS[x.tipo].insignia}</span><span class="en-sr">${TECNICAS[x.tipo].nombre}</span></span>` : ''}</span><span>${x.pesoKg > 0 ? `${fmtPeso(x.pesoKg, unidad)} ${unidad}` : 'peso corporal'}${x === pr ? ' <em class="en-rec-pr">mejor serie</em>' : ''}</span></div>`).join('')}
      <div class="en-rec-fila en-rec-tot"><span><b>${h.totalReps}</b> reps</span><span>${h.volumen > 0 ? `<b>${fmtNum(h.volumen, unidad)}</b> ${unidad} de volumen` : ''}</span></div>
      <button type="button" class="en-btn en-btn-ghost en-rec-ir" data-acc="ver-sesion" data-sid="${esc(h.sesionId)}">Ver la sesión</button>
    </div>
  </details>`;
}

function pintarDetalleEjercicio(raiz, id) {
  const sesiones = estado.entreno.sesiones;
  if (faltaCatalogo()) cargarCatalogo().then(() => repintarConCatalogo(() => !!verProgresoId, true));
  const f = porId.get(id);
  const hist = historialEjercicio(sesiones, id);
  const nombre = f?.nombre || hist[hist.length - 1]?.nombre || id;
  const unidad = unidadPeso();
  const conPeso = hist.some(h => h.mejor.pesoKg > 0);
  const metrica = conPeso ? 'vol' : 'reps';
  let cuerpo = '';
  if (detalleTab === 'instrucciones') {
    cuerpo = f ? `
      <div class="en-sec-lbl">Músculos</div>
      <p class="en-ficha-txt"><b>Principales:</b> ${esc((f.musculosPrimarios || []).map(capital).join(', ') || '—')}${
        (f.musculosSecundarios || []).length ? `<br><b>Secundarios:</b> ${esc(f.musculosSecundarios.map(capital).join(', '))}` : ''}</p>
      ${(f.instrucciones || []).length ? `<div class="en-sec-lbl">Cómo se hace</div><ol class="en-ficha-pasos">${f.instrucciones.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
      ${(f.imagenes || [])[1] ? `<div class="en-ficha-fotos">${f.imagenes.slice(0, 2).map((im, i) => `<span class="en-ficha-foto"><img loading="lazy" src="${esc(URL_IMG + im)}" alt="${esc(nombre)}, ${i ? 'posición final' : 'posición inicial'}"></span>`).join('')}</div>` : ''}`
      : '<p class="en-vacio">Este ejercicio lo registraste a mano: no tiene ficha en la biblioteca.</p>';
  } else if (detalleTab === 'historial') {
    cuerpo = hist.length ? [...hist].reverse().map(h => htmlSesionEjercicio(h, unidad, 0)).join('')
      : '<p class="en-vacio">Aún no hay series hechas de este ejercicio.</p>';
  } else {
    const r = rangoPeriodo(periodoProg);
    const valorPeriodo = (d, h) => {
      const xs = hist.filter(x => x.inicioMs >= d && x.inicioMs < h);
      return xs.length ? xs.reduce((a, x) => a + (metrica === 'reps' ? x.totalReps : x.volumen), 0) / xs.length : 0;
    };
    const act = valorPeriodo(r.desde, r.hasta), ant = valorPeriodo(r.antesDesde, r.antesHasta);
    const nAct = estadisticasPeriodo(sesiones, r.desde, r.hasta, id);
    const top = recordsEjercicio(sesiones, id, 3);
    const rm = hist.reduce((m, h) => {
      const v = Math.max(...h.series.map(x => epley1RM(x.pesoKg, x.reps) ?? 0));
      return v > m ? v : m;
    }, 0);
    const uMet = metrica === 'reps' ? 'reps' : unidad;
    cuerpo = hist.length ? `
      <div class="en-prog-hd">
        <h3 class="en-prog-t">${metrica === 'reps' ? 'Repeticiones promedio por sesión' : 'Volumen promedio por sesión'}</h3>
        ${htmlPeriodo()}
      </div>
      <div class="en-kpi"><span class="en-kpi-n">${metrica === 'reps' ? Math.round(act) : fmtNum(act, unidad)}</span><span class="en-kpi-u">${uMet}</span></div>
      ${htmlCambio(cambioPct(act, ant), periodoProg === '6m' ? 'los 6 meses anteriores' : 'el mes anterior')}
      <div class="en-mini-stats">
        <span><b>${nAct.sesiones}</b> ${nAct.sesiones === 1 ? 'sesión' : 'sesiones'}</span>
        <span><b>${nAct.series}</b> series</span>
        ${rm > 0 ? `<span><b>${fmtPeso(rm, unidad)}</b> ${unidad} 1RM <em>estimado</em></span>` : ''}
      </div>
      ${htmlGrafica(barrasPeriodo(sesiones, periodoProg, id, metrica), uMet, (metrica === 'reps' ? 'Repeticiones' : 'Volumen') + ' por ' + (periodoProg === '6m' ? 'mes' : 'sesión'))}
      <div class="en-sec-lbl">Récords personales</div>
      ${top.map((h, i) => htmlSesionEjercicio(h, unidad, i + 1)).join('')}`
      : '<p class="en-vacio">Aún no hay series hechas de este ejercicio. Cuando lo entrenes, aquí verás tu progreso y tus récords.</p>';
  }
  raiz.innerHTML = `
  <div class="en-wrap en-detalle">
    <button type="button" class="en-volver" data-acc="det-volver">${SVG_VOLVER}<span>${subtab === 'historial' ? 'Historial' : 'Progreso'}</span></button>
    ${f?.imagenes?.[0] ? `<div class="en-det-foto"><img src="${esc(URL_IMG + f.imagenes[0])}" alt="" decoding="async"></div>` : ''}
    <h2 class="en-titulo">${esc(nombre)}</h2>
    ${f ? `<p class="en-sub">${esc([capital(f.musculosPrimarios?.[0]), capital(f.equipo)].filter(Boolean).join(' · '))}</p>` : ''}
    <div class="en-tabs en-det-tabs" role="group" aria-label="Secciones del ejercicio">
      ${[['progreso', 'Progreso'], ['historial', 'Historial'], ['instrucciones', 'Instrucciones']].map(([k, l]) =>
        `<button type="button" class="en-tab${detalleTab === k ? ' en-tab-on' : ''}" aria-pressed="${detalleTab === k}" data-dtab="${k}">${l}</button>`).join('')}
    </div>
    ${cuerpo}
  </div>`;
  raiz.querySelector('.en-detalle').addEventListener('click', e => {
    const b = e.target.closest('[data-acc], [data-dtab], [data-periodo]');
    if (!b) return;
    if (b.dataset.dtab) { detalleTab = b.dataset.dtab; render(); return; }
    if (b.dataset.periodo) { periodoProg = b.dataset.periodo; render(); return; }
    if (b.dataset.acc === 'det-volver') { verProgresoId = null; render(); return; }
    if (b.dataset.acc === 'ver-sesion') { verSesionId = b.dataset.sid; render(); window.scrollTo(0, 0); }
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

// ── Sesión en vivo: dos ventanas ─────────────────────────────────────────────
//
// Patrón de experiencia de WHOOP (no su contenido ni sus métricas de sensor):
//   · «Sesión en vivo» — foco total: un círculo con el estado (Calentamiento /
//     Activo / Descansar / Listo), la serie que toca y UN botón grande que
//     alterna Empezar serie → Fin de la serie. Fin de la serie palomea y
//     arranca el descanso; Empezar serie durante el descanso lo corta.
//   · «Ejercicios» — la lista completa para corregir pesos, reps y RIR.
// Todo el tiempo se deriva de timestamps guardados en la sesión
// (serieEnCurso.inicioMs, descanso.finMs, listoDesdeMs): un reload no pierde
// ni un segundo.

function miniatura(idEjercicio, clase = 'en-thumb') {
  return `<span class="${clase}" data-foto="${esc(idEjercicio ?? '')}">${htmlImgFoto(idEjercicio)}</span>`;
}
function htmlImgFoto(idEjercicio) {
  const img = porId.get(idEjercicio)?.imagenes?.[0];
  return img ? `<img loading="lazy" src="${esc(URL_IMG + img)}" alt="">` : '';
}
// Si el catálogo llega cuando la pantalla ya está pintada, las miniaturas se
// llenan en su sitio: repintar todo movería el foco y la posición.
function rellenarFotos(raiz) {
  raiz.querySelectorAll('[data-foto]').forEach(s => { if (!s.firstElementChild) s.innerHTML = htmlImgFoto(s.dataset.foto); });
}

function serieEnCursoValida() {
  const c = sesion?.serieEnCurso;
  if (!c) return null;
  const s = sesion.ejercicios[c.idx]?.series?.[c.serie];
  return s && !s.hecha ? c : null;
}

// La parte en curso de una serie con técnica (mini-serie de rest-pause o
// bajada de drop set): solo vale si su serie existe, sigue sin cerrar y le
// toca justo esa parte.
function parteEnCursoValida() {
  const p = sesion?.parteEnCurso;
  if (!p) return null;
  const s = sesion.ejercicios[p.idx]?.series?.[p.serie];
  if (!s || s.hecha) return null;
  const sp = siguienteParte(s);
  return sp.fase !== 'fin' && sp.k === p.k ? p : null;
}

// El micro-descanso del rest-pause corre con la misma maquinaria que el
// descanso (hora de fin), marcado con `micro`.
function microEnCurso() {
  const d = sesion?.descanso;
  if (!d?.micro || !descansoObj || descansoObj.haTerminado()) return null;
  const s = sesion.ejercicios[d.idx]?.series?.[d.micro.serie];
  return s && !s.hecha ? { idx: d.idx, ...d.micro } : null;
}

// Estado del foco, derivado (nunca guardado): qué dice el círculo y qué hace
// el botón grande.
function estadoFoco() {
  const parte = parteEnCursoValida();
  if (parte) {
    const s = sesion.ejercicios[parte.idx].series[parte.serie];
    const total = siguienteParte(s).total;
    return { tipo: 'parte', lbl: s.tipo === 'drop' ? `Bajada ${parte.k + 1}/${total}` : `Mini-serie ${parte.k + 1}/${total}`,
      ref: { idx: parte.idx, serie: parte.serie }, desdeMs: parte.inicioMs, parte };
  }
  const enCurso = serieEnCursoValida();
  if (enCurso) {
    return { tipo: 'activo', lbl: 'Activo', ref: enCurso, desdeMs: enCurso.inicioMs };
  }
  const micro = microEnCurso();
  if (micro) return { tipo: 'micro', lbl: 'Micro-descanso', ref: { idx: micro.idx, serie: micro.serie }, micro };
  const sig = siguientePendiente(sesion.ejercicios);
  // Sin series pendientes no hay "siguiente" que empezar: el foco pasa a
  // "Completa" con Terminar sesión, aunque corriera un descanso.
  if (!sig) return { tipo: 'fin', lbl: sesion.ejercicios.length ? 'Completa' : 'Sin ejercicios', ref: null };
  if (descansoObj && !descansoObj.haTerminado()) return { tipo: 'descanso', lbl: 'Descansar', ref: sig };
  const algunaHecha = sesion.ejercicios.some(e => e.series.some(x => x.hecha));
  return algunaHecha
    ? { tipo: 'listo', lbl: 'Listo', ref: sig, desdeMs: sesion.listoDesdeMs || sesion.inicioMs }
    : { tipo: 'calentamiento', lbl: 'Preparado', ref: sig, desdeMs: sesion.inicioMs };
}

function tiempoFoco(ef) {
  if (ef.tipo === 'descanso' || ef.tipo === 'micro') return formatear(descansoObj.restanteS());
  if (ef.desdeMs) return formatear((Date.now() - ef.desdeMs) / 1000);
  return '0:00';
}

function empezarSerie() {
  const sig = siguientePendiente(sesion.ejercicios);
  if (!sig) return;
  // Empezar durante el descanso lo corta en silencio: es una decisión, no un aviso.
  if (descansoObj) {
    avisadoFin = true;
    descansoObj = null;
    if (timerOcultar) { clearTimeout(timerOcultar); timerOcultar = null; }
    delete sesion.descanso;
  }
  sesion.serieEnCurso = { idx: sig.idx, serie: sig.serie, inicioMs: Date.now() };
  const ejS = sesion.ejercicios[sig.idx];
  anunciar(`Serie ${sig.serie + 1} de ${ejS.series.length} de ${ejS.nombre}, en curso.`);
  prepararAudio();
  persistir();
  render();
}

// Lo anotado en una serie pasa a la siguiente del mismo ejercicio si está en
// blanco: en el gym lo normal es repetir carga, y teclear todo de nuevo en
// cada serie es la fricción que hacía que se guardaran series en cero.
function heredarASiguiente(ej, j) {
  const hecha = ej.series[j], sig = ej.series[j + 1];
  if (!sig || sig.hecha) return;
  // De un calentamiento a una serie de trabajo no se hereda: la carga es otra.
  if (esCalentamiento(hecha) !== esCalentamiento(sig)) return;
  if (!sig.reps) sig.reps = hecha.reps;
  if (!sig.pesoKg) sig.pesoKg = hecha.pesoKg;
}

function leerFoco(serie) {
  const r = ctx.raiz.querySelector('.en-foco-in[data-campo="reps"]');
  const p = ctx.raiz.querySelector('.en-foco-in[data-campo="peso"]');
  if (r) { const v = parseInt(r.value, 10); serie.reps = Number.isFinite(v) && v > 0 ? v : 0; }
  if (p) { const v = parseFloat(p.value.replace(',', '.')); serie.pesoKg = aKg(Number.isFinite(v) && v > 0 ? v : 0, unidadPeso()); }
}

function finDeSerie() {
  const c = serieEnCursoValida();
  if (!c) return;
  const ej = sesion.ejercicios[c.idx];
  const serie = ej.series[c.serie];
  // Peso y reps son opcionales (Roberto, 31-oct-2026: pedirlos a mitad de una
  // superserie o de una bajada era incómodo). Lo que no se anota queda en 0 y
  // se corrige después en «Ejercicios».
  leerFoco(serie);
  // Cuánto duró la serie (su parte principal): dato barato para el historial.
  serie.durS = Math.round((Date.now() - c.inicioMs) / 1000);
  sesion.serieEnCurso = null;
  // Rest-pause y drop set: la serie no se cierra hasta hacer sus partes.
  const sp = siguienteParte({ ...serie, partes: [] });
  if (sp.fase !== 'fin') {
    serie.partes = [];
    iniciarParte(c.idx, c.serie, sp);
    persistir();
    render();
    return;
  }
  cerrarSerie(c.idx, c.serie);
}

// Cierra una serie (con o sin técnica): la marca hecha, pasa lo anotado a la
// siguiente y decide el descanso. El calentamiento descansa como mucho 1 min.
function cerrarSerie(idx, j) {
  const ej = sesion.ejercicios[idx];
  const serie = ej.series[j];
  serie.hecha = true;
  serie.tsHecha = Date.now();
  sesion.parteEnCurso = null;
  if (sesion.descanso?.micro) { descansoObj = null; delete sesion.descanso; }
  heredarASiguiente(ej, j);
  const quedan = siguientePendiente(sesion.ejercicios);
  if (quedan && debeArrancarDescanso(sesion.ejercicios, idx, j)) {
    const fin = ej.superGrupo == null ? idx : ultimoDelGrupo(ej.superGrupo);
    arrancarDescanso(fin, esCalentamiento(serie) && ej.superGrupo == null ? Math.min(60, sesion.ejercicios[fin].descansoS) : undefined);
    anunciar(`Serie hecha. Descanso de ${formatear(sesion.descanso.duracionS)}.`);
  } else if (!quedan) {
    anunciar('Hiciste todas las series. Termina la sesión para ver tu resumen.');
  } else {
    // Superserie a media ronda: sin descanso, directo al siguiente ejercicio.
    sesion.listoDesdeMs = Date.now();
  }
  persistir();
  render();
}

// Siguiente parte de una serie con técnica. Rest-pause: micro-descanso (con
// aviso al acabar) y luego la mini-serie, con el mismo peso. Drop set: la
// bajada empieza ya, con el peso calculado (−pct, redondeado al disco).
function iniciarParte(idx, j, sp) {
  const s = sesion.ejercicios[idx].series[j];
  const unidad = unidadPeso();
  if (sp.fase === 'micro') {
    descansoObj = crearDescanso({ duracionS: sp.microS });
    avisadoFin = false;
    if (timerOcultar) { clearTimeout(timerOcultar); timerOcultar = null; }
    sesion.descanso = { finMs: descansoObj.finMs, duracionS: sp.microS, idx, micro: { serie: j, k: sp.k, reps: 0, pesoKg: s.pesoKg } };
    anunciar(`Micro-descanso de ${sp.microS} segundos. Luego, mini-serie ${sp.k + 1} de ${sp.total} con el mismo peso.`);
  } else {
    const previo = s.partes?.length ? s.partes[s.partes.length - 1].pesoKg : s.pesoKg;
    const peso = pesoBajada(previo, sp.pct, unidad);
    sesion.parteEnCurso = { idx, serie: j, k: sp.k, inicioMs: Date.now(), reps: 0, pesoKg: peso };
    anunciar(`Drop set: baja a ${fmtPeso(peso, unidad)} ${unidad} y sigue. Bajada ${sp.k + 1} de ${sp.total}.`);
  }
}

// Si queda una serie con técnica a medias (en su micro-descanso o en una
// parte), se cierra con lo hecho hasta aquí, SIN arrancar descanso: al
// terminar la sesión o al palomear otra serie a mano, la parte principal ya
// hecha no puede perderse ni quedar un micro-descanso fantasma.
function cerrarTecnicaPendiente() {
  const ref = parteEnCursoValida() || (sesion?.descanso?.micro ? { idx: sesion.descanso.idx, serie: sesion.descanso.micro.serie } : null);
  if (sesion) sesion.parteEnCurso = null;
  if (sesion?.descanso?.micro) { delete sesion.descanso; descansoObj = null; }
  if (!ref) return;
  const s = sesion.ejercicios[ref.idx]?.series?.[ref.serie];
  if (s && !s.hecha) { s.hecha = true; s.tsHecha = Date.now(); }
}

// El micro-descanso acabó (o se saltó): empieza la mini-serie con lo que ya
// se hubiera anotado durante la espera.
function empezarParteTrasMicro() {
  const d = sesion?.descanso;
  if (!d?.micro) return;
  sesion.parteEnCurso = { idx: d.idx, serie: d.micro.serie, k: d.micro.k, inicioMs: Date.now(), reps: d.micro.reps || 0, pesoKg: d.micro.pesoKg };
  delete sesion.descanso;
  descansoObj = null;
}

function finDeParte() {
  const p = parteEnCursoValida();
  if (!p) return;
  const s = sesion.ejercicios[p.idx].series[p.serie];
  leerFoco(p);  // opcional, como en la parte principal
  // En rest-pause la mini-serie es con el mismo peso; en drop set, el anotado.
  s.partes = [...(s.partes || []), s.tipo === 'drop' ? { reps: p.reps, pesoKg: p.pesoKg } : { reps: p.reps }];
  sesion.parteEnCurso = null;
  const sp = siguienteParte(s);
  if (sp.fase !== 'fin') {
    iniciarParte(p.idx, p.serie, sp);
    persistir();
    render();
    return;
  }
  cerrarSerie(p.idx, p.serie);
}

function pintarVivo(raiz) {
  const unidad = unidadPeso();
  const vista = vistaVivo;
  const tabs = `
    <div class="en-tabs en-vivo-tabs" role="group" aria-label="Vista de la sesión">
      <button type="button" class="en-tab${vista === 'foco' ? ' en-tab-on' : ''}" aria-pressed="${vista === 'foco'}" data-acc="vista" data-v="foco">Sesión en vivo</button>
      <button type="button" class="en-tab${vista === 'ejercicios' ? ' en-tab-on' : ''}" aria-pressed="${vista === 'ejercicios'}" data-acc="vista" data-v="ejercicios">Ejercicios</button>
    </div>`;

  raiz.innerHTML = `
  <div class="en-wrap en-vivo${vista === 'foco' ? ' en-vivo-foco' : ''}">
    <header class="en-vivo-hd">
      <div>
        <div class="en-ey">Sesión en curso</div>
        <h2 class="en-titulo">${esc(nombreSesion(sesion))}</h2>
      </div>
      <div class="en-crono" role="timer" aria-label="Tiempo de sesión">${formatear((Date.now() - sesion.inicioMs) / 1000)}</div>
    </header>
    ${tabs}
    ${vista === 'foco' ? htmlFoco(unidad) : htmlListaVivo(unidad)}
  </div>
  ${vista === 'ejercicios' ? htmlBarraDescanso() : ''}`;

  const wrap = raiz.querySelector('.en-vivo');
  wrap.addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    const acc = b.dataset.acc;
    if (acc === 'vista') { vistaVivo = b.dataset.v; render(); return; }
    if (acc === 'ficha') { fichaId = b.dataset.id; render(); window.scrollTo(0, 0); return; }
    if (acc === 'empezar-serie') { empezarSerie(); return; }
    if (acc === 'fin-serie') { finDeSerie(); return; }
    if (acc === 'fin-parte') { finDeParte(); return; }
    if (acc === 'saltar-micro') {
      const m = sesion.descanso?.micro;
      if (!m) return;
      leerFoco(m);   // en iPhone tocar el botón no siempre quita el foco del campo
      avisadoFin = true;
      empezarParteTrasMicro();
      persistir();
      anunciar(`Mini-serie ${m.k + 1}: ¡a darle!`);
      render();
      return;
    }
    if (acc === 'cerrar-tecnica') {
      // Salida: dejar la serie con las partes hechas hasta aquí. Doble toque,
      // como los demás botones que terminan algo.
      if (!armarDosToques(b, 'Toca otra vez para terminarla')) return;
      const ref = parteEnCursoValida() || microEnCurso();
      if (ref) cerrarSerie(ref.idx, ref.serie);
      return;
    }
    if (acc === 'f-aj') { ajustarDescanso(+b.dataset.d); return; }
    if (acc === 'editar') { vistaVivo = 'ejercicios'; render(); return; }
    if (acc === 'check') {
      alPalomear(+b.dataset.idx, +b.dataset.serie, b.closest('.en-fila'));
    } else if (acc === 'serie') {
      const ej = sesion.ejercicios[+b.dataset.idx];
      ej.series.push(serieVacia(ej.series[ej.series.length - 1]));
      persistir();
      render();
    } else if (acc === 'menos-serie') {
      const idx = +b.dataset.idx, ej = sesion.ejercicios[idx];
      if (ej.series.length > 1) {
        ej.series.pop();
        const c = sesion.serieEnCurso;
        if (c && c.idx === idx && c.serie >= ej.series.length) sesion.serieEnCurso = null;
        // Si la serie quitada estaba a mitad de su técnica, esa parte se va con ella.
        const pc = sesion.parteEnCurso;
        if (pc && pc.idx === idx && pc.serie >= ej.series.length) sesion.parteEnCurso = null;
        if (sesion.descanso?.micro && sesion.descanso.idx === idx && sesion.descanso.micro.serie >= ej.series.length) { descansoObj = null; delete sesion.descanso; }
        persistir();
        render();
      }
    } else if (acc === 'quitar-ej') {
      if (!armarDosToques(b, 'Toca otra vez para quitarlo')) return;
      const idx = +b.dataset.idx;
      sesion.ejercicios.splice(idx, 1);
      const c = sesion.serieEnCurso;
      if (c) { if (c.idx === idx) sesion.serieEnCurso = null; else if (c.idx > idx) c.idx--; }
      // La parte en curso y el descanso apuntan a un ejercicio por su índice:
      // se corrigen igual (o se cancelan si eran del que se quitó).
      const pc = sesion.parteEnCurso;
      if (pc) { if (pc.idx === idx) sesion.parteEnCurso = null; else if (pc.idx > idx) pc.idx--; }
      const d = sesion.descanso;
      if (d) {
        if (d.idx === idx) { if (d.micro) { descansoObj = null; delete sesion.descanso; } }
        else if (d.idx > idx) d.idx--;
      }
      persistir();
      render();
    } else if (acc === 'agregar') {
      modoBiblioteca = 'sesion';
      consultaBib = '';
      render();
    } else if (acc === 'terminar') {
      const sinHacer = sesion.ejercicios.some(ej => ej.series.some(s => !s.hecha));
      if (sinHacer && !armarDosToques(b, 'Hay series sin hacer · toca otra vez')) return;
      terminarSesion();
    } else if (acc === 'descartar') {
      if (!armarDosToques(b, 'Se pierde la sesión · toca otra vez')) return;
      descartarSesion();
    }
  });

  // Los valores tecleados se persisten al salir del campo: un reload a mitad
  // de sesión no pierde ni la fila a medias.
  wrap.addEventListener('change', e => {
    if (e.target.classList.contains('en-foco-in')) {
      // En una parte (o en su micro-descanso) lo anotado es de esa parte,
      // nunca de la serie principal.
      const destino = e.target.dataset.parte ? (parteEnCursoValida() || sesion.descanso?.micro)
        : sesion.ejercicios[+e.target.dataset.idx]?.series[+e.target.dataset.serie];
      if (destino) { leerFoco(destino); e.target.removeAttribute('aria-invalid'); persistir(); }
      return;
    }
    const fila = e.target.closest('.en-fila');
    const ejEl = e.target.closest('.en-ej');
    if (!fila || !ejEl || !e.target.classList.contains('en-in')) return;
    const ej = sesion.ejercicios[+ejEl.dataset.idx];
    leerFila(fila, ej.series[+fila.dataset.serie]);
    persistir();
  });

  if (vista === 'ejercicios') conectarBarraDescanso(raiz);
  pintarDescanso();
  arrancarReloj();
}

function htmlFoco(unidad) {
  if (!sesion.ejercicios.length) {
    return `<div class="en-foco">
      <p class="en-vacio">Agrega tu primer ejercicio para empezar.</p>
      <button type="button" class="en-btn en-btn-main" data-acc="agregar">+ Agregar ejercicio</button>
    </div>`;
  }
  const ef = estadoFoco();
  const ref = ef.ref;
  const ej = ref ? sesion.ejercicios[ref.idx] : null;
  const s = ej ? ej.series[ref.serie] : null;
  const enFicha = ej && porId.has(ej.idEjercicio);
  const rotulo = ef.tipo === 'activo' || ef.tipo === 'parte' || ef.tipo === 'micro' ? 'Ahora' : 'Siguiente';
  // En una parte (o su micro-descanso) los campos son los de ESA parte.
  const borradorParte = ef.tipo === 'parte' ? ef.parte : ef.tipo === 'micro' ? sesion.descanso?.micro : null;
  const T = s ? tecnicaDe(s) : null;
  // Si el ejercicio tiene alguna serie con técnica, la tarjeta reserva sus
  // líneas en TODAS sus series y estados: así no cambia de alto ni empuja el
  // botón entre activo, micro-descanso, mini-serie y bajada.
  const conTecnicas = !!ej && ej.series.some(x => tecnicaDe(x)?.insignia);
  const tp = s ? limpiarTecnica(s) : null;
  const queParte = s?.tipo === 'drop' ? 'bajada' : 'mini-serie';
  const kParte = borradorParte ? (Number(borradorParte.k) || 0) : 0;
  const nParte = borradorParte ? `${queParte} ${kParte + 1}` : '';
  const lineaTecnica = !s || !T?.insignia ? ''
    : ef.tipo === 'micro' ? `Rest-pause · prepárate: mini-serie ${kParte + 1} de ${tp.mini}, con el mismo peso.`
    : ef.tipo === 'parte' ? (s.tipo === 'drop'
      ? `Drop set · bajada ${kParte + 1} de ${tp.bajadas}: ${Number(borradorParte.pesoKg) > 0 ? `baja a ${fmtPeso(Number(borradorParte.pesoKg), unidad)} ${unidad}` : 'quita carga'} y sigue sin descansar.`
      : `Rest-pause · mini-serie ${kParte + 1} de ${tp.mini}, con el mismo peso.`)
    : s.tipo === 'restpause' ? `Rest-pause: al terminar, ${tp.microS} s de micro-descanso y ${tp.mini} ${tp.mini === 1 ? 'mini-serie' : 'mini-series'}.`
    : s.tipo === 'drop' ? `Drop set: al terminar, bajas un ${tp.pct} % y sigues sin descansar${tp.bajadas > 1 ? ` (${tp.bajadas} bajadas)` : ''}.`
    : 'Calentamiento de antes: no cuenta como serie.';
  const tarjeta = ej ? `
    <div class="en-foco-card">
      <div class="en-foco-ej">
        ${enFicha ? `<button type="button" class="en-foco-ficha" data-acc="ficha" data-id="${esc(ej.idEjercicio)}" aria-label="Ver cómo se hace ${esc(ej.nombre)}">${miniatura(ej.idEjercicio, 'en-thumb en-thumb-lg')}</button>`
          : miniatura(ej.idEjercicio, 'en-thumb en-thumb-lg')}
        <div class="en-foco-ej-txt">
          <span class="en-foco-rot">${rotulo}</span>
          <span class="en-foco-nombre">${esc(ej.nombre)}</span>
        </div>
        ${enFicha ? `<button type="button" class="en-foco-info" data-acc="ficha" data-id="${esc(ej.idEjercicio)}" aria-label="Ficha técnica de ${esc(ej.nombre)}">i</button>` : ''}
      </div>
      <div class="en-foco-stats">
        <span class="en-foco-st"><b>${ref.serie + 1}/${ej.series.length}${T?.insignia ? ` <span class="en-tec"><span aria-hidden="true">${T.insignia}</span><span class="en-sr">${T.nombre}</span></span>`
          : conTecnicas ? ' <span class="en-tec en-tec-hueco" aria-hidden="true">W</span>' : ''}</b><small>Serie</small></span>
        ${borradorParte ? `
        <label class="en-foco-st"><input class="en-foco-in" data-campo="reps" data-parte="1" data-idx="${ref.idx}" data-serie="${ref.serie}" inputmode="numeric" value="${Number(borradorParte.reps) || ''}" placeholder="0" aria-label="Repeticiones de la ${nParte}"><small>Reps</small></label>
        <label class="en-foco-st"><input class="en-foco-in" data-campo="peso" data-parte="1" data-idx="${ref.idx}" data-serie="${ref.serie}" inputmode="decimal" value="${Number(borradorParte.pesoKg) > 0 ? fmtPeso(Number(borradorParte.pesoKg), unidad) : ''}" placeholder="0"
          aria-label="Peso de la ${nParte} en ${unidad}${s.tipo === 'restpause' ? ', el mismo de la serie' : ''}"${s.tipo === 'restpause' ? ' readonly aria-readonly="true"' : ''}><small>${unidad}</small></label>` : `
        <label class="en-foco-st"><input class="en-foco-in" data-campo="reps" data-idx="${ref.idx}" data-serie="${ref.serie}" inputmode="numeric" value="${s.reps || ''}" placeholder="0" aria-label="Repeticiones de la serie ${ref.serie + 1}"><small>Reps</small></label>
        <label class="en-foco-st"><input class="en-foco-in" data-campo="peso" data-idx="${ref.idx}" data-serie="${ref.serie}" inputmode="decimal" value="${s.pesoKg ? fmtPeso(s.pesoKg, unidad) : ''}" placeholder="0" aria-label="Peso de la serie ${ref.serie + 1} en ${unidad}"><small>${unidad}</small></label>`}
      </div>
      ${conTecnicas ? `
      <p class="en-foco-tecnica">${esc(lineaTecnica)}</p>
      <p class="en-foco-partes"${borradorParte || s?.partes?.length ? '' : ' aria-hidden="true"'}>${borradorParte || s?.partes?.length ? `Hecho: ${esc(textoSerie(s, unidad))}` : '&nbsp;'}</p>
      <div class="en-foco-salida-caja">
        <button type="button" class="en-foco-salida" data-acc="cerrar-tecnica"${borradorParte ? '' : ' hidden'}>Terminar la serie aquí</button>
      </div>` : ''}
      ${ej.rango ? `<p class="en-foco-rango"${borradorParte ? ' aria-hidden="true" style="visibility:hidden"' : ''}>Objetivo de la rutina: ${ej.rango.min === ej.rango.max ? ej.rango.max : `${ej.rango.min}–${ej.rango.max}`} reps</p>` : ''}
      <p class="en-foco-error" role="alert"></p>
    </div>` : `<p class="en-vacio en-foco-fin">Hiciste todas las series. Termina la sesión para ver tu resumen, o agrega otro ejercicio.</p>`;

  const boton = ef.tipo === 'activo'
    ? `<button type="button" id="en-foco-btn" class="en-btn en-btn-main en-foco-btn" data-acc="fin-serie">Fin de la serie</button>`
    : ef.tipo === 'parte'
      ? `<button type="button" id="en-foco-btn" class="en-btn en-btn-main en-foco-btn" data-acc="fin-parte">Fin de la ${queParte}</button>`
    : ef.tipo === 'micro'
      ? `<button type="button" id="en-foco-btn" class="en-btn en-btn-main en-foco-btn" data-acc="saltar-micro">Empezar la mini-serie ya</button>`
    : ef.tipo === 'fin'
      ? `<button type="button" id="en-foco-btn" class="en-btn en-btn-main en-foco-btn" data-acc="terminar">Terminar sesión</button>
         <button type="button" class="en-btn en-btn-ghost en-add-ej" data-acc="agregar">+ Agregar ejercicio</button>`
      : `<button type="button" id="en-foco-btn" class="en-btn en-btn-main en-foco-btn" data-acc="empezar-serie">Empezar serie</button>`;

  // Los ±15 van a la DERECHA del círculo (pedido de Roberto, 30-oct-2026):
  // debajo empujaban la tarjeta y el botón al entrar y salir del descanso.
  return `
  <div class="en-foco">
    <div class="en-foco-fila">
      <div class="en-foco-anillo" data-estado="${ef.tipo}" style="--p:${progresoDescanso()}">
        <div class="en-foco-centro">
          <span class="en-foco-lbl">${ef.lbl}</span>
          <span class="en-foco-t" role="timer">${tiempoFoco(ef)}</span>
        </div>
      </div>
      <div class="en-foco-aj"${ef.tipo === 'descanso' ? '' : ' hidden'}>
        <button type="button" class="en-d-aj" data-acc="f-aj" data-d="15" aria-label="Sumar 15 segundos de descanso">+15</button>
        <button type="button" class="en-d-aj" data-acc="f-aj" data-d="-15" aria-label="Quitar 15 segundos de descanso">−15</button>
      </div>
    </div>
    ${tarjeta}
    ${boton}
    <span class="en-sr en-sr-descanso" aria-live="polite"></span>
    ${ef.tipo !== 'fin' ? `<div class="en-vivo-acciones"><button type="button" class="en-btn en-btn-ghost en-foco-terminar" data-acc="terminar">Terminar sesión</button></div>` : ''}
  </div>`;
}

function progresoDescanso() {
  if (!descansoObj || !sesion?.descanso?.duracionS) return 0;
  return Math.max(0, Math.min(1, descansoObj.restanteS() / sesion.descanso.duracionS)).toFixed(3);
}

// Repinta SOLO lo que cambia cada segundo en el foco; si el estado de fondo
// cambió (el descanso acabó), repinta la vista entera una vez.
function pintarFoco() {
  const anillo = ctx.raiz.querySelector('.en-foco-anillo');
  if (!anillo) return;
  const ef = estadoFoco();
  if (anillo.dataset.estado !== ef.tipo) { render(); return; }
  anillo.style.setProperty('--p', progresoDescanso());
  const t = anillo.querySelector('.en-foco-t');
  if (t) t.textContent = tiempoFoco(ef);
}

function htmlListaVivo(unidad) {
  const previos = new Map(sesion.ejercicios.map(e =>
    [e.idEjercicio, previasPorSerie(e.series.map(x => x.tipo ?? 'normal'), ultimaVez(estado.entreno.sesiones, e.idEjercicio))]));
  const enCurso = serieEnCursoValida();

  const htmlEjercicio = (ej, idx) => {
    const enFicha = porId.has(ej.idEjercicio);
    return `
    <section class="en-ej" data-idx="${idx}">
      <div class="en-ej-hd">
        ${enFicha
          ? `<button type="button" class="en-ej-tit" data-acc="ficha" data-id="${esc(ej.idEjercicio)}" aria-label="Ver cómo se hace ${esc(ej.nombre)}">${miniatura(ej.idEjercicio)}<span class="en-ej-nombre">${esc(ej.nombre)}</span></button>`
          : `<div class="en-ej-tit">${miniatura(ej.idEjercicio)}<span class="en-ej-nombre">${esc(ej.nombre)}</span></div>`}
      </div>
      <div class="en-tabla" role="group" aria-label="Series de ${esc(ej.nombre)}">
        <div class="en-fila en-fila-hd" aria-hidden="true">
          <span>#</span><span>Previa</span><span>${unidad}</span><span>Reps</span><span>RIR</span><span></span>
        </div>
        ${ej.series.map((s, j) => {
          const prev = previos.get(ej.idEjercicio)?.[j];
          const activa = enCurso && enCurso.idx === idx && enCurso.serie === j;
          const T = tecnicaDe(s);
          return `
          <div class="en-fila${s.hecha ? ' en-hecha' : ''}${activa ? ' en-activa' : ''}${T?.insignia ? ' en-fila-con-tec' : ''}" data-serie="${j}">
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
              aria-label="Serie ${j + 1}${T?.insignia ? ` (${T.nombre})` : ''} ${s.hecha ? 'hecha; tócala para desmarcarla' : 'por hacer; tócala al terminarla'}">${SVG_CHECK}</button>
          </div>${T?.insignia ? `<p class="en-fila-tec${activa ? ' en-activa-linea' : ''}"><span class="en-tec" aria-hidden="true">${T.insignia}</span><span>${esc(resumenTecnica(s))}${s.partes?.length ? ` · Hecho: ${esc(textoSerie(s, unidad, false))}` : ''}</span></p>`
            : s.partes?.length ? `<p class="en-fila-partes">${esc(textoSerie(s, unidad))}</p>` : ''}`;
        }).join('')}
        <div class="en-ej-pie">
          <button type="button" class="en-serie-btn" data-acc="serie" data-idx="${idx}" aria-label="Añadir una serie a ${esc(ej.nombre)}">${SVG_SUMAR}<span>Serie</span></button>
          ${ej.series.length > 1 ? `<button type="button" class="en-serie-btn en-serie-btn-menos" data-acc="menos-serie" data-idx="${idx}" aria-label="Quitar la última serie de ${esc(ej.nombre)}">${SVG_RESTAR}<span>Serie</span></button>` : ''}
          <button type="button" class="en-peligro en-quitar-ej" data-acc="quitar-ej" data-idx="${idx}">Quitar ejercicio</button>
        </div>
        ${ej.rango ? `<p class="en-ej-rango">Objetivo: ${ej.rango.min === ej.rango.max ? ej.rango.max : `${ej.rango.min}–${ej.rango.max}`} reps</p>` : ''}
      </div>
    </section>`;
  };

  // Los bloques con el mismo superGrupo van dentro de un marco común con su
  // rótulo: la superserie es un objeto de primera clase, no dos tarjetas que
  // casualmente van juntas.
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
  return `
    ${trozos.join('') || '<p class="en-vacio">Agrega tu primer ejercicio para empezar.</p>'}
    <button type="button" class="en-btn en-btn-ghost en-add-ej" data-acc="agregar">+ Agregar ejercicio</button>
    <div class="en-vivo-acciones">
      <button type="button" class="en-btn en-btn-main" data-acc="terminar">Terminar sesión</button>
      <button type="button" class="en-peligro" data-acc="descartar">Descartar sesión</button>
    </div>`;
}

// Confirmación destructiva sin confirm(): el mismo botón pide el segundo
// toque y vuelve solo a los 4 s. Un diálogo nativo en medio del gym es más
// fricción que protección.
// Devuelve true si ESTE botón ya estaba armado (segundo toque dentro de 4 s);
// si no, lo arma con su texto de aviso y devuelve false. El estado vive en el
// propio botón: dos botones destructivos no se pisan entre sí.
function armarDosToques(btn, texto) {
  if (btn.dataset.armado === '1') return true;
  const original = btn.textContent;
  btn.dataset.armado = '1';
  btn.textContent = texto;
  setTimeout(() => {
    if (btn.isConnected && btn.dataset.armado === '1') { delete btn.dataset.armado; btn.textContent = original; }
  }, 4000);
  return false;
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

// Región de avisos fuera de la raíz del módulo: el innerHTML de cada render no
// se la lleva, así "Descanso terminado" llega al lector de pantalla.
function anunciar(texto) {
  let el = document.getElementById('en-anuncio');
  if (!el) {
    el = document.createElement('div');
    el.id = 'en-anuncio'; el.className = 'en-sr';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = '';
  setTimeout(() => { el.textContent = texto; }, 60);
}

// El aviso de fin NO depende de qué vista esté pintada (barra, foco, ficha o
// biblioteca): se revisa en cada tic y suena una sola vez.
function revisarFinDescanso() {
  if (!descansoObj || avisadoFin || !descansoObj.haTerminado()) return;
  avisadoFin = true;
  avisarFin();
  if (sesion?.descanso?.micro) {
    const k = sesion.descanso.micro.k;
    empezarParteTrasMicro();
    cerrarBarraDescanso();
    anunciar(`Mini-serie ${k + 1}: ¡a darle!`);
    persistir();
    return;
  }
  anunciar('Descanso terminado. A darle.');
  if (sesion) {
    delete sesion.descanso;
    sesion.listoDesdeMs = Date.now();
    persistir();
  }
  // El aviso visual se queda unos segundos y se va solo: el gesto siguiente
  // del usuario es la serie, no cerrar una barra.
  timerOcultar = setTimeout(cerrarBarraDescanso, 5000);
}

function pintarDescanso() {
  revisarFinDescanso();
  const barra = ctx.raiz.querySelector('.en-descanso');
  if (!barra) return;
  if (!descansoObj) { barra.hidden = true; return; }
  barra.hidden = false;
  const fin = descansoObj.haTerminado();
  barra.querySelector('.en-d-tiempo').textContent = formatear(descansoObj.restanteS());
  barra.classList.toggle('en-d-fin', fin);
  barra.querySelector('.en-d-lbl').textContent = fin ? '¡A darle!' : sesion?.descanso?.micro ? 'micro-descanso' : 'descanso';
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
  const nSeries = (ses.ejercicios || []).reduce((a, e) => a + (e.series || []).filter(s => s.hecha && !esCalentamiento(s)).length, 0);
  const vol = volumenSesion(ses);

  const grupos = Object.entries(seriesPorGrupo(ses, porId)).sort((a, b) => b[1] - a[1]);
  const maxG = grupos.length ? grupos[0][1] : 1;

  // Récords: el mejor 1RM estimado (Epley, solo ≤10 reps) de cada ejercicio,
  // comparado contra TODO su historial previo. Siempre rotulado "estimado":
  // es una fórmula, no una barra levantada.
  const records = [];
  for (const ej of ses.ejercicios || []) {
    let mejor = null;
    for (const s of (ej.series || []).filter(x => x.hecha && !esCalentamiento(x))) {
      const rm = epley1RM(s.pesoKg, s.reps);
      if (rm !== null && (mejor === null || rm > mejor)) mejor = rm;
    }
    if (mejor === null) continue;
    let previo = null;
    for (const vieja of estado.entreno.sesiones) {
      if (vieja.id === ses.id) continue;
      const e2 = (vieja.ejercicios || []).find(x => x.idEjercicio === ej.idEjercicio);
      for (const s of (e2?.series || []).filter(x => x.hecha && !esCalentamiento(x))) {
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
          .map(s => textoSerie(s, unidad)).join(' · ') || 'sin series hechas'}</span>
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
    : `${ses.notas ? `<div class="en-sec-lbl">Notas</div><p class="en-notas-ro">${esc(ses.notas)}</p>` : ''}
       <div class="en-vivo-acciones"><button type="button" class="en-peligro" data-acc="borrar-sesion">Borrar del historial</button></div>`}
    <p class="en-aviso-storage" hidden>No se pudo guardar en este dispositivo. Exporta un respaldo desde Diario antes de cerrar.</p>
  </div>`;

  raiz.querySelector('.en-wrap').addEventListener('click', e => {
    const b = e.target.closest('[data-acc]');
    if (!b) return;
    const acc = b.dataset.acc;
    if (acc === 'cerrar') { verSesionId = null; render(); }
    else if (acc === 'borrar-sesion') {
      // Una sesión registrada por error contaminaba "la última vez" y el
      // progreso para siempre: se puede borrar (doble toque).
      if (!armarDosToques(b, 'Toca otra vez para borrarla')) return;
      const sid = ses.id;
      escribir(e => ({ ...e, entreno: { ...e.entreno, sesiones: e.entreno.sesiones.filter(x => x.id !== sid) } }));
      verSesionId = null;
      render();
    }
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
