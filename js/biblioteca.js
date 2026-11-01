// Biblioteca de ejercicios: agrupación en ejercicios maestros, filtros por
// casillas y orden por popularidad. Funciones puras (sin DOM) para que
// entreno.js solo pinte y los tests de Node las cubran.
//
// Dos niveles: maestro ("Press de banca") → grupo opcional ("Inclinado") →
// variantes con su etiqueta ("Mancuernas"). Los datos vienen de
// data/grupos-ejercicios.json; lo que no aparece ahí queda como maestro de
// una sola variante con el nombre del catálogo.

// Mismas reglas de acentos que el buscador: minúsculas + NFD sin diacríticos.
export function normalizar(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Equipo para filtrar. El catálogo original mete el Smith en "máquina" (y a
// veces en "barra") y la barra Z en "barra"; aquí cada uno es su casilla.
// "no especificado" y "otro" son la misma cosa para quien busca.
export function equipoDe(e) {
  const n = String(e?.nombre ?? '');
  if (/smith/i.test(n)) return 'Smith';
  if (/barra z\b/i.test(n)) return 'barra Z';
  if (!e?.equipo || e.equipo === 'no especificado') return 'otro';
  return e.equipo;
}

// Orden de las casillas: lo más buscado primero, no alfabético.
export const OPCIONES_FILTRO = {
  musculo: ['pecho', 'dorsales', 'espalda media', 'lumbar', 'trapecios', 'hombros', 'bíceps', 'tríceps',
    'antebrazos', 'abdomen', 'glúteos', 'cuádriceps', 'femorales', 'pantorrillas', 'aductores', 'abductores', 'cuello'],
  equipo: ['barra', 'mancuernas', 'máquina', 'polea', 'Smith', 'peso corporal', 'kettlebell', 'barra Z',
    'ligas', 'balón medicinal', 'pelota de estabilidad', 'rodillo', 'otro'],
  tipo: ['fuerza', 'estiramiento', 'cardio', 'pliometría', 'powerlifting', 'halterofilia', 'strongman'],
  nivel: ['principiante', 'intermedio', 'avanzado'],
};
export const NOMBRES_FILTRO = { musculo: 'Músculo', equipo: 'Equipo', tipo: 'Tipo', nivel: 'Nivel' };

export function filtrosVacios() {
  return { musculo: new Set(), equipo: new Set(), tipo: new Set(), nivel: new Set() };
}
export function cuentaFiltros(f) {
  return Object.values(f).reduce((n, s) => n + s.size, 0);
}

// Construye la lista de maestros a partir del catálogo y del archivo de
// grupos. Tolera un archivo ausente, con ids que ya no existen o con forma
// rota: un id perdido se salta y el ejercicio que falte queda suelto, nunca
// desaparece. Los «ocultos» (duplicados verificados) no se listan, pero
// siguen en el catálogo para las rutinas y el historial que ya los usan.
export function construirMaestros(catalogo, grupos) {
  try { return construir(catalogo, grupos); } catch { return construir(catalogo, null); }
}

function construir(catalogo, grupos) {
  const porId = new Map(catalogo.map(e => [e.id, e]));
  const usados = new Set(Array.isArray(grupos?.ocultos) ? grupos.ocultos : []);
  const maestros = [];
  const sueltosPop = grupos?.sueltos ?? {};
  let orden = 0;
  const variante = (v, m, g) => {
    const e = porId.get(v?.id);
    if (!e || usados.has(e.id)) return null;
    usados.add(e.id);
    const pop = Number.isFinite(v.pop) ? v.pop : 1;
    return { e, etiqueta: String(v.etiqueta || e.nombre), pop, orden: orden++,
      pajar: normalizar([m, g, v.etiqueta, e.nombre, e.nombreEn, ...(e.musculosPrimarios || []),
        ...(e.musculosSecundarios || []), equipoDe(e), e.equipo].filter(Boolean).join(' ')) };
  };
  for (const m of grupos?.maestros ?? []) {
    if (!m?.nombre) continue;
    const gs = [];
    if (Array.isArray(m.grupos)) {
      for (const g of m.grupos) {
        const vs = (g?.variantes ?? []).map(v => variante(v, m.nombre, g.nombre)).filter(Boolean);
        if (vs.length) gs.push({ nombre: String(g.nombre || ''), variantes: vs });
      }
    } else {
      const vs = (m.variantes ?? []).map(v => variante(v, m.nombre, '')).filter(Boolean);
      if (vs.length) gs.push({ nombre: '', variantes: vs });
    }
    if (gs.length) maestros.push(nuevoMaestro(m.nombre, gs));
  }
  for (const e of catalogo) {
    if (usados.has(e.id)) continue;
    const v = variante({ id: e.id, etiqueta: e.nombre, pop: sueltosPop[e.id] }, '', '');
    if (v) maestros.push(nuevoMaestro(e.nombre, [{ nombre: '', variantes: [v] }]));
  }
  return maestros;
}

function nuevoMaestro(nombre, grupos) {
  const vs = grupos.flatMap(g => g.variantes);
  // peso: suma de las 3 variantes más populares. Desempata maestros de igual
  // popularidad para que los básicos (press de banca, sentadilla, peso muerto)
  // salgan antes que un maestro con una sola variante popular.
  const peso = vs.map(v => v.pop).sort((a, b) => b - a).slice(0, 3).reduce((s, p) => s + p, 0);
  return { clave: normalizar(nombre), nombre: String(nombre), grupos,
    n: vs.length, pop: Math.max(...vs.map(v => v.pop)), peso, nombreN: normalizar(nombre) };
}

// ¿Pasa una variante los filtros? Dentro de un filtro las casillas suman
// (pecho O hombros); entre filtros se combinan (pecho Y mancuernas).
function pasaFiltros(e, f) {
  if (f.musculo.size && !(e.musculosPrimarios || []).some(m => f.musculo.has(m))) return false;
  if (f.equipo.size && !f.equipo.has(equipoDe(e))) return false;
  if (f.tipo.size && !f.tipo.has(e.categoria)) return false;
  if (f.nivel.size && !f.nivel.has(e.nivel)) return false;
  return true;
}

const porPop = (a, b) => b.pop - a.pop || a.orden - b.orden;

// Devuelve los maestros que tienen al menos una variante que pasa el texto y
// los filtros, con SOLO esas variantes adentro y ordenados:
//   1) el nombre del maestro empieza con lo escrito, 2) lo contiene,
//   3) solo alguna variante coincide; y a igualdad, lo más popular primero
//   (con el peso del maestro como desempate).
// Dentro, grupos y variantes también van por popularidad.
export function buscarMaestros(maestros, consulta, filtros) {
  const q = normalizar(String(consulta ?? '').trim());
  const tokens = q ? q.split(/\s+/) : [];
  const f = filtros ?? filtrosVacios();
  const res = [];
  for (const m of maestros) {
    const grupos = [];
    for (const g of m.grupos) {
      const vs = g.variantes.filter(v => pasaFiltros(v.e, f) && tokens.every(t => v.pajar.includes(t)));
      if (vs.length) grupos.push({ nombre: g.nombre, variantes: vs.sort(porPop), pop: Math.max(...vs.map(v => v.pop)) });
    }
    if (!grupos.length) continue;
    grupos.sort((a, b) => b.pop - a.pop);
    const puntos = !q ? 0 : m.nombreN.startsWith(q) ? 2 : tokens.every(t => m.nombreN.includes(t)) ? 1 : 0;
    const n = grupos.reduce((s, g) => s + g.variantes.length, 0);
    res.push({ m, grupos, n, puntos, pop: Math.max(...grupos.map(g => g.pop)) });
  }
  return res.sort((a, b) => b.puntos - a.puntos || b.pop - a.pop || b.m.peso - a.m.peso
    || a.m.nombre.localeCompare(b.m.nombre, 'es'));
}
