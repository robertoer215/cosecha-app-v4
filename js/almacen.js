// ─────────────────────────────────────────────────────────────────────────────
// ALMACÉN LOCAL — la única puerta a localStorage de COSECHA App.
//
// Regla de la casa: los datos NUNCA salen del dispositivo. Diario y Entrenar
// leen y escriben SOLO a través de este módulo; nadie más toca localStorage.
// Todo mutador devuelve un estado NUEVO (inmutabilidad): app.js puede comparar
// por referencia para decidir si repinta, y un bug de render jamás corrompe lo
// guardado. Las funciones son puras salvo cargar/guardar (el borde con el
// navegador, siempre en try/catch: modo privado, datos bloqueados o cuota
// llena degradan a estado limpio, nunca a pantalla rota).
//
// La meta nutricional NO se calcula aquí: sale de calcularMeta()/mac() de
// calc.js; app.js escribe el resultado en metaCache y este módulo solo lo
// persiste. kcalFuente en las entradas es dato de respaldo: las kcal MOSTRADAS
// siempre se derivan 4P+4C+9G al pintar, igual que en el panel de meta.
// ─────────────────────────────────────────────────────────────────────────────

export const VERSION = 1;
export const CLAVE = 'cosecha.v1';

// Las cuatro franjas del diario. El orden importa: es el orden de render.
const COMIDAS = ['desayuno', 'comida', 'cena', 'colaciones'];

// Tope de recientes: 30 cubre semanas de uso real sin que la lista de
// sugerencias crezca sin límite ni el JSON guardado engorde para siempre.
const RECIENTES_TOPE = 30;

const esObjeto = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const esNumero = x => Number.isFinite(x);

// ── Estado inicial ───────────────────────────────────────────────────────────

// Siempre objetos frescos: un estado inicial compartido entre llamadas sería
// un canal oculto de mutación entre pantallas.
export function estadoInicial() {
  return {
    v: VERSION,
    perfil: null,
    metaCache: null,
    diario: {},
    entreno: { rutinas: [], sesiones: [], sesionActiva: null },
    recientes: { alimentos: [], ejercicios: [] }
  };
}

function diaVacio() {
  return { desayuno: [], comida: [], cena: [], colaciones: [] };
}

// ── Migración: cualquier basura → estado v1 válido ──────────────────────────
//
// migrar() NUNCA lanza: lo que hay en localStorage pudo escribirlo una versión
// vieja, una futura o una extensión ajena. Se reconstruye campo a campo y lo
// que no valide se descarta en silencio; el peor caso es empezar de cero, que
// es exactamente lo que haría un usuario nuevo. Por eso no se mira `v` para
// rechazar: una versión futura se degrada rescatando lo que siga teniendo la
// forma v1.

function migrarPerfil(p) {
  if (!esObjeto(p)) return null;
  // Sin estos campos calcularMeta() no puede correr: un perfil a medias no
  // sirve de nada y es mejor volver a preguntar que calcular con basura.
  const validos = typeof p.sexo === 'string'
    && esNumero(p.edad) && p.edad > 0
    && esNumero(p.peso) && p.peso > 0
    && esNumero(p.altura) && p.altura > 0
    && typeof p.actividad === 'string'
    && typeof p.objetivo === 'string'
    && esNumero(p.comidas) && p.comidas > 0;
  if (!validos) return null;
  return {
    sexo: p.sexo, edad: p.edad, peso: p.peso, altura: p.altura,
    actividad: p.actividad, objetivo: p.objetivo, comidas: p.comidas,
    unidadPeso: p.unidadPeso === 'lb' ? 'lb' : 'kg',
    comidasDiario: esNumero(p.comidasDiario) && p.comidasDiario > 0 ? p.comidasDiario : null,
    // 0 = "no sabemos cuándo": determinista, y la UI lo trata como "hace tiempo".
    actualizado: esNumero(p.actualizado) ? p.actualizado : 0
  };
}

function migrarMetaCache(m) {
  if (!esObjeto(m)) return null;
  // La meta es POR COMIDA y la escribe app.js desde calcularMeta()/manual.
  // Con un macro corrupto se tira entera: app.js la recalcula del perfil.
  if (!esNumero(m.kcal) || !esNumero(m.prot) || !esNumero(m.carb) || !esNumero(m.gras)) return null;
  return {
    kcal: m.kcal, prot: m.prot, carb: m.carb, gras: m.gras,
    comidas: esNumero(m.comidas) && m.comidas > 0 ? m.comidas : null,
    origen: typeof m.origen === 'string' ? m.origen : 'formula'
  };
}

function migrarEntrada(e) {
  if (!esObjeto(e) || typeof e.nombre !== 'string' || e.nombre === '') return null;
  if (!esObjeto(e.macros)) return null;
  const { prot, carb, gras } = e.macros;
  // Sin los tres macros la entrada no suma al tracker: no es rescatable.
  if (!esNumero(prot) || !esNumero(carb) || !esNumero(gras)) return null;
  return {
    // El id alimenta recientes y el dedupe; si falta, el nombre hace de id
    // estable (dos "Pollo" son el mismo alimento para las sugerencias).
    id: typeof e.id === 'string' && e.id !== '' ? e.id : e.nombre,
    nombre: e.nombre,
    gramos: esNumero(e.gramos) && e.gramos >= 0 ? e.gramos : 0,
    porcion: esObjeto(e.porcion) && typeof e.porcion.nombre === 'string' && esNumero(e.porcion.g)
      ? { nombre: e.porcion.nombre, g: e.porcion.g }
      : null,
    macros: {
      prot, carb, gras,
      // kcalFuente es respaldo (etiqueta del producto); si falta se deriva
      // 4P+4C+9G, la misma regla con la que se pinta.
      kcalFuente: esNumero(e.macros.kcalFuente) ? e.macros.kcalFuente : prot * 4 + carb * 4 + gras * 9
    },
    origen: e.origen === 'plato' ? 'plato' : 'base',
    ts: esNumero(e.ts) ? e.ts : 0
  };
}

function migrarDiario(d) {
  const limpio = {};
  if (!esObjeto(d)) return limpio;
  for (const [fecha, dia] of Object.entries(d)) {
    // Solo claves con forma de fecha: cualquier otra cosa es basura ajena.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !esObjeto(dia)) continue;
    const nuevo = diaVacio();
    let conAlgo = false;
    for (const comida of COMIDAS) {
      if (!Array.isArray(dia[comida])) continue;
      nuevo[comida] = dia[comida].map(migrarEntrada).filter(e => e !== null);
      conAlgo = conAlgo || nuevo[comida].length > 0;
    }
    // Un día sin ninguna entrada rescatable no se guarda: solo abulta el JSON.
    if (conAlgo) limpio[fecha] = nuevo;
  }
  return limpio;
}

function migrarEntreno(e) {
  if (!esObjeto(e)) return { rutinas: [], sesiones: [], sesionActiva: null };
  return {
    // Rutinas sin id no se pueden editar ni borrar (guardarRutina reemplaza
    // por id): fuera. Sesiones y sesión activa pasan tal cual si son objetos;
    // su forma interna la define Entrenar y aquí no se recorta.
    rutinas: Array.isArray(e.rutinas) ? e.rutinas.filter(r => esObjeto(r) && r.id !== undefined) : [],
    sesiones: Array.isArray(e.sesiones) ? e.sesiones.filter(esObjeto) : [],
    sesionActiva: esObjeto(e.sesionActiva) ? e.sesionActiva : null
  };
}

function migrarRecientes(r) {
  const limpiar = lista => Array.isArray(lista)
    ? [...new Set(lista.filter(id => typeof id === 'string' && id !== ''))].slice(0, RECIENTES_TOPE)
    : [];
  if (!esObjeto(r)) return { alimentos: [], ejercicios: [] };
  return { alimentos: limpiar(r.alimentos), ejercicios: limpiar(r.ejercicios) };
}

export function migrar(crudo) {
  if (!esObjeto(crudo)) return estadoInicial();
  return {
    v: VERSION,
    perfil: migrarPerfil(crudo.perfil),
    metaCache: migrarMetaCache(crudo.metaCache),
    diario: migrarDiario(crudo.diario),
    entreno: migrarEntreno(crudo.entreno),
    recientes: migrarRecientes(crudo.recientes)
  };
}

// ── Cargar / guardar: el borde con el navegador ──────────────────────────────

export function cargar(storage) {
  try {
    const st = storage ?? globalThis.localStorage;
    const crudo = st.getItem(CLAVE);
    if (crudo === null || crudo === undefined) return estadoInicial();
    return migrar(JSON.parse(crudo));
  } catch {
    // Modo privado, JSON corrupto o storage bloqueado: la app arranca limpia
    // en vez de romperse. Es la misma promesa que migrar(): nunca lanzar.
    return estadoInicial();
  }
}

export function guardar(estado, storage) {
  try {
    const st = storage ?? globalThis.localStorage;
    st.setItem(CLAVE, JSON.stringify(estado));
    return true;
  } catch {
    // Cuota llena o storage bloqueado. Se avisa con false: app.js decide si
    // enseña el aviso de "no pude guardar"; aquí no hay UI.
    return false;
  }
}

// ── Exportar / importar: el respaldo es del usuario ──────────────────────────
//
// Como los datos nunca salen del dispositivo, el único respaldo posible es un
// archivo que el usuario se lleva. Va con sangría: es SU archivo y debe poder
// abrirlo y entenderlo.

export function exportarJSON(estado) {
  return JSON.stringify({ v: VERSION, exportado: new Date().toISOString(), estado }, null, 2);
}

export function importarJSON(texto) {
  let crudo;
  try {
    crudo = JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es un respaldo válido de COSECHA. Revisa que sea el archivo exportado desde la app, sin editar.');
  }
  if (!esObjeto(crudo)) {
    throw new Error('El archivo no trae datos de COSECHA. Exporta de nuevo desde Ajustes e intenta otra vez.');
  }
  // Se acepta el sobre de exportarJSON ({ v, exportado, estado }) y también un
  // estado pelado: si alguien guarda solo la parte interna, igual se rescata.
  return migrar(esObjeto(crudo.estado) ? crudo.estado : crudo);
}

// ── Fecha y franja en hora LOCAL ─────────────────────────────────────────────
//
// `ms` inyectable para poder testear los cortes sin depender del reloj.
// Nunca toISOString(): eso es UTC y a las 7pm en México ya sería "mañana".

export function hoyISO(ms) {
  const d = ms === undefined ? new Date() : new Date(ms);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Franja sugerida según la hora: el usuario registra "lo que acaba de comer",
// así que la app propone la comida en curso y él puede cambiarla.
export function comidaPorHora(ms) {
  const d = ms === undefined ? new Date() : new Date(ms);
  const min = d.getHours() * 60 + d.getMinutes();
  if (min < 11 * 60 + 30) return 'desayuno';
  if (min < 17 * 60) return 'comida';
  if (min < 22 * 60) return 'cena';
  return 'colaciones';
}

// ── Diario ───────────────────────────────────────────────────────────────────

// Dedupe con orden "más reciente primero": registrar algo lo sube al frente
// aunque ya estuviera, y el tope evita que la lista crezca para siempre.
function empujarReciente(lista, id) {
  if (typeof id !== 'string' || id === '') return lista;
  return [id, ...lista.filter(x => x !== id)].slice(0, RECIENTES_TOPE);
}

export function agregarAlDiario(estado, fechaISO, comida, entrada) {
  // Franja desconocida → colaciones: mejor registrar donde sea visible que
  // perder la entrada o lanzar desde el almacén.
  const franja = COMIDAS.includes(comida) ? comida : 'colaciones';
  const dia = estado.diario[fechaISO] ?? diaVacio();
  return {
    ...estado,
    diario: {
      ...estado.diario,
      [fechaISO]: { ...dia, [franja]: [...dia[franja], entrada] }
    },
    recientes: {
      ...estado.recientes,
      alimentos: empujarReciente(estado.recientes.alimentos, entrada.id)
    }
  };
}

export function quitarDelDiario(estado, fechaISO, comida, indice) {
  const dia = estado.diario[fechaISO];
  // Sin día, sin franja o índice fuera de rango: se devuelve el MISMO estado,
  // así app.js sabe por referencia que no hay nada que repintar.
  if (!dia || !Array.isArray(dia[comida]) || indice < 0 || indice >= dia[comida].length) return estado;
  return {
    ...estado,
    diario: {
      ...estado.diario,
      [fechaISO]: { ...dia, [comida]: dia[comida].filter((_, i) => i !== indice) }
    }
  };
}

export function editarEnDiario(estado, fechaISO, comida, indice, cambios) {
  const dia = estado.diario[fechaISO];
  if (!dia || !Array.isArray(dia[comida]) || indice < 0 || indice >= dia[comida].length) return estado;
  const actual = dia[comida][indice];
  // Fusión superficial, con macros un nivel más adentro: editar los gramos no
  // debe borrar prot/carb/gras, y editar un macro no debe borrar los otros.
  const editada = {
    ...actual,
    ...cambios,
    macros: cambios.macros ? { ...actual.macros, ...cambios.macros } : actual.macros
  };
  return {
    ...estado,
    diario: {
      ...estado.diario,
      [fechaISO]: { ...dia, [comida]: dia[comida].map((e, i) => i === indice ? editada : e) }
    }
  };
}

// ── Perfil y meta ────────────────────────────────────────────────────────────

export function guardarPerfil(estado, perfil) {
  // `actualizado` respeta el que venga (tests y migraciones lo traen); si no,
  // se sella aquí para que la UI pueda decir "revisa tu perfil" con el tiempo.
  return { ...estado, perfil: { ...perfil, actualizado: perfil.actualizado ?? Date.now() } };
}

export function guardarMetaCache(estado, meta) {
  // La meta llega YA calculada (calcularMeta()/manual, POR COMIDA) desde
  // app.js: aquí no hay fórmulas, solo persistencia.
  return { ...estado, metaCache: meta };
}

// ── Entrenamiento ────────────────────────────────────────────────────────────

export function guardarSesionActiva(estado, sesion) {
  // null limpia: es como se descarta una sesión empezada por error.
  return { ...estado, entreno: { ...estado.entreno, sesionActiva: sesion } };
}

export function cerrarSesion(estado, sesion) {
  // Se archiva la sesión que llega como argumento (trae las últimas series
  // tecleadas), no la copia de sesionActiva, que puede estar un render atrás.
  let recientes = estado.recientes.ejercicios;
  if (Array.isArray(sesion.ejercicios)) {
    // El último ejercicio hecho queda al frente de las sugerencias: se empuja
    // en orden, así el final de la sesión gana la primera posición.
    for (const ej of sesion.ejercicios) {
      if (esObjeto(ej)) recientes = empujarReciente(recientes, ej.id);
    }
  }
  return {
    ...estado,
    entreno: {
      ...estado.entreno,
      sesiones: [...estado.entreno.sesiones, sesion],
      sesionActiva: null
    },
    recientes: { ...estado.recientes, ejercicios: recientes }
  };
}

export function guardarRutina(estado, rutina) {
  const existe = estado.entreno.rutinas.some(r => r.id === rutina.id);
  return {
    ...estado,
    entreno: {
      ...estado.entreno,
      // Reemplazo en sitio para no reordenar la lista del usuario; alta al final.
      rutinas: existe
        ? estado.entreno.rutinas.map(r => r.id === rutina.id ? rutina : r)
        : [...estado.entreno.rutinas, rutina]
    }
  };
}
