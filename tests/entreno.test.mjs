// Tests de las funciones puras de js/entreno.js. Todo con fixtures inline:
// el módulo importa almacen.js y temporizador.js, que ya cargan limpio en
// Node (capa de navegador con detección de capacidades), así que basta
// node --test. El DOM solo vive dentro de initEntreno y aquí no se toca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epley1RM, volumenSesion, seriesPorGrupo, ultimaVez,
         debeArrancarDescanso, aKg, siguientePendiente, mejorSerie, resumenEjercicio, historialEjercicio,
         recordsEjercicio, prsPorEjercicio, estadisticasPeriodo, cambioPct, PESTANAS,
         OPCIONES_DESCANSO, etiquetaDescanso, rangoDescanso, ejercicioDeRutina, limpiarEjercicioRutina,
         validarBorrador, rutinaDesdeBorrador, borradorDesdeRutina,
         moverEjercicio, normalizarGrupos, MAX_SUPERSERIE,
         letraGrupo, tramos, puedeUnir, unirConSiguiente, separarDeSiguiente, moverTramo, pasoEjercicio,
         TECNICAS, limpiarTecnica, normalizarPlan, planEsNormal, repsDeSerie, volumenDeSerie, pesoBajada,
         siguienteParte, textoSerie, planDesdeSeries, agregarCalentamiento, previasPorSerie } from '../js/entreno.js';
import { migrar, importarJSON } from '../js/almacen.js';

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

test('PESTANAS: Rutinas primero (la que abre Entrenar), luego Progreso e Historial', () => {
  assert.deepEqual(PESTANAS, ['rutinas', 'progreso', 'historial', 'biblioteca']);
});

// ── Crear rutina y elegir descanso ──────────────────────────────────────────

test('etiquetaDescanso: minutos y segundos legibles', () => {
  assert.equal(etiquetaDescanso(45), '45 s');
  assert.equal(etiquetaDescanso(60), '1 min');
  assert.equal(etiquetaDescanso(90), '1 min 30 s');
  assert.equal(etiquetaDescanso(180), '3 min');
  assert.equal(etiquetaDescanso(0), '—');
  assert.deepEqual(OPCIONES_DESCANSO, [60, 90, 120, 180]);
});

test('rangoDescanso: mínimo y máximo del día; null si no trae descansos', () => {
  const dia = { bloques: [[{ descansoS: 120 }], [{ descansoS: 60 }, { descansoS: 90 }]] };
  assert.deepEqual(rangoDescanso(dia), { min: 60, max: 120 });
  assert.equal(rangoDescanso({ bloques: [[{}]] }), null);
  assert.equal(rangoDescanso(null), null);
});

test('limpiarEjercicioRutina: topes de series y reps, y el rango se ordena', () => {
  const base = ejercicioDeRutina('press-banca', 'Press banca');
  assert.deepEqual(base, { idEjercicio: 'press-banca', nombre: 'Press banca', series: 3, repsMin: 8, repsMax: 12, descansoS: 90 });
  assert.equal(limpiarEjercicioRutina({ ...base, series: 0 }).series, 1);
  assert.equal(limpiarEjercicioRutina({ ...base, series: 14 }).series, 10);
  const inv = limpiarEjercicioRutina({ ...base, repsMin: 12, repsMax: 6 });
  assert.deepEqual([inv.repsMin, inv.repsMax], [6, 12]);
  const raro = limpiarEjercicioRutina({ ...base, repsMin: NaN, repsMax: 99 });
  assert.deepEqual([raro.repsMin, raro.repsMax], [8, 50]);
});

test('validarBorrador: pide nombre y al menos un ejercicio', () => {
  assert.deepEqual(Object.keys(validarBorrador({ nombre: '  ', ejercicios: [] }).errores), ['nombre', 'ejercicios']);
  assert.equal(validarBorrador({ nombre: 'Pierna', ejercicios: [ejercicioDeRutina('sentadilla', 'Sentadilla')] }).ok, true);
});

test('rutinaDesdeBorrador: un día, un bloque por ejercicio, nombre recortado', () => {
  const r = rutinaDesdeBorrador({ nombre: '  Pierna  ', ejercicios: [
    ejercicioDeRutina('sentadilla', 'Sentadilla'), { ...ejercicioDeRutina('peso-muerto', 'Peso muerto'), series: 5, repsMin: 5, repsMax: 3 }
  ] }, 'R-1');
  assert.equal(r.id, 'R-1');
  assert.equal(r.nombre, 'Pierna');
  assert.equal(r.dias.length, 1);
  assert.deepEqual(r.dias[0].bloques.map(b => b.length), [1, 1]);
  assert.deepEqual(r.dias[0].bloques[1][0], { idEjercicio: 'peso-muerto', nombre: 'Peso muerto', series: 5, repsMin: 3, repsMax: 5, descansoS: 90 });
});

// ── Editar una de "Tus rutinas" ──────────────────────────────────────────────

const RUTINA_PROPIA = {
  id: 'R-7', nombre: 'Torso', nivel: null, objetivo: null, equipo: null, diasSemana: null, notas: 'mis notas',
  dias: [
    { nombre: 'Día 1', bloques: [
      [{ idEjercicio: 'press-banca', nombre: 'Press banca', series: 4, repsMin: 6, repsMax: 8, descansoS: 150 }],
      [{ idEjercicio: 'remo', nombre: 'Remo', series: 3, repsMin: 10, repsMax: 12, descansoS: 60 },
       { idEjercicio: 'fondos', nombre: 'Fondos', series: 3, repsMin: 8, repsMax: 10, descansoS: 60 }]
    ] },
    { nombre: 'Día 2', bloques: [[{ idEjercicio: 'sentadilla', nombre: 'Sentadilla', series: 5, repsMin: 5, repsMax: 5, descansoS: 180 }]] }
  ]
};

test('editar sin cambios devuelve la MISMA rutina (superseries, otros días, notas e id)', () => {
  const b = borradorDesdeRutina(RUTINA_PROPIA);
  assert.equal(b.id, 'R-7');
  assert.deepEqual(b.ejercicios.map(e => e.grupo), [null, 0, 0]);   // renumerada: es la superserie A
  assert.deepEqual(rutinaDesdeBorrador(b, 'R-otro'), RUTINA_PROPIA);
});

test('editar: cambiar nombre y series, quitar uno de la superserie y agregar uno nuevo', () => {
  const b = borradorDesdeRutina(RUTINA_PROPIA);
  b.nombre = ' Torso fuerte ';
  b.ejercicios[0] = { ...b.ejercicios[0], series: 5 };
  b.ejercicios.splice(2, 1);                                   // fuera "Fondos"
  b.ejercicios.push(ejercicioDeRutina('dominadas', 'Dominadas'));
  const r = rutinaDesdeBorrador(b, 'R-otro');
  assert.equal(r.id, 'R-7');
  assert.equal(r.nombre, 'Torso fuerte');
  assert.equal(r.notas, 'mis notas');
  assert.deepEqual(r.dias[0].bloques.map(bl => bl.map(x => x.idEjercicio)), [['press-banca'], ['remo'], ['dominadas']]);
  assert.equal(r.dias[0].bloques[0][0].series, 5);
  assert.deepEqual(r.dias[1], RUTINA_PROPIA.dias[1]);
});

test('editar una rutina guardada desde una sesión sin reps: toma valores por defecto válidos', () => {
  const b = borradorDesdeRutina({ id: 'R-9', nombre: 'Rápida', dias: [{ nombre: 'Día 1', bloques: [[{ idEjercicio: 'x', nombre: 'X', series: 2, repsMin: null, repsMax: null, descansoS: 90 }]] }] });
  assert.deepEqual([b.ejercicios[0].series, b.ejercicios[0].repsMin, b.ejercicios[0].repsMax], [2, 8, 12]);
});

// ── Reordenar en el editor ───────────────────────────────────────────────────

const er = (id, grupo = null) => ({ ...ejercicioDeRutina(id, id), grupo });
const ids = l => l.map(e => e.idEjercicio).join(' ');
const grupos = l => l.map(e => e.grupo === null ? '·' : e.grupo).join('');

test('moverEjercicio: mueve hacia abajo y hacia arriba sin tocar la lista original', () => {
  const l = [er('a'), er('b'), er('c'), er('d')];
  assert.equal(ids(moverEjercicio(l, 0, 2)), 'b c a d');
  assert.equal(ids(moverEjercicio(l, 3, 1)), 'a d b c');
  assert.equal(ids(l), 'a b c d');
  assert.equal(ids(moverEjercicio(l, 1, 1)), 'a b c d');
  assert.equal(ids(moverEjercicio(l, 0, 9)), 'a b c d');   // fuera de rango: no hace nada
});

test('moverEjercicio: reordenar DENTRO de una superserie la conserva', () => {
  const l = [er('a1', 5), er('a2', 5), er('x')];
  const r = moverEjercicio(l, 0, 1);
  assert.equal(ids(r), 'a2 a1 x');
  assert.equal(grupos(r), '00·');
});

test('moverEjercicio: soltar entre dos de una superserie la une; sacarlo la deshace', () => {
  const l = [er('a1', 0), er('a2', 0), er('x')];
  const dentro = moverEjercicio(l, 2, 1);
  assert.equal(ids(dentro), 'a1 x a2');
  assert.equal(grupos(dentro), '000');
  const fuera = moverEjercicio([er('a1', 0), er('a2', 0), er('x')], 0, 2);
  assert.equal(ids(fuera), 'a2 x a1');
  assert.equal(grupos(fuera), '···');      // a2 se queda sola: ya no es superserie
});

test('moverEjercicio: una superserie llena (4) no admite un quinto', () => {
  assert.equal(MAX_SUPERSERIE, 4);
  const l = [er('a1', 0), er('a2', 0), er('a3', 0), er('a4', 0), er('x')];
  const r = moverEjercicio(l, 4, 2);
  assert.equal(ids(r), 'a1 a2 x a3 a4');
  assert.equal(grupos(r), '00·11');        // x queda suelta y parte la superserie en dos de 2
});

test('normalizarGrupos: renumera por orden y quita superseries de un solo ejercicio', () => {
  assert.equal(grupos(normalizarGrupos([er('a', 7), er('b', 7), er('c', 3), er('d'), er('e', 9), er('f', 9)])), '00··11');
});

// ── Superseries en el editor ─────────────────────────────────────────────────

test('letraGrupo y tramos: A, B…; cada superserie es un tramo y cada suelto otro', () => {
  assert.deepEqual([letraGrupo(0), letraGrupo(1), letraGrupo(null)], ['A', 'B', '']);
  assert.deepEqual(tramos([er('a', 0), er('b', 0), er('c'), er('d', 1), er('e', 1)]), [[0, 1], [2, 2], [3, 4]]);
});

test('unirConSiguiente: dos sueltos forman superserie; un suelto se suma; dos superseries se funden', () => {
  assert.equal(grupos(unirConSiguiente([er('a'), er('b'), er('c')], 0).ejercicios), '00·');
  assert.equal(grupos(unirConSiguiente([er('a', 0), er('b', 0), er('c')], 1).ejercicios), '000');
  assert.equal(grupos(unirConSiguiente([er('a'), er('b', 0), er('c', 0)], 0).ejercicios), '000');
  assert.equal(grupos(unirConSiguiente([er('a', 0), er('b', 0), er('c', 1), er('d', 1)], 1).ejercicios), '0000');
});

test('unirConSiguiente: nunca pasa de 4; el último no tiene siguiente', () => {
  const llena = [er('a', 0), er('b', 0), er('c', 0), er('d', 0), er('x')];
  assert.equal(puedeUnir(llena, 3), false);
  const r = unirConSiguiente(llena, 3);
  assert.match(r.error, /máximo 4/);
  assert.equal(grupos(r.ejercicios), '0000·');
  assert.equal(puedeUnir([er('a', 0), er('b', 0), er('c', 1), er('d', 1), er('e', 1)], 1), false);   // 2 + 3
  assert.ok(unirConSiguiente([er('a'), er('b')], 1).error);
});

test('separarDeSiguiente: parte la superserie; los que quedan solos dejan de serlo', () => {
  assert.equal(grupos(separarDeSiguiente([er('a', 0), er('b', 0), er('c', 0), er('d', 0)], 1).ejercicios), '0011');
  assert.equal(grupos(separarDeSiguiente([er('a', 0), er('b', 0), er('c', 0)], 0).ejercicios), '·00');
  assert.equal(grupos(separarDeSiguiente([er('a', 0), er('b', 0)], 0).ejercicios), '··');
  assert.equal(grupos(separarDeSiguiente([er('a'), er('b')], 0).ejercicios), '··');   // nada que separar
});

test('moverTramo: la superserie se mueve entera y nunca cae dentro de otra', () => {
  const l = [er('x'), er('a1', 0), er('a2', 0), er('b1', 1), er('b2', 1), er('y')];
  const r = moverTramo(l, 1, 3);               // A al final
  assert.equal(ids(r), 'x b1 b2 y a1 a2');
  assert.equal(grupos(r), '·00·11');
  const r2 = moverTramo(l, 2, 0);              // B al principio
  assert.equal(ids(r2), 'b1 b2 x a1 a2 y');
  assert.equal(grupos(r2), '00·11·');
});

test('una rutina con superseries hechas en el editor llega a la sesión como bloques', () => {
  const b = { nombre: 'Torso', ejercicios: unirConSiguiente([er('press'), er('remo'), er('curl')], 0).ejercicios };
  const r = rutinaDesdeBorrador(b, 'R-1');
  assert.deepEqual(r.dias[0].bloques.map(bl => bl.map(x => x.idEjercicio)), [['press', 'remo'], ['curl']]);
});

// ── Un paso con el menú o las flechas (revisión adversarial, 30-oct) ────────

test('pasoEjercicio: un suelto SALTA la superserie entera, nunca entra en ella', () => {
  const l = [er('a1', 0), er('a2', 0), er('x')];
  const r = pasoEjercicio(l, 2, -1);
  assert.equal(ids(r.ejercicios), 'x a1 a2');
  assert.equal(grupos(r.ejercicios), '·00');
  assert.deepEqual([r.idx, r.cambio], [0, 'salto']);
  const llena = [er('x'), er('a', 0), er('b', 0), er('c', 0), er('d', 0)];
  const r2 = pasoEjercicio(llena, 0, 1);
  assert.equal(ids(r2.ejercicios), 'a b c d x');
  assert.equal(grupos(r2.ejercicios), '0000·');      // la llena sigue intacta
  assert.equal(r2.idx, 4);
});

test('pasoEjercicio: dentro de su superserie cambia de sitio; en el borde, primero sale', () => {
  const l = [er('a1', 0), er('a2', 0), er('a3', 0), er('x')];
  const d = pasoEjercicio(l, 0, 1);
  assert.equal(ids(d.ejercicios), 'a2 a1 a3 x');
  assert.equal(grupos(d.ejercicios), '000·');
  const s1 = pasoEjercicio(l, 2, 1);                 // a3 en el borde de abajo
  assert.equal(ids(s1.ejercicios), 'a1 a2 a3 x');
  assert.equal(grupos(s1.ejercicios), '00··');
  assert.deepEqual([s1.idx, s1.cambio], [2, 'salio']);
  const s2 = pasoEjercicio([er('a1', 0), er('a2', 0)], 0, -1);   // de 2 a 1: la superserie se deshace
  assert.equal(grupos(s2.ejercicios), '··');
});

test('pasoEjercicio: dos sueltos se intercambian; fuera de los extremos no hace nada', () => {
  assert.equal(ids(pasoEjercicio([er('a'), er('b')], 0, 1).ejercicios), 'b a');
  assert.equal(pasoEjercicio([er('a'), er('b')], 0, -1).cambio, null);
});

test('borradorDesdeRutina: la primera superserie de una rutina guardada es la A', () => {
  const r = { id: 'R-1', nombre: 'X', dias: [{ nombre: 'Día 1', bloques: [[{ idEjercicio: 'x', nombre: 'X' }], [{ idEjercicio: 'a', nombre: 'A' }, { idEjercicio: 'b', nombre: 'B' }]] }] };
  assert.deepEqual(borradorDesdeRutina(r).ejercicios.map(e => letraGrupo(e.grupo)), ['', 'A', 'A']);
});

// ── Técnicas por serie (fase 3) ──────────────────────────────────────────────

test('limpiarTecnica: tipo desconocido = normal; parámetros por defecto y dentro de rango', () => {
  assert.deepEqual(limpiarTecnica({ tipo: 'superman' }), { tipo: 'normal' });
  assert.deepEqual(limpiarTecnica({ tipo: 'restpause' }), { tipo: 'restpause', mini: 2, microS: 15 });
  assert.deepEqual(limpiarTecnica({ tipo: 'restpause', mini: 9, microS: 3 }), { tipo: 'restpause', mini: 4, microS: 10 });
  assert.deepEqual(limpiarTecnica({ tipo: 'drop', pct: 23 }), { tipo: 'drop', bajadas: 1, pct: 25 });
  assert.equal(TECNICAS.calentamiento.insignia, 'W');
});

test('normalizarPlan y planEsNormal', () => {
  assert.deepEqual(normalizarPlan(3, [{ tipo: 'calentamiento' }]).map(t => t.tipo), ['calentamiento', 'normal', 'normal']);
  assert.equal(planEsNormal(undefined), true);
  assert.equal(planEsNormal([{ tipo: 'normal' }, {}]), true);
  assert.equal(planEsNormal([{ tipo: 'drop' }]), false);
});

test('limpiarEjercicioRutina: el plan sigue al número de series', () => {
  const ej = { ...ejercicioDeRutina('a', 'A'), plan: [{ tipo: 'calentamiento' }, { tipo: 'normal' }, { tipo: 'restpause' }] };
  assert.deepEqual(limpiarEjercicioRutina({ ...ej, series: 4 }).plan.map(t => t.tipo), ['calentamiento', 'normal', 'restpause', 'normal']);
  assert.deepEqual(limpiarEjercicioRutina({ ...ej, series: 2 }).plan.map(t => t.tipo), ['calentamiento', 'normal']);
  assert.equal('plan' in limpiarEjercicioRutina(ejercicioDeRutina('a', 'A')), false);   // sin plan, sin campo
});

test('agregarCalentamiento: una W al principio, hasta 10 series', () => {
  const r = agregarCalentamiento(ejercicioDeRutina('a', 'A'));
  assert.equal(r.series, 4);
  assert.deepEqual(r.plan.map(t => t.tipo), ['calentamiento', 'normal', 'normal', 'normal']);
  assert.equal(agregarCalentamiento({ ...r, series: 10 }).series, 10);
});

test('volumen: el calentamiento no cuenta; rest-pause y drop suman sus partes', () => {
  const ses = { ejercicios: [{ series: [
    { reps: 12, pesoKg: 20, hecha: true, tipo: 'calentamiento' },
    { reps: 8, pesoKg: 60, hecha: true, tipo: 'restpause', partes: [{ reps: 3, pesoKg: 60 }, { reps: 2, pesoKg: 60 }] },
    { reps: 10, pesoKg: 60, hecha: true, tipo: 'drop', partes: [{ reps: 8, pesoKg: 47.5 }] },
    { reps: 10, pesoKg: 60, hecha: false }
  ] }] };
  assert.equal(volumenSesion(ses), 13 * 60 + 600 + 8 * 47.5);
  assert.equal(repsDeSerie(ses.ejercicios[0].series[1]), 13);
  assert.equal(volumenDeSerie({ reps: 5, pesoKg: 10, partes: [{ reps: 2 }] }), 70);   // parte sin peso: el de la serie
  assert.deepEqual(seriesPorGrupo(ses, new Map()), { otros: 2 });
});

test('récords: solo la parte principal de las series de trabajo', () => {
  const series = [
    { reps: 3, pesoKg: 100, hecha: true, tipo: 'calentamiento' },
    { reps: 8, pesoKg: 60, hecha: true, tipo: 'restpause', partes: [{ reps: 5, pesoKg: 60 }] },
    { reps: 6, pesoKg: 70, hecha: true }
  ];
  assert.deepEqual(mejorSerie(series), series[2]);
  const r = resumenEjercicio({ series });
  assert.equal(r.series.length, 2);
  assert.equal(r.totalReps, 8 + 5 + 6);
  assert.equal(r.volumen, 13 * 60 + 6 * 70);
});

test('pesoBajada: −20 % redondeado a 2,5 kg o 5 lb; siempre baja y nunca llega a cero', () => {
  assert.equal(pesoBajada(60, 20), 47.5);
  assert.equal(pesoBajada(100, 25), 75);
  assert.equal(pesoBajada(0, 20), 0);
  assert.equal(pesoBajada(aKg(135, 'lb'), 20, 'lb'), aKg(110, 'lb'));
  // cargas pequeñas (revisión adversarial): antes 5→5 y 2→2,5
  assert.equal(pesoBajada(5, 20), 2.5);
  assert.equal(pesoBajada(2, 20), 1.5);
  assert.equal(pesoBajada(2.5, 40), 1.5);
  assert.equal(pesoBajada(10, 10), 7.5);
  assert.equal(pesoBajada(aKg(10, 'lb'), 20, 'lb'), aKg(5, 'lb'));
  let p = 10;
  for (let k = 0; k < 3; k++) { const q = pesoBajada(p, 20); assert.ok(q < p && q > 0, `${p} → ${q}`); p = q; }
});

test('siguienteParte: rest-pause pide micro-descanso por mini-serie; drop, sus bajadas', () => {
  assert.deepEqual(siguienteParte({ tipo: 'restpause', mini: 2, microS: 15, partes: [] }), { fase: 'micro', k: 0, total: 2, microS: 15 });
  assert.deepEqual(siguienteParte({ tipo: 'restpause', mini: 2, partes: [{ reps: 3 }, { reps: 2 }] }), { fase: 'fin' });
  assert.deepEqual(siguienteParte({ tipo: 'drop', bajadas: 2, pct: 20, partes: [{ reps: 8 }] }), { fase: 'parte', k: 1, total: 2, pct: 20 });
  assert.deepEqual(siguienteParte({ reps: 10 }), { fase: 'fin' });
  assert.deepEqual(siguienteParte({ tipo: 'calentamiento' }), { fase: 'fin' });
});

test('textoSerie: formato del resumen y del historial', () => {
  assert.equal(textoSerie({ reps: 8, pesoKg: 60, tipo: 'restpause', partes: [{ reps: 3 }, { reps: 2 }] }), '8×60 + 3 + 2 RP');
  assert.equal(textoSerie({ reps: 10, pesoKg: 60, tipo: 'drop', partes: [{ reps: 8, pesoKg: 47.5 }] }), '10×60 + 8×47.5 D');
  assert.equal(textoSerie({ reps: 12, pesoKg: 20, tipo: 'calentamiento' }), '12×20 W');
  assert.equal(textoSerie({ reps: 15, pesoKg: 0 }), '15 reps');
});

test('planDesdeSeries y la ida y vuelta editor → rutina conservan el plan', () => {
  assert.equal(planDesdeSeries([{ reps: 8 }, { reps: 8 }]), null);
  assert.deepEqual(planDesdeSeries([{ tipo: 'calentamiento' }, { reps: 8 }]).map(t => t.tipo), ['calentamiento', 'normal']);
  const b = { nombre: 'P', ejercicios: [{ ...agregarCalentamiento(ejercicioDeRutina('a', 'A')), grupo: null }] };
  const r = rutinaDesdeBorrador(b, 'R-1');
  assert.deepEqual(r.dias[0].bloques[0][0].plan.map(t => t.tipo), ['calentamiento', 'normal', 'normal', 'normal']);
  assert.deepEqual(borradorDesdeRutina(r).ejercicios[0].plan.map(t => t.tipo), ['calentamiento', 'normal', 'normal', 'normal']);
  const sinPlan = rutinaDesdeBorrador({ nombre: 'P', ejercicios: [ejercicioDeRutina('a', 'A')] }, 'R-2');
  assert.equal('plan' in sinPlan.dias[0].bloques[0][0], false);
});

test('almacén: técnica desconocida se descarta y las partes se sanean (respaldo editado)', () => {
  const e = migrar({ version: 1, entreno: { rutinas: [], sesiones: [{ id: 'S-1', inicioMs: 1, ejercicios: [{ idEjercicio: 'a', nombre: 'A', series: [
    { reps: 8, pesoKg: 60, hecha: true, tipo: 'hack', partes: 'x' },
    { reps: 8, pesoKg: 60, hecha: true, tipo: 'restpause', partes: [{ reps: '3', pesoKg: null }, 7, { reps: 2, pesoKg: 60 }, {}, {}, {}, {}] }
  ] }] }] } });
  const [s1, s2] = e.entreno.sesiones[0].ejercicios[0].series;
  assert.equal('tipo' in s1, false);
  assert.deepEqual(s1.partes, []);
  assert.equal(s2.tipo, 'restpause');
  assert.equal(s2.partes.length, 5);
  assert.deepEqual(s2.partes[0], { reps: 0, pesoKg: 0 });
});

// ── Revisión adversarial de las técnicas (30-oct) ────────────────────────────

test('limpiarTecnica: los nombres del prototipo no son técnicas', () => {
  for (const tipo of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.deepEqual(limpiarTecnica({ tipo }), { tipo: 'normal' });
  assert.equal(planEsNormal(normalizarPlan(1, [{ tipo: 'constructor' }])), true);
});

test('previasPorSerie: W con W y trabajo con trabajo, aunque cambie el calentamiento', () => {
  const previas = [{ reps: 8, pesoKg: 60 }, { reps: 6, pesoKg: 62.5 }];
  assert.deepEqual(previasPorSerie(['calentamiento', 'normal', 'normal', 'normal'], previas).map(p => p?.pesoKg ?? null), [null, 60, 62.5, 62.5]);
  const conW = [{ reps: 12, pesoKg: 20, tipo: 'calentamiento' }, { reps: 8, pesoKg: 60 }];
  assert.deepEqual(previasPorSerie(['normal', 'normal'], conW).map(p => p.pesoKg), [60, 60]);
  assert.deepEqual(previasPorSerie(['calentamiento', 'restpause'], conW).map(p => p.pesoKg), [20, 60]);
  assert.deepEqual(previasPorSerie(['normal'], null), [null]);
});

test('rest-pause: la mini-serie usa el peso de la serie aunque se corrija después', () => {
  const s = { reps: 8, pesoKg: 80, tipo: 'restpause', partes: [{ reps: 3 }] };
  assert.equal(volumenDeSerie(s), 11 * 80);
  assert.equal(textoSerie(s), '8×80 + 3 RP');
});

test('almacén: las partes sin peso se quedan sin peso; las partes de una serie sin técnica se quitan', () => {
  const e = migrar({ version: 1, entreno: { rutinas: [], sesiones: [{ id: 'S-1', inicioMs: 1, ejercicios: [{ idEjercicio: 'a', nombre: 'A', series: [
    { reps: 8, pesoKg: 60, hecha: true, tipo: 'restpause', partes: [{ reps: 3 }, { reps: 2 }] },
    { reps: 8, pesoKg: 60, hecha: true, partes: [{ reps: 3 }] }
  ] }] }] } });
  const [rp, normal] = e.entreno.sesiones[0].ejercicios[0].series;
  assert.deepEqual(rp.partes, [{ reps: 3 }, { reps: 2 }]);
  assert.equal(volumenDeSerie(rp), 13 * 60);
  assert.deepEqual(normal.partes, []);
});

test('almacén: el estado vivo de un respaldo manipulado no cuela texto (parte en curso y micro-descanso)', () => {
  const malo = '<img src=x onerror=alert(1)>';
  const r = importarJSON(JSON.stringify({ version: 1, entreno: { rutinas: [], sesiones: [], sesionActiva: {
    id: 'S-1', inicioMs: 1, ejercicios: [{ idEjercicio: 'a', nombre: 'A', series: [{ reps: 8, pesoKg: 60, tipo: 'restpause' }] }],
    parteEnCurso: { idx: 0, serie: 0, k: 0, reps: malo, pesoKg: malo, inicioMs: malo },
    descanso: { finMs: 9e12, duracionS: 15, idx: 0, micro: { serie: 0, k: malo, reps: malo } }
  } } }));
  const est = r.estado ?? r;
  const viva = est.entreno.sesionActiva;
  assert.deepEqual(viva.parteEnCurso, { idx: 0, serie: 0, k: 0, inicioMs: null, reps: 0, pesoKg: 0 });
  assert.equal('micro' in viva.descanso, false);           // k no es un entero: fuera
  assert.equal(JSON.stringify(viva).includes('<img'), false);
});
