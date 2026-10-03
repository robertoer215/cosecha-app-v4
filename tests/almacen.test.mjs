// Tests del almacén local (js/almacen.js) — correr con: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSION, CLAVE, estadoInicial, migrar, cargar, guardar,
  exportarJSON, importarJSON, hoyISO, comidaPorHora,
  agregarAlDiario, quitarDelDiario, editarEnDiario,
  guardarPerfil, guardarMetaCache, guardarSesionActiva, cerrarSesion, guardarRutina
} from '../js/almacen.js';

// Entrada CANÓNICA del diario: todos los campos del esquema, como la crea
// app.js. Los tests de ciclo exportar→importar dependen de esta forma.
function entrada(id, extra = {}) {
  return {
    id, nombre: `Alimento ${id}`, gramos: 120, porcion: null,
    macros: { prot: 30, carb: 10, gras: 5, kcalFuente: 205 },
    origen: 'base', ts: 1700000000000,
    ...extra
  };
}

// Storage falso en memoria: misma interfaz que localStorage, sin navegador.
function storageFalso() {
  const datos = {};
  return {
    getItem: k => (k in datos ? datos[k] : null),
    setItem: (k, v) => { datos[k] = String(v); },
    datos
  };
}

const PERFIL = {
  sexo: 'masculino', edad: 25, peso: 75, altura: 175,
  actividad: 'moderado', objetivo: 'mantener', comidas: 3,
  unidadPeso: 'kg', comidasDiario: null,
  // Preferencias de UI que migrar() conserva con defaults deterministas.
  terminos: false, modo: 'calc', subModo: 'comida', manual: null,
  actualizado: 1700000000000
};

// ---------- estadoInicial ----------

test('estadoInicial: forma v1 completa y objetos frescos en cada llamada', () => {
  const a = estadoInicial();
  assert.deepEqual(a, {
    v: VERSION, perfil: null, metaCache: null, diario: {},
    entreno: { rutinas: [], sesiones: [], sesionActiva: null },
    recientes: { alimentos: [], ejercicios: [] },
    preferencias: { unidadPeso: 'kg' }
  });
  // Si dos llamadas compartieran referencias, mutar una contaminaría la otra.
  const b = estadoInicial();
  a.entreno.rutinas.push('x');
  assert.equal(b.entreno.rutinas.length, 0);
});

// ---------- migrar: basura y versiones ----------

test('migrar: cualquier basura degrada a estado inicial sin lanzar', () => {
  for (const basura of [null, undefined, 42, 'cadena', true, [], [1, 2], () => {}, Symbol('x')]) {
    assert.deepEqual(migrar(basura), estadoInicial(), `falló con ${String(basura)}`);
  }
});

test('migrar: v1 parcial rescata lo válido y completa lo que falta', () => {
  const crudo = {
    v: 1,
    diario: {
      '2026-10-01': {
        desayuno: [entrada('p01'), 'basura', { nombre: 7 }, null],
        cena: 'no soy un array'
        // sin comida ni colaciones: deben nacer vacías
      },
      'no-es-fecha': { desayuno: [entrada('x')] },
      '2026-10-02': { desayuno: ['solo', 'basura'] } // sin nada rescatable: fuera
    }
  };
  const m = migrar(crudo);
  assert.deepEqual(Object.keys(m.diario), ['2026-10-01']);
  const dia = m.diario['2026-10-01'];
  assert.equal(dia.desayuno.length, 1);
  assert.equal(dia.desayuno[0].id, 'p01');
  assert.deepEqual(dia.comida, []);
  assert.deepEqual(dia.cena, []);
  assert.deepEqual(dia.colaciones, []);
  assert.equal(m.perfil, null);
  assert.deepEqual(m.entreno, { rutinas: [], sesiones: [], sesionActiva: null });
});

test('migrar: una versión FUTURA degrada rescatando lo que siga en forma v1', () => {
  const m = migrar({
    v: 9, campoDelFuturo: { x: 1 },
    perfil: PERFIL,
    entreno: { rutinas: [{ id: 'r1', nombre: 'Empuje' }, { sinId: true }], sesiones: [{ id: 's1' }], sesionActiva: null }
  });
  assert.equal(m.v, 1);
  assert.deepEqual(m.perfil, PERFIL);
  assert.deepEqual(m.entreno.rutinas, [{ id: 'r1', nombre: 'Empuje' }]); // sin id no se puede reemplazar: fuera
  // sesionSegura() normaliza: una sesión sin ejercicios reconocibles queda con lista vacía.
  assert.deepEqual(m.entreno.sesiones, [{ id: 's1', ejercicios: [] }]);
  assert.equal('campoDelFuturo' in m, false);
});

test('migrar: perfil incompleto o corrupto cae a null; unidadPeso se normaliza', () => {
  assert.equal(migrar({ perfil: { sexo: 'masculino', peso: 75 } }).perfil, null); // faltan campos de calcularMeta
  assert.equal(migrar({ perfil: { ...PERFIL, peso: 'mucho' } }).perfil, null);
  assert.equal(migrar({ perfil: { ...PERFIL, unidadPeso: 'stones' } }).perfil.unidadPeso, 'kg');
  assert.equal(migrar({ perfil: { ...PERFIL, unidadPeso: 'lb' } }).perfil.unidadPeso, 'lb');
});

test('migrar: metaCache con un macro corrupto se tira entera', () => {
  assert.equal(migrar({ metaCache: { kcal: 700, prot: 'x', carb: 80, gras: 20 } }).metaCache, null);
  const ok = migrar({ metaCache: { kcal: 700, prot: 45, carb: 80, gras: 20, comidas: 3, origen: 'formula' } }).metaCache;
  assert.deepEqual(ok, { kcal: 700, prot: 45, carb: 80, gras: 20, comidas: 3, origen: 'formula' });
});

test('migrar: entrada rellena kcalFuente (4P+4C+9G), normaliza origen y usa el nombre como id de respaldo', () => {
  const m = migrar({
    diario: { '2026-10-01': { comida: [{ nombre: 'Pollo', gramos: 150, macros: { prot: 40, carb: 0, gras: 6 }, origen: 'raro', porcion: { nombre: 'pieza' } }] } }
  });
  const e = m.diario['2026-10-01'].comida[0];
  assert.equal(e.id, 'Pollo');
  assert.equal(e.macros.kcalFuente, 40 * 4 + 0 * 4 + 6 * 9);
  assert.equal(e.origen, 'base');
  assert.equal(e.porcion, null); // porción sin gramos no sirve para recalcular: fuera
  assert.equal(e.ts, 0);
});

test('migrar: recientes deduplica, tira lo que no es id y corta a 30', () => {
  const lista = Array.from({ length: 40 }, (_, i) => `a${i}`);
  const m = migrar({ recientes: { alimentos: ['a1', 'a1', 7, null, '', ...lista], ejercicios: 'basura' } });
  assert.equal(m.recientes.alimentos.length, 30);
  assert.equal(m.recientes.alimentos[0], 'a1');
  assert.equal(new Set(m.recientes.alimentos).size, 30);
  assert.deepEqual(m.recientes.ejercicios, []);
});

// ---------- cargar / guardar ----------

test('cargar: storage vacío, JSON corrupto o storage que lanza → estado inicial', () => {
  assert.deepEqual(cargar(storageFalso()), estadoInicial());
  const roto = storageFalso();
  roto.setItem(CLAVE, '{esto no es json');
  assert.deepEqual(cargar(roto), estadoInicial());
  assert.deepEqual(cargar({ getItem() { throw new Error('bloqueado'); } }), estadoInicial());
});

test('guardar→cargar: ciclo completo bajo CLAVE, y false si el storage lanza', () => {
  const st = storageFalso();
  const estado = agregarAlDiario(estadoInicial(), '2026-10-01', 'comida', entrada('p01'));
  assert.equal(guardar(estado, st), true);
  assert.ok(st.datos[CLAVE].includes('p01'));
  assert.deepEqual(cargar(st), estado);
  assert.equal(guardar(estado, { setItem() { throw new Error('cuota llena'); } }), false);
});

// ---------- exportar / importar ----------

test('exportar→importar: el ciclo devuelve un estado IDÉNTICO', () => {
  let estado = estadoInicial();
  estado = guardarPerfil(estado, PERFIL);
  estado = guardarMetaCache(estado, { kcal: 751, prot: 40, carb: 86, gras: 27, comidas: 3, origen: 'formula' });
  estado = agregarAlDiario(estado, '2026-10-01', 'desayuno', entrada('p01', { porcion: { nombre: 'taza', g: 120 } }));
  estado = agregarAlDiario(estado, '2026-10-01', 'cena', entrada('c01', { origen: 'plato' }));
  estado = guardarRutina(estado, { id: 'r1', nombre: 'Empuje', ejercicios: [{ id: 'press-banca', series: 4 }] });
  estado = cerrarSesion(estado, { id: 's1', rutinaId: 'r1', inicio: 1700000000000, fin: 1700003600000, ejercicios: [{ id: 'press-banca', series: [{ reps: 8, kg: 60 }] }] });
  const texto = exportarJSON(estado);
  // El sobre es legible (sangría) y declara versión y fecha ISO.
  const sobre = JSON.parse(texto);
  assert.equal(sobre.v, VERSION);
  assert.ok(!Number.isNaN(Date.parse(sobre.exportado)));
  assert.ok(texto.includes('\n  '));
  assert.deepEqual(importarJSON(texto), estado);
});

test('importarJSON: lanza Error con mensaje en español si el texto no es importable', () => {
  for (const malo of ['{roto', '42', '"cadena"', 'null', '[]']) {
    assert.throws(() => importarJSON(malo), err =>
      err instanceof Error && /COSECHA/.test(err.message) && /[a-záéíóú]/.test(err.message));
  }
});

test('importarJSON: también acepta un estado pelado, sin el sobre de exportación', () => {
  const estado = agregarAlDiario(estadoInicial(), '2026-10-01', 'comida', entrada('p01'));
  assert.deepEqual(importarJSON(JSON.stringify(estado)), estado);
});

// ---------- hora local ----------

test('hoyISO: fecha LOCAL, también a las 23:59 (toISOString diría "mañana")', () => {
  assert.equal(hoyISO(new Date(2026, 9, 1, 23, 59).getTime()), '2026-10-01');
  assert.equal(hoyISO(new Date(2026, 0, 5, 0, 0).getTime()), '2026-01-05');
  assert.match(hoyISO(), /^\d{4}-\d{2}-\d{2}$/); // sin ms usa el reloj
});

test('comidaPorHora: los cuatro cortes exactos en hora local', () => {
  const a = (h, m) => comidaPorHora(new Date(2026, 9, 1, h, m).getTime());
  assert.equal(a(0, 0), 'desayuno');
  assert.equal(a(11, 29), 'desayuno');
  assert.equal(a(11, 30), 'comida');   // el corte pertenece a la franja siguiente
  assert.equal(a(16, 59), 'comida');
  assert.equal(a(17, 0), 'cena');
  assert.equal(a(21, 59), 'cena');
  assert.equal(a(22, 0), 'colaciones');
  assert.equal(a(23, 59), 'colaciones');
});

// ---------- diario ----------

test('agregarAlDiario: crea el día, agrega la entrada y NO muta el estado original', () => {
  const antes = estadoInicial();
  const despues = agregarAlDiario(antes, '2026-10-01', 'comida', entrada('p01'));
  assert.deepEqual(antes, estadoInicial()); // el original quedó intacto
  assert.notEqual(antes, despues);
  assert.equal(despues.diario['2026-10-01'].comida[0].id, 'p01');
  assert.deepEqual(despues.diario['2026-10-01'].desayuno, []);
  assert.deepEqual(despues.recientes.alimentos, ['p01']);
});

test('agregarAlDiario: una franja desconocida cae a colaciones en vez de perderse', () => {
  const e = agregarAlDiario(estadoInicial(), '2026-10-01', 'merienda', entrada('p01'));
  assert.equal(e.diario['2026-10-01'].colaciones[0].id, 'p01');
});

test('quitarDelDiario: quita por índice; fuera de rango devuelve el MISMO estado', () => {
  let e = agregarAlDiario(estadoInicial(), '2026-10-01', 'comida', entrada('p01'));
  e = agregarAlDiario(e, '2026-10-01', 'comida', entrada('p02'));
  const sinUno = quitarDelDiario(e, '2026-10-01', 'comida', 0);
  assert.equal(e.diario['2026-10-01'].comida.length, 2); // inmutable
  assert.deepEqual(sinUno.diario['2026-10-01'].comida.map(x => x.id), ['p02']);
  // La misma referencia señala "nada que repintar":
  assert.equal(quitarDelDiario(e, '2026-10-01', 'comida', 5), e);
  assert.equal(quitarDelDiario(e, '2026-10-01', 'comida', -1), e);
  assert.equal(quitarDelDiario(e, '2026-12-25', 'comida', 0), e);
});

test('editarEnDiario: fusiona cambios sin borrar los macros no tocados', () => {
  const e = agregarAlDiario(estadoInicial(), '2026-10-01', 'cena', entrada('p01'));
  const editado = editarEnDiario(e, '2026-10-01', 'cena', 0, { gramos: 200, macros: { prot: 50 } });
  const ent = editado.diario['2026-10-01'].cena[0];
  assert.equal(ent.gramos, 200);
  assert.equal(ent.macros.prot, 50);
  assert.equal(ent.macros.carb, 10);  // no se tocó: sigue
  assert.equal(ent.macros.gras, 5);
  assert.equal(ent.nombre, 'Alimento p01');
  assert.equal(e.diario['2026-10-01'].cena[0].gramos, 120); // original intacto
  assert.equal(editarEnDiario(e, '2026-10-01', 'cena', 9, { gramos: 1 }), e);
});

test('recientes: dedupe al frente y tope de 30', () => {
  let e = estadoInicial();
  for (let i = 0; i < 35; i++) e = agregarAlDiario(e, '2026-10-01', 'comida', entrada(`a${i}`));
  assert.equal(e.recientes.alimentos.length, 30);
  assert.equal(e.recientes.alimentos[0], 'a34'); // el último registrado, primero
  assert.equal(e.recientes.alimentos.includes('a0'), false); // los viejos salen
  // Repetir un alimento lo SUBE, no lo duplica:
  e = agregarAlDiario(e, '2026-10-01', 'cena', entrada('a20'));
  assert.equal(e.recientes.alimentos[0], 'a20');
  assert.equal(e.recientes.alimentos.filter(x => x === 'a20').length, 1);
});

// ---------- perfil y meta ----------

test('guardarPerfil: respeta el actualizado que viene; sella uno si falta', () => {
  const con = guardarPerfil(estadoInicial(), PERFIL);
  assert.deepEqual(con.perfil, PERFIL);
  const { actualizado, ...sinSello } = PERFIL;
  const antes = Date.now();
  const sin = guardarPerfil(estadoInicial(), sinSello);
  assert.ok(sin.perfil.actualizado >= antes && sin.perfil.actualizado <= Date.now());
});

test('guardarMetaCache: persiste la meta POR COMIDA tal cual llega de app.js', () => {
  const meta = { kcal: 751, prot: 40, carb: 86, gras: 27, comidas: 3, origen: 'formula' };
  const e = guardarMetaCache(estadoInicial(), meta);
  assert.deepEqual(e.metaCache, meta);
  assert.equal(guardarMetaCache(e, null).metaCache, null); // null limpia
});

// ---------- entrenamiento ----------

test('guardarSesionActiva: guarda la sesión en curso y null la limpia', () => {
  const sesion = { id: 's1', rutinaId: 'r1', inicio: 1700000000000, ejercicios: [] };
  const con = guardarSesionActiva(estadoInicial(), sesion);
  assert.deepEqual(con.entreno.sesionActiva, sesion);
  assert.equal(guardarSesionActiva(con, null).entreno.sesionActiva, null);
});

test('cerrarSesion: archiva la sesión, limpia la activa y alimenta recientes.ejercicios', () => {
  const sesion = {
    id: 's1', rutinaId: 'r1', inicio: 1700000000000, fin: 1700003600000,
    ejercicios: [{ id: 'press-banca', series: [] }, { id: 'remo', series: [] }]
  };
  const antes = guardarSesionActiva(estadoInicial(), sesion);
  const despues = cerrarSesion(antes, sesion);
  assert.deepEqual(despues.entreno.sesiones, [sesion]);
  assert.equal(despues.entreno.sesionActiva, null);
  // El último ejercicio de la sesión queda al frente de las sugerencias:
  assert.deepEqual(despues.recientes.ejercicios, ['remo', 'press-banca']);
  assert.deepEqual(antes.entreno.sesiones, []); // inmutable
  // Cerrar otra sesión APILA, no reemplaza:
  const otra = cerrarSesion(despues, { id: 's2', ejercicios: [{ id: 'sentadilla' }] });
  assert.deepEqual(otra.entreno.sesiones.map(s => s.id), ['s1', 's2']);
  assert.deepEqual(otra.recientes.ejercicios, ['sentadilla', 'remo', 'press-banca']);
});

test('guardarRutina: alta al final y reemplazo por id SIN reordenar', () => {
  let e = guardarRutina(estadoInicial(), { id: 'r1', nombre: 'Empuje' });
  e = guardarRutina(e, { id: 'r2', nombre: 'Jalón' });
  const antes = e;
  e = guardarRutina(e, { id: 'r1', nombre: 'Empuje v2' });
  assert.deepEqual(e.entreno.rutinas.map(r => [r.id, r.nombre]), [['r1', 'Empuje v2'], ['r2', 'Jalón']]);
  assert.equal(antes.entreno.rutinas[0].nombre, 'Empuje'); // inmutable
});

test('preferencias: la unidad de peso vive aparte del perfil y se hereda del perfil viejo', () => {
  assert.equal(migrar({ preferencias: { unidadPeso: 'lb' } }).preferencias.unidadPeso, 'lb');
  assert.equal(migrar({ perfil: { unidadPeso: 'lb' } }).preferencias.unidadPeso, 'lb');
  assert.equal(migrar({ preferencias: { unidadPeso: 'stones' } }).preferencias.unidadPeso, 'kg');
});

test('importarJSON: una sesión sin id (respaldo manipulado) no cuela ni cuenta como dato', () => {
  assert.throws(() => importarJSON(JSON.stringify({ entreno: { sesiones: [{}] } })), /no trae datos/);
});
