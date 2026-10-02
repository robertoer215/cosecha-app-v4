import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearDescanso, formatear, pedirWakeLock, liberarWakeLock, prepararAudio, avisarFin } from '../js/temporizador.js';

// Reloj inyectado: los tests mueven el tiempo a mano, en saltos, igual que lo
// hace una pestaña dormida. Nada de setTimeout reales.
const reloj = (inicioMs = 1_000_000) => {
  let t = inicioMs;
  return { ahora: () => t, avanzar: (ms) => { t += ms; } };
};

test('al crear con 90 s: restante 90, no ha terminado y el fin queda a 90 000 ms', () => {
  const r = reloj();
  const d = crearDescanso({ duracionS: 90, ahora: r.ahora });
  assert.equal(d.finMs, r.ahora() + 90_000);
  assert.equal(d.restanteS(), 90);
  assert.equal(d.haTerminado(), false);
});

test('2 min con la pestaña dormida: el reloj salta 120 000 ms de golpe y el restante es exacto (0), no negativo', () => {
  const r = reloj();
  const d = crearDescanso({ duracionS: 90, ahora: r.ahora });
  // Ningún tick intermedio: así vuelve una pestaña que durmió. Si el módulo
  // restara segundos en un intervalo, aquí seguiría diciendo 90.
  r.avanzar(120_000);
  assert.equal(d.restanteS(), 0);
  assert.equal(d.haTerminado(), true);
});

test('el restante se deriva del fin en cada lectura: dormir 61 s de un descanso de 90 deja 29', () => {
  const r = reloj();
  const d = crearDescanso({ duracionS: 90, ahora: r.ahora });
  r.avanzar(61_000);
  assert.equal(d.restanteS(), 29);
  assert.equal(d.haTerminado(), false);
});

test('el segundo en pantalla redondea hacia arriba: con 300 ms por correr aún se ve 1, y el 0 llega con el fin exacto', () => {
  const r = reloj();
  const d = crearDescanso({ duracionS: 90, ahora: r.ahora });
  r.avanzar(500);
  assert.equal(d.restanteS(), 90);      // primer segundo aún corriendo
  r.avanzar(500);
  assert.equal(d.restanteS(), 89);      // 1 s cumplido
  r.avanzar(88_700);                    // quedan 300 ms
  assert.equal(d.restanteS(), 1);
  assert.equal(d.haTerminado(), false);
  r.avanzar(300);                       // justo el fin
  assert.equal(d.restanteS(), 0);
  assert.equal(d.haTerminado(), true);
});

test('ajustar(+15) y ajustar(-15) mueven el FIN, y finMs (getter) siempre enseña el vigente', () => {
  const r = reloj();
  const d = crearDescanso({ duracionS: 90, ahora: r.ahora });
  const finOriginal = d.finMs;
  d.ajustar(15);
  assert.equal(d.finMs, finOriginal + 15_000);
  assert.equal(d.restanteS(), 105);
  d.ajustar(-15);
  assert.equal(d.finMs, finOriginal);
  assert.equal(d.restanteS(), 90);
});

test('ajustar(-15) con menos de 15 s por correr termina el descanso ya: el fin se clava en ahora, nunca en el pasado', () => {
  const r = reloj();
  const d = crearDescanso({ duracionS: 90, ahora: r.ahora });
  r.avanzar(80_000);                    // quedan 10 s
  d.ajustar(-15);
  assert.equal(d.finMs, r.ahora());
  assert.equal(d.restanteS(), 0);
  assert.equal(d.haTerminado(), true);
});

test('saltar() termina el descanso en el acto por el mismo camino que un fin natural', () => {
  const r = reloj();
  const d = crearDescanso({ duracionS: 90, ahora: r.ahora });
  r.avanzar(20_000);
  d.saltar();
  assert.equal(d.finMs, r.ahora());
  assert.equal(d.restanteS(), 0);
  assert.equal(d.haTerminado(), true);
});

test('restanteS() nunca baja de 0, por mucho que el reloj rebase el fin', () => {
  const r = reloj();
  const d = crearDescanso({ duracionS: 5, ahora: r.ahora });
  r.avanzar(3_600_000);                 // una hora con la app cerrada
  assert.equal(d.restanteS(), 0);
  d.ajustar(-15);                       // ajustar sobre un descanso vencido tampoco rompe
  assert.equal(d.restanteS(), 0);
});

test('sin reloj inyectado usa Date.now(): un descanso recién creado tiene su duración por delante', () => {
  const d = crearDescanso({ duracionS: 90 });
  assert.ok(d.restanteS() > 0 && d.restanteS() <= 90);
  assert.equal(d.haTerminado(), false);
});

test('formatear pinta m:ss', () => {
  assert.equal(formatear(0), '0:00');
  assert.equal(formatear(61), '1:01');
  assert.equal(formatear(90), '1:30');
  assert.equal(formatear(600), '10:00');
  assert.equal(formatear(5), '0:05');
  // Entrada rara no revienta el render: pinta 0:00 y ya.
  assert.equal(formatear(-30), '0:00');
  assert.equal(formatear(NaN), '0:00');
});

test('la capa de navegador importa y se llama en Node sin romper (detección de capacidades)', async () => {
  // En Node no hay navigator.wakeLock ni AudioContext: cada función debe
  // degradar en silencio, porque el módulo se importa igual en los tests.
  assert.equal(await pedirWakeLock(), null);
  assert.doesNotThrow(() => liberarWakeLock());
  assert.equal(prepararAudio(), null);
  assert.doesNotThrow(() => avisarFin());
});
