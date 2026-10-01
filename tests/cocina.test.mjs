import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarPedido, clavePedido, compararConCocina, llamarCocina, normalizarRespuesta, origenMeta, K_DE_ETIQUETA, MODO_DEMO } from '../js/cocina.js';
import { calcularMeta, metaManualComida, metaManualTotal } from '../js/calc.js';

const meta = { kcal: 744, prot: 45, carb: 96, gras: 20, comidas: 3, objetivo: 'manual' };
const lineas = [
  { id: 'P01', nombre: 'Pollo al cilantro y limón', tamano: 1, g: 150, precio: 144, macros: { kcal: 165, prot: 31, carb: 0, gras: 3.5 } },
  { id: 'C01', nombre: 'Arroz con edamame y granada', tamano: 3, g: 360, precio: 75, macros: { kcal: 441, prot: 9, carb: 84, gras: 7.8 } },
  { id: 'G01', nombre: 'Guacamole artesanal', tamano: 1, g: 60, precio: 14, macros: { kcal: 96, prot: 1, carb: 5, gras: 9 } },
];
const local = { lineas, total: 233, macros: { kcal: 702, prot: 41, carb: 89, gras: 20.3 } };
const lineaCocina = l => ({ id: l.id, nombre: l.nombre, tamano: Object.keys(K_DE_ETIQUETA).find(k => K_DE_ETIQUETA[k] === l.tamano), g: l.g, macros: l.macros, precio: l.precio });
const respuestaIgual = () => ({ pedido_id: 'PED-20260917120000-P01C01G01', lineas: lineas.map(lineaCocina), macros_totales: { ...local.macros }, total: 233, coincide_con_la_app: true, rechazados: [] });

test('armarPedido sigue el contrato: los cuatro macros, el origen de la meta, sin vacío y tamaño en cada línea', () => {
  const p = armarPedido(meta, lineas);
  assert.deepEqual(Object.keys(p.macros_objetivo), ['kcal', 'prot', 'carb', 'gras']);
  assert.deepEqual(p.restricciones, { sin: [] });
  assert.deepEqual(p.seleccion, [{ id: 'P01', tamano: 1 }, { id: 'C01', tamano: 3 }, { id: 'G01', tamano: 1 }]);
  assert.equal(p.meta_origen, 'manual_dia');   // objetivo 'manual' con 3 comidas
  assert.equal(p.comidas, 3);
  assert.equal('upsell_aceptado' in p, false);
});

test('la meta viaja con su origen: fórmula, manual por comida o manual por día', () => {
  const formula = calcularMeta({ sexo: 'masculino', edad: 28, peso: 75, altura: 175, comidas: 4, objetivo: 'mantener', actividad: 'moderado' });
  assert.equal(origenMeta(formula), 'formula');
  assert.equal(armarPedido(formula, lineas).comidas, 4);
  const comida = metaManualComida({ prot: 45, carb: 60, gras: 20 });
  assert.equal(origenMeta(comida), 'manual_comida');
  assert.equal(armarPedido(comida, lineas).comidas, 1);
  const dia = metaManualTotal({ protTotal: 150, carbTotal: 200, grasTotal: 65, comidas: 3 });
  assert.equal(origenMeta(dia), 'manual_dia');
  const p = armarPedido(dia, lineas);
  assert.equal(p.comidas, 3);
  // Lo que cocina recibe son siempre macros POR COMIDA, ya repartidos.
  assert.deepEqual(p.macros_objetivo, { kcal: dia.kcal, prot: 50, carb: 67, gras: 22 });
  // El origen no cambia la clave del plato: misma meta y misma selección, mismo pedido.
  assert.equal(clavePedido(armarPedido(dia, lineas)), clavePedido(armarPedido({ ...dia, objetivo: 'mantener' }, lineas)));
});

test('el upsell aceptado añade sus dos campos sin cambiar la clave del plato', () => {
  const base = armarPedido(meta, lineas);
  const con = armarPedido(meta, lineas, { upsell_aceptado: true, pedido_id_previo: 'PED-1' });
  assert.equal(con.upsell_aceptado, true);
  assert.equal(con.pedido_id_previo, 'PED-1');
  assert.equal(clavePedido(base), clavePedido(con));
  assert.notEqual(clavePedido(base), clavePedido(armarPedido(meta, lineas.slice(1))));
});

test('sin discrepancia cuando cocina devuelve exactamente lo que ve la pantalla', () => {
  const d = compararConCocina(local, respuestaIgual());
  assert.equal(d.hay, false);
  assert.equal(d.total, null);
  assert.deepEqual(d.lineas, []);
  assert.equal(d.macros, null);
});

test('un total distinto es discrepancia y trae las dos cifras', () => {
  const r = respuestaIgual(); r.total = 250;
  const d = compararConCocina(local, r);
  assert.equal(d.hay, true);
  assert.deepEqual(d.total, { local: 233, cocina: 250 });
});

test('una línea con otro tamaño se lista con lo que decía la pantalla y lo que calculó cocina', () => {
  const r = respuestaIgual();
  r.lineas[0] = { ...r.lineas[0], tamano: 'Grande', g: 225, precio: 173, macros: { kcal: 248, prot: 47, carb: 0, gras: 5.3 } };
  r.total = 262; r.macros_totales = { kcal: 785, prot: 57, carb: 89, gras: 22.1 };
  const d = compararConCocina(local, r);
  assert.equal(d.hay, true);
  assert.equal(d.lineas.length, 1);
  assert.equal(d.lineas[0].id, 'P01');
  assert.equal(d.lineas[0].local.tamano, 1);
  assert.equal(d.lineas[0].cocina.tamano, 1.5);
  assert.equal(d.lineas[0].cocina.etiqueta, 'Grande');
  assert.deepEqual(d.macros.cocina, { kcal: 785, prot: 57, carb: 89, gras: 22.1 });
});

test('un módulo rechazado por cocina aparece como línea que falta, con su motivo', () => {
  const r = respuestaIgual();
  r.lineas = r.lineas.filter(l => l.id !== 'C01'); r.total = 158;
  r.rechazados = [{ id: 'C01', nombre: 'Arroz con edamame y granada', motivo: 'no disponible hoy' }];
  const d = compararConCocina(local, r);
  assert.equal(d.hay, true);
  const falta = d.lineas.find(l => l.id === 'C01');
  assert.equal(falta.cocina, null);
  assert.equal(falta.motivo, 'no disponible hoy');
});

test('coincide_con_la_app en false sin ninguna cifra distinta no pinta discrepancia (no habría nada que enseñar)', () => {
  const r = respuestaIgual(); r.coincide_con_la_app = false;
  const d = compararConCocina(local, r);
  assert.equal(d.hay, false);
  assert.equal(d.coincide, false);
});

test('normalizar: la respuesta real del contrato pasa entera', () => {
  const r = normalizarRespuesta({ ...respuestaIgual(), explicacion: ' Tu plato queda bien. ', avisos: [], propuesta_cierre: null, motivo_sin_propuesta: 'ya está en umbral' });
  assert.ok(r);
  assert.equal(r.explicacion, 'Tu plato queda bien.');
  assert.equal(r.lineas.length, 3);
  assert.equal(r.total, 233);
  assert.equal(r.motivo_sin_propuesta, 'ya está en umbral');
});

test('normalizar: total nulo, ausente o basura tumba la respuesta entera (nunca $0 ni $NaN en pantalla)', () => {
  for (const total of [null, undefined, 'abc', {}, NaN]) {
    const r = respuestaIgual(); r.total = total; if (total === undefined) delete r.total;
    assert.equal(normalizarRespuesta(r), null, `total=${String(total)}`);
  }
  const r = respuestaIgual(); delete r.macros_totales;
  assert.equal(normalizarRespuesta(r), null);
});

test('normalizar: una línea con tamaño desconocido o sin macros tumba la respuesta', () => {
  const a = respuestaIgual(); a.lineas[0].tamano = 'Mediana';
  assert.equal(normalizarRespuesta(a), null);
  const b = respuestaIgual(); delete b.lineas[1].macros;
  assert.equal(normalizarRespuesta(b), null);
});

test('normalizar: lo accesorio se limpia campo a campo', () => {
  const r = respuestaIgual();
  r.explicacion = { texto: 'no' }; r.avisos = 'ojo'; r.rechazados = [null, 'x', { id: 'C02', motivo: 'no disponible hoy' }, { id: 'V01' }];
  r.propuesta_cierre = { id: 'C02', tamano: 'Mediana', precio_extra: 10 };
  const n = normalizarRespuesta(r);
  assert.equal(n.explicacion, '');
  assert.deepEqual(n.avisos, []);
  assert.deepEqual(n.rechazados, [{ id: 'C02', nombre: '', motivo: 'no disponible hoy' }]);
  assert.equal(n.propuesta_cierre, null);
  const r2 = respuestaIgual(); r2.propuesta_cierre = { id: 'C02', tamano: 'Estándar', precio_extra: '25' };
  assert.equal(normalizarRespuesta(r2).propuesta_cierre.precio_extra, 25);
  assert.equal(normalizarRespuesta(r2).propuesta_cierre.descripcion, '');
});

test('normalizar: pedido_id no ASCII o vacío tumba la respuesta', () => {
  const a = respuestaIgual(); a.pedido_id = 'PED-ñ';
  assert.equal(normalizarRespuesta(a), null);
  const b = respuestaIgual(); b.pedido_id = '';
  assert.equal(normalizarRespuesta(b), null);
});

// ── MODO DEMO · en esta copia el envío a cocina está apagado ─────────────────
// Las pruebas de la ruta real (más abajo) pasan `modoDemo: false` a propósito:
// esa maquinaria tiene que seguir funcionando para cuando el dueño encienda el
// envío con un webhook propio, pero el DEFAULT del repo nunca toca la red.

test('MODO_DEMO viene encendido: el default de esta copia no envía a cocina', () => {
  assert.equal(MODO_DEMO, true);
});

test('en modo demo la llamada no toca la red: resuelve a motivo "demo" sin invocar fetch', async () => {
  let llamadas = 0;
  const fetchImpl = async () => { llamadas++; return { ok: true, status: 200, json: async () => respuestaIgual() }; };
  const { promesa, cancelar } = llamarCocina(armarPedido(meta, lineas), { fetchImpl });   // sin modoDemo: aplica el default
  cancelar();   // cancelar existe y no rompe, aunque en demo no haya nada que abortar
  const r = await promesa;
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'demo');
  assert.deepEqual(r.errores, []);
  assert.equal(llamadas, 0);
});

test('un 200 con ok:false conserva los errores que mandó cocina', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, errores: ['seleccion: 3 módulos de carbohidrato; el máximo son 2 por categoría'] }) });
  const r = await llamarCocina({}, { fetchImpl, modoDemo: false }).promesa;
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'http');
  assert.equal(r.errores.length, 1);
});

test('llamarCocina devuelve la respuesta ya normalizada', async () => {
  const cruda = respuestaIgual(); cruda.avisos = 'no-array'; cruda.total = '233';
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => cruda });
  const r = await llamarCocina({}, { fetchImpl, modoDemo: false }).promesa;
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.avisos, []);
  assert.equal(r.data.total, 233);
});

const respOk = body => ({ ok: true, status: 200, json: async () => body });

test('llamarCocina devuelve la respuesta cuando cocina contesta 200 con un pedido', async () => {
  const pedido = armarPedido(meta, lineas);
  let enviado = null;
  const fetchImpl = async (url, init) => { enviado = JSON.parse(init.body); return respOk(respuestaIgual()); };
  const { promesa } = llamarCocina(pedido, { fetchImpl, modoDemo: false });
  const r = await promesa;
  assert.equal(r.ok, true);
  assert.equal(r.data.pedido_id, 'PED-20260917120000-P01C01G01');
  assert.deepEqual(enviado.seleccion, pedido.seleccion);
});

test('un 400 de cocina termina en sin confirmar con los errores que mandó', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, errores: ['seleccion: hay ids repetidos'] }) });
  const r = await llamarCocina({}, { fetchImpl, modoDemo: false }).promesa;
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'http');
  assert.deepEqual(r.errores, ['seleccion: hay ids repetidos']);
});

test('un 200 que no es un pedido (html, vacío) no se toma por confirmación', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error('no json'); } });
  const r = await llamarCocina({}, { fetchImpl, modoDemo: false }).promesa;
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'respuesta_invalida');
});

test('el fallo de red termina en sin confirmar', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const r = await llamarCocina({}, { fetchImpl, modoDemo: false }).promesa;
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'red');
});

test('pasado el timeout la llamada se aborta y termina en sin confirmar', async () => {
  const fetchImpl = (url, init) => new Promise((_, rej) => { init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
  const t0 = Date.now();
  const r = await llamarCocina({}, { fetchImpl, timeoutMs: 40, modoDemo: false }).promesa;
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'timeout');
  assert.ok(Date.now() - t0 < 1000);
});

test('cancelar (el cliente editó el plato) no se confunde con un timeout', async () => {
  const fetchImpl = (url, init) => new Promise((_, rej) => { init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
  const { promesa, cancelar } = llamarCocina({}, { fetchImpl, timeoutMs: 5000, modoDemo: false });
  cancelar();
  const r = await promesa;
  assert.equal(r.motivo, 'cancelado');
});
