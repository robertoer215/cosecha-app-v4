// Tests de las funciones puras de js/entreno.js. Todo con fixtures inline:
// el módulo importa almacen.js y temporizador.js, que ya cargan limpio en
// Node (capa de navegador con detección de capacidades), así que basta
// node --test. El DOM solo vive dentro de initEntreno y aquí no se toca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epley1RM, volumenSesion, seriesPorGrupo, ultimaVez,
         debeArrancarDescanso, aKg, siguientePendiente, mejorSerie, resumenEjercicio, historialEjercicio,
         recordsEjercicio, prsPorEjercicio, estadisticasPeriodo, cambioPct } from '../js/entreno.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const serie = (reps, pesoKg, hecha = true) => ({ reps, pesoKg, rir: null, hecha, tsHecha: hecha ? 1 : null });

function sesionCon(ejercicios, extra = {}) {
  return { id: 'S-1', inicioMs: 0, finMs: null, rutinaId: null, notas: '', ejercicios, ...extra };
}

const CATALOGO = new Map([
  ['press-banca', { id: 'press-banca', nombre: 'Press banca', musculosPrimarios: ['pecho'], musculosSecundarios: ['tríceps'] }],
  ['sentadilla', { id: 'sentadilla', nombre: 'Sentadilla', musculosPrimarios: ['cuádriceps'], musculosSecundarios: [] }],
  ['laterales', { id: 'laterales', nombre: 'Laterales', musculosPrimarios: ['hombros'], musculosSecundarios: [] }]
]);

// ── epley1RM ─────────────────────────────────────────────────────────────────

test('epley1RM: peso × (1 + reps/30), a décima de kg', () => {
  assert.equal(epley1RM(100, 5), 116.7);   // 100 × (1 + 5/30) = 116.666…
  assert.equal(epley1RM(60, 8), 76);       // 60 × (1 + 8/30) = 76.0
  assert.equal(epley1RM(100, 1), 103.3);
});

test('epley1RM: con 10 reps todavía estima; con más de 10 devuelve null', () => {
  // El corte es la regla del encargo: por encima de 10 la fórmula
  // sobreestima tanto que rotularlo "récord" sería ficción.
  assert.equal(epley1RM(80, 10), 106.7);
  assert.equal(epley1RM(80, 11), null);
  assert.equal(epley1RM(80, 25), null);
});

test('epley1RM: entradas inservibles devuelven null, nunca lanzan', () => {
  assert.equal(epley1RM(0, 5), null);      // sin peso no hay 1RM que estimar
  assert.equal(epley1RM(-10, 5), null);
  assert.equal(epley1RM(100, 0), null);
  assert.equal(epley1RM(NaN, 5), null);
  assert.equal(epley1RM(100, NaN), null);
});

// ── volumenSesion ────────────────────────────────────────────────────────────

test('volumenSesion: Σ reps × kg SOLO de series hechas', () => {
  const s = sesionCon([
    { idEjercicio: 'press-banca', nombre: 'Press banca', descansoS: 90, superGrupo: null,
      series: [serie(8, 60), serie(8, 60), serie(7, 62, false)] }, // la no hecha no cuenta
    { idEjercicio: 'sentadilla', nombre: 'Sentadilla', descansoS: 120, superGrupo: null,
      series: [serie(5, 100)] }
  ]);
  assert.equal(volumenSesion(s), 8 * 60 + 8 * 60 + 5 * 100); // 1460
});

test('volumenSesion: sesión vacía o malformada suma 0', () => {
  assert.equal(volumenSesion(sesionCon([])), 0);
  assert.equal(volumenSesion(null), 0);
  assert.equal(volumenSesion({}), 0);
  // Una serie con basura numérica no envenena la suma de las demás.
  const s = sesionCon([{ idEjercicio: 'x', nombre: 'x', descansoS: 90, superGrupo: null,
    series: [serie(NaN, 60), serie(5, 20)] }]);
  assert.equal(volumenSesion(s), 100);
});

// ── seriesPorGrupo ───────────────────────────────────────────────────────────

test('seriesPorGrupo: cuenta series hechas por músculo PRIMARIO del catálogo', () => {
  const s = sesionCon([
    { idEjercicio: 'press-banca', nombre: 'Press banca', descansoS: 90, superGrupo: null,
      series: [serie(8, 60), serie(8, 60), serie(8, 60, false)] },
    { idEjercicio: 'laterales', nombre: 'Laterales', descansoS: 60, superGrupo: null,
      series: [serie(12, 10), serie(12, 10)] }
  ]);
  assert.deepEqual(seriesPorGrupo(s, CATALOGO), { pecho: 2, hombros: 2 });
});

test('seriesPorGrupo: sin ficha en el catálogo el ejercicio cae en "otros"', () => {
  const s = sesionCon([
    { idEjercicio: 'LIBRE-remo-anillas', nombre: 'Remo en anillas', descansoS: 90, superGrupo: null,
      series: [serie(10, 0)] }
  ]);
  assert.deepEqual(seriesPorGrupo(s, CATALOGO), { otros: 1 });
  // Y también acepta un objeto plano como índice, no solo un Map.
  assert.deepEqual(seriesPorGrupo(s, {}), { otros: 1 });
});

test('seriesPorGrupo: un ejercicio sin series hechas no aparece', () => {
  const s = sesionCon([
    { idEjercicio: 'sentadilla', nombre: 'Sentadilla', descansoS: 120, superGrupo: null,
      series: [serie(5, 100, false)] }
  ]);
  assert.deepEqual(seriesPorGrupo(s, CATALOGO), {});
});

// ── ultimaVez ────────────────────────────────────────────────────────────────

const HISTORIAL = [
  sesionCon([{ idEjercicio: 'press-banca', nombre: 'Press banca', descansoS: 90, superGrupo: null,
    series: [serie(8, 55), serie(8, 55)] }], { id: 'S-vieja', finMs: 10 }),
  sesionCon([{ idEjercicio: 'sentadilla', nombre: 'Sentadilla', descansoS: 120, superGrupo: null,
    series: [serie(5, 90)] }], { id: 'S-media', finMs: 20 }),
  sesionCon([{ idEjercicio: 'press-banca', nombre: 'Press banca', descansoS: 90, superGrupo: null,
    series: [serie(8, 60), serie(7, 62, false), serie(6, 62)] }], { id: 'S-nueva', finMs: 30 })
];

test('ultimaVez: devuelve las series HECHAS de la sesión más reciente con ese ejercicio', () => {
  // De S-nueva: la serie no palomeada (7×62) no existe como referencia.
  assert.deepEqual(ultimaVez(HISTORIAL, 'press-banca'),
    [{ reps: 8, pesoKg: 60 }, { reps: 6, pesoKg: 62 }]);
});

test('ultimaVez: salta sesiones que no traen el ejercicio', () => {
  assert.deepEqual(ultimaVez(HISTORIAL, 'sentadilla'), [{ reps: 5, pesoKg: 90 }]);
});

test('ultimaVez: una sesión donde el ejercicio quedó sin hacer no es "la última vez"', () => {
  const conHueco = [
    ...HISTORIAL,
    sesionCon([{ idEjercicio: 'press-banca', nombre: 'Press banca', descansoS: 90, superGrupo: null,
      series: [serie(8, 65, false)] }], { id: 'S-abandonada', finMs: 40 })
  ];
  // Se sigue buscando hacia atrás hasta S-nueva, que sí tiene series hechas.
  assert.deepEqual(ultimaVez(conHueco, 'press-banca'),
    [{ reps: 8, pesoKg: 60 }, { reps: 6, pesoKg: 62 }]);
});

test('ultimaVez: sin historial (o sin ese ejercicio) devuelve null', () => {
  assert.equal(ultimaVez([], 'press-banca'), null);
  assert.equal(ultimaVez(HISTORIAL, 'dominadas'), null);
  assert.equal(ultimaVez(null, 'press-banca'), null);
});

// ── debeArrancarDescanso (la regla de superserie) ────────────────────────────

const ej = (id, superGrupo, series) => ({ idEjercicio: id, nombre: id, descansoS: 90, superGrupo, series });

test('ejercicio suelto: palomear la serie SIEMPRE arranca el descanso', () => {
  const ejercicios = [ej('press-banca', null, [serie(8, 60), serie(8, 60, false)])];
  assert.equal(debeArrancarDescanso(ejercicios, 0, 0), true);
});

test('superserie: el primer ejercicio de la ronda NO arranca el descanso', () => {
  const ejercicios = [
    ej('laterales', 1, [serie(12, 10), serie(12, 10, false)]),
    ej('face-pull', 1, [serie(12, 25, false), serie(12, 25, false)])
  ];
  // Ronda 0: laterales hecha, face-pull pendiente → sin descanso todavía.
  assert.equal(debeArrancarDescanso(ejercicios, 0, 0), false);
});

test('superserie: cerrar la ronda del último del grupo SÍ arranca el descanso', () => {
  const ejercicios = [
    ej('laterales', 1, [serie(12, 10)]),
    ej('face-pull', 1, [serie(12, 25)])
  ];
  assert.equal(debeArrancarDescanso(ejercicios, 1, 0), true);
});

test('superserie: da igual el orden — cierra la ronda quien palomea el que faltaba', () => {
  // El usuario palomeó primero face-pull y al final laterales: la ronda se
  // cierra al marcar laterales aunque esté listado primero en el grupo.
  const ejercicios = [
    ej('laterales', 1, [serie(12, 10)]),
    ej('face-pull', 1, [serie(12, 25)])
  ];
  assert.equal(debeArrancarDescanso(ejercicios, 0, 0), true);
});

test('superserie: un miembro con menos series no bloquea las rondas que ya no juega', () => {
  const ejercicios = [
    ej('laterales', 1, [serie(12, 10), serie(12, 10)]),
    ej('face-pull', 1, [serie(12, 25)]) // solo 1 serie: no participa en la ronda 1
  ];
  assert.equal(debeArrancarDescanso(ejercicios, 0, 1), true);
});

test('superserie: una serie pendiente del grupo en esa ronda la deja abierta', () => {
  const ejercicios = [
    ej('laterales', 1, [serie(12, 10), serie(12, 10)]),
    ej('face-pull', 1, [serie(12, 25), serie(12, 25, false)])
  ];
  assert.equal(debeArrancarDescanso(ejercicios, 0, 1), false);
});

test('otro grupo y ejercicios sueltos no cuentan para la ronda', () => {
  const ejercicios = [
    ej('press-banca', null, [serie(8, 60, false)]),   // suelto, pendiente
    ej('laterales', 1, [serie(12, 10)]),
    ej('face-pull', 1, [serie(12, 25)]),
    ej('curl', 2, [serie(10, 30, false)])             // otro grupo, pendiente
  ];
  assert.equal(debeArrancarDescanso(ejercicios, 2, 0), true);
});

test('debeArrancarDescanso: índice fuera de rango devuelve false, no lanza', () => {
  assert.equal(debeArrancarDescanso([], 0, 0), false);
  assert.equal(debeArrancarDescanso(undefined, 0, 0), false);
});

// ── aKg ──────────────────────────────────────────────────────────────────────

test('aKg: kg pasa igual; lb convierte con 0.45359237', () => {
  assert.equal(aKg(60, 'kg'), 60);
  assert.equal(aKg(100, 'lb'), 45.36);   // 45.359237 → centésima
  assert.equal(aKg(225, 'lb'), 102.06);  // 102.058283…
});

test('aKg: redondea a centésima para que el JSON no cargue colas de flotante', () => {
  assert.equal(aKg(62.5, 'kg'), 62.5);
  assert.equal(aKg(1, 'lb'), 0.45);
});

test('aKg: basura numérica o negativos → 0 (una serie sin peso, nunca NaN guardado)', () => {
  assert.equal(aKg(NaN, 'kg'), 0);
  assert.equal(aKg(-20, 'lb'), 0);
  assert.equal(aKg(Infinity, 'kg'), 0);
});

// ── siguientePendiente: el orden real en que se entrena ─────────────────────
const S = (...hechas) => hechas.map(h => ({ reps: 10, pesoKg: 20, hecha: h }));

test('siguientePendiente: un ejercicio suelto agota sus series en orden', () => {
  const ejs = [{ superGrupo: null, series: S(true, false, false) }, { superGrupo: null, series: S(false) }];
  assert.deepEqual(siguientePendiente(ejs), { idx: 0, serie: 1 });
});

test('siguientePendiente: salta al siguiente ejercicio cuando el primero está completo', () => {
  const ejs = [{ superGrupo: null, series: S(true, true) }, { superGrupo: null, series: S(false, false) }];
  assert.deepEqual(siguientePendiente(ejs), { idx: 1, serie: 0 });
});

test('siguientePendiente: la superserie alterna por rondas (A1, B1, A2, B2)', () => {
  const ejs = [{ superGrupo: 1, series: S(true, false) }, { superGrupo: 1, series: S(false, false) }];
  assert.deepEqual(siguientePendiente(ejs), { idx: 1, serie: 0 });   // B1 antes que A2
  ejs[1].series[0].hecha = true;
  assert.deepEqual(siguientePendiente(ejs), { idx: 0, serie: 1 });   // luego A2
});

test('siguientePendiente: un miembro con menos series no bloquea la ronda', () => {
  const ejs = [{ superGrupo: 2, series: S(true, true, false) }, { superGrupo: 2, series: S(true, true) }];
  assert.deepEqual(siguientePendiente(ejs), { idx: 0, serie: 2 });
});

test('siguientePendiente: lo palomeado en desorden se salta; todo hecho → null', () => {
  const ejs = [{ superGrupo: null, series: S(false, true) }];
  assert.deepEqual(siguientePendiente(ejs), { idx: 0, serie: 0 });
  ejs[0].series[0].hecha = true;
  assert.equal(siguientePendiente(ejs), null);
  assert.equal(siguientePendiente([]), null);
  assert.equal(siguientePendiente(null), null);
});

// ── Progreso: récords, historial y estadísticas ─────────────────────────────
const D = 86400000;
const ser = (reps, pesoKg, hecha = true) => ({ reps, pesoKg, hecha });
const sesP = (id, dia, ejs) => ({ id, inicioMs: dia * D, finMs: dia * D + 3600000, ejercicios: ejs });
const ejP = (idEjercicio, series) => ({ idEjercicio, nombre: idEjercicio, series });
const HIST = [
  sesP('s1', 10, [ejP('banca', [ser(10, 60), ser(8, 70)]), ejP('dominada', [ser(8, 0), ser(10, 0)])]),
  sesP('s2', 20, [ejP('banca', [ser(5, 80), ser(6, 80), ser(12, 50, false)])]),
  sesP('s3', 30, [ejP('banca', [ser(8, 75)]), ejP('dominada', [ser(12, 0)])]),
];

test('mejorSerie: más peso gana; a igual peso, más reps; peso corporal por reps; ignora no hechas', () => {
  assert.deepEqual(mejorSerie([ser(10, 60), ser(8, 70), ser(12, 90, false)]), ser(8, 70));
  assert.deepEqual(mejorSerie([ser(5, 80), ser(6, 80)]), ser(6, 80));
  assert.deepEqual(mejorSerie([ser(8, 0), ser(10, 0)]), ser(10, 0));
  assert.equal(mejorSerie([ser(0, 50)]), null);
  assert.equal(mejorSerie([]), null);
});

test('resumenEjercicio: series hechas, reps totales y volumen Σ reps × kg', () => {
  const r = resumenEjercicio(ejP('banca', [ser(10, 60), ser(8, 70), ser(5, 100, false)]));
  assert.equal(r.series.length, 2);
  assert.equal(r.totalReps, 18);
  assert.equal(r.volumen, 10 * 60 + 8 * 70);
});

test('historialEjercicio: cronológico y solo sesiones con series hechas del ejercicio', () => {
  const h = historialEjercicio(HIST, 'banca');
  assert.deepEqual(h.map(x => x.sesionId), ['s1', 's2', 's3']);
  assert.deepEqual(h[1].mejor, ser(6, 80));
  assert.deepEqual(historialEjercicio(HIST, 'dominada').map(x => x.sesionId), ['s1', 's3']);
});

test('recordsEjercicio: top por peso y luego reps; peso corporal por reps', () => {
  assert.deepEqual(recordsEjercicio(HIST, 'banca').map(x => x.sesionId), ['s2', 's3', 's1']);
  assert.deepEqual(recordsEjercicio(HIST, 'dominada', 1)[0].mejor, ser(12, 0));
});

test('prsPorEjercicio: récord vigente de cada ejercicio, el más reciente primero', () => {
  const prs = prsPorEjercicio(HIST);
  assert.deepEqual(prs.map(p => [p.idEjercicio, p.mejor.pesoKg, p.mejor.reps]), [['dominada', 0, 12], ['banca', 80, 6]]);
});

test('estadisticasPeriodo: sesiones, series y volumen del rango; por ejercicio si se pide', () => {
  const todo = estadisticasPeriodo(HIST, 0, 100 * D);
  assert.equal(todo.sesiones, 3);
  assert.equal(todo.series, 2 + 2 + 2 + 1 + 1);
  assert.equal(todo.volumen, (600 + 560) + (400 + 480) + 600);
  const banca = estadisticasPeriodo(HIST, 15 * D, 100 * D, 'banca');
  assert.equal(banca.sesiones, 2);
  assert.equal(banca.promedio, (880 + 600) / 2);
  assert.equal(estadisticasPeriodo(HIST, 200 * D, 300 * D).promedio, 0);
});

test('cambioPct: redondeado; sin periodo anterior no inventa porcentaje', () => {
  assert.equal(cambioPct(12048, 11700), 3);
  assert.equal(cambioPct(85, 100), -15);
  assert.equal(cambioPct(500, 0), null);
});
