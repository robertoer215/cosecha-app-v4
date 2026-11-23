// Tests de las funciones puras del Diario (js/diario.js) — correr con: npm test
// Fixtures INLINE a propósito: los tests no leen data/alimentos.json (ese
// archivo es de la app, cambia por fuera y aquí solo metería ruido).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarTexto, construirIndice, buscar, buscarAgrupado, seccionDe, pidePlatillo,
  macrosDeCantidad, kcalDerivada, sumarDia, metaDelDia
} from '../js/diario.js';

// Alimentos con la forma del esquema de data/alimentos.json (por 100 g).
const POLLO = {
  id: 'ALI-1', nombre: 'Pechuga de pollo', sinonimos: ['pollo asado'],
  kcal: 120, proteina_g: 22.5, carbohidratos_g: 0, grasa_g: 2.6,
  porciones: [{ nombre: 'Pieza (150 g)', g: 150 }]
};
const ARROZ = {
  id: 'ALI-2', nombre: 'Arroz integral', sinonimos: [],
  kcal: 130, proteina_g: 2.7, carbohidratos_g: 28, grasa_g: 1, porciones: []
};
const PLATANO = {
  id: 'ALI-3', nombre: 'Plátano Tabasco', sinonimos: ['banana', 'guineo'],
  kcal: 89, proteina_g: 1.1, carbohidratos_g: 22.8, grasa_g: 0.3,
  porciones: [{ nombre: 'Pieza (120 g)', g: 120 }]
};
const ENSALADA = {
  id: 'ALI-4', nombre: 'Ensalada de arroz', sinonimos: [],
  kcal: 150, proteina_g: 4, carbohidratos_g: 20, grasa_g: 6, porciones: []
};
const BASE = [POLLO, ARROZ, PLATANO, ENSALADA];

function entrada(macros, extra = {}) {
  return {
    id: 'x', nombre: 'X', gramos: 100, porcion: null,
    macros: { kcalFuente: 0, ...macros }, origen: 'base', ts: 0, ...extra
  };
}

// ---------- normalizarTexto ----------

test('normalizarTexto: minúsculas y sin acentos', () => {
  assert.equal(normalizarTexto('PLÁTANO Tabasco'), 'platano tabasco');
  assert.equal(normalizarTexto('Café con azúcar'), 'cafe con azucar');
});

test('normalizarTexto: colapsa espacios y recorta extremos', () => {
  assert.equal(normalizarTexto('  arroz   integral  '), 'arroz integral');
});

test('normalizarTexto: null/undefined/número no lanzan y degradan a string', () => {
  assert.equal(normalizarTexto(null), '');
  assert.equal(normalizarTexto(undefined), '');
  assert.equal(normalizarTexto(42), '42');
});

// ---------- construirIndice ----------

test('construirIndice: indexa nombre y sinónimos normalizados y conserva el alimento', () => {
  const idx = construirIndice([PLATANO]);
  assert.equal(idx.length, 1);
  assert.equal(idx[0].nombre, 'platano tabasco');
  assert.ok(idx[0].texto.includes('banana'));
  assert.ok(idx[0].texto.includes('guineo'));
  // El alimento va por referencia, intacto: el detalle lo usa tal cual.
  assert.equal(idx[0].alimento, PLATANO);
});

test('construirIndice: basura (no-array, items sin nombre) no lanza y se descarta', () => {
  assert.deepEqual(construirIndice(null), []);
  assert.deepEqual(construirIndice('x'), []);
  const idx = construirIndice([POLLO, null, {}, { nombre: '' }, { nombre: 'Ok', sinonimos: 'no-array' }]);
  assert.deepEqual(idx.map(x => x.alimento.nombre), ['Pechuga de pollo', 'Ok']);
});

// ---------- buscar ----------

test('buscar: encuentra por nombre ignorando acentos y mayúsculas en ambos lados', () => {
  const idx = construirIndice(BASE);
  assert.deepEqual(buscar(idx, 'platano').map(a => a.id), ['ALI-3']);
  assert.deepEqual(buscar(idx, 'PLÁTANO').map(a => a.id), ['ALI-3']);
});

test('buscar: encuentra por sinónimo', () => {
  const idx = construirIndice(BASE);
  assert.deepEqual(buscar(idx, 'banana').map(a => a.id), ['ALI-3']);
});

test('buscar: consulta vacía o de puros espacios → lista vacía, no toda la base', () => {
  const idx = construirIndice(BASE);
  assert.deepEqual(buscar(idx, ''), []);
  assert.deepEqual(buscar(idx, '   '), []);
});

test('buscar: varias palabras exigen TODAS (AND), no cualquiera', () => {
  const idx = construirIndice(BASE);
  assert.deepEqual(buscar(idx, 'arroz integral').map(a => a.id), ['ALI-2']);
  assert.deepEqual(buscar(idx, 'arroz pollo'), []);
});

test('buscar: el nombre que EMPIEZA por la consulta gana al que solo la contiene', () => {
  const idx = construirIndice(BASE);
  assert.deepEqual(buscar(idx, 'arroz').map(a => a.id), ['ALI-2', 'ALI-4']);
});

test('buscar: respeta el límite', () => {
  const idx = construirIndice(BASE);
  assert.equal(buscar(idx, 'a', 2).length, 2);
});

// ---------- macrosDeCantidad ----------

test('macrosDeCantidad: 100 g devuelve los valores por 100 g tal cual', () => {
  const { gramos, macros } = macrosDeCantidad(POLLO, 100);
  assert.equal(gramos, 100);
  assert.deepEqual(macros, { prot: 22.5, carb: 0, gras: 2.6, kcalFuente: 120 });
});

test('macrosDeCantidad: escala a los gramos pedidos y redondea a 1 decimal', () => {
  const { gramos, macros } = macrosDeCantidad(POLLO, 150);
  assert.equal(gramos, 150);
  // 22.5 × 1.5 = 33.75 → 33.8; 2.6 × 1.5 = 3.9; 120 × 1.5 = 180
  assert.deepEqual(macros, { prot: 33.8, carb: 0, gras: 3.9, kcalFuente: 180 });
});

test('macrosDeCantidad con porción: la cantidad son PORCIONES y los gramos se derivan', () => {
  const { gramos, macros } = macrosDeCantidad(PLATANO, 2, { nombre: 'Pieza (120 g)', g: 120 });
  assert.equal(gramos, 240);
  assert.equal(macros.carb, Math.round(22.8 * 2.4 * 10) / 10);
});

test('macrosDeCantidad con media porción', () => {
  const { gramos } = macrosDeCantidad(POLLO, 0.5, { nombre: 'Pieza (150 g)', g: 150 });
  assert.equal(gramos, 75);
});

test('macrosDeCantidad: cantidad inválida (NaN, negativa, 0) degrada a 0, nunca lanza', () => {
  for (const mala of [NaN, -3, 0, undefined]) {
    const { gramos, macros } = macrosDeCantidad(POLLO, mala);
    assert.equal(gramos, 0);
    assert.deepEqual(macros, { prot: 0, carb: 0, gras: 0, kcalFuente: 0 });
  }
});

// ---------- cantidadVecina (el − / + del detalle) ----------
import { cantidadVecina } from '../js/diario.js';

test('cantidadVecina: − / + saltan al múltiplo vecino del paso y no bajan del primero', () => {
  assert.equal(cantidadVecina(1, 0.5, true), 1.5);
  assert.equal(cantidadVecina(1, 0.5, false), 0.5);
  assert.equal(cantidadVecina(0.5, 0.5, false), 0.5);
  assert.equal(cantidadVecina(1.25, 0.5, true), 1.5);
  assert.equal(cantidadVecina(78, 10, true), 80);
  assert.equal(cantidadVecina(78, 10, false), 70);
  assert.equal(cantidadVecina(80, 10, false), 70);
  assert.equal(cantidadVecina(NaN, 10, true), 10);
  assert.equal(cantidadVecina(NaN, 0.5, false), 0.5);
});

// ---------- kcalDerivada ----------

test('kcalDerivada: 4P + 4C + 9G exacto', () => {
  assert.equal(kcalDerivada({ prot: 45, carb: 60, gras: 20 }), 600);
  assert.equal(kcalDerivada({ prot: 0, carb: 0, gras: 0 }), 0);
});

test('kcalDerivada: campos ausentes o basura cuentan como 0', () => {
  assert.equal(kcalDerivada({ prot: 10 }), 40);
  assert.equal(kcalDerivada({}), 0);
  assert.equal(kcalDerivada(null), 0);
});

// ---------- sumarDia ----------

test('sumarDia: día ausente → todo en cero con las 4 comidas presentes', () => {
  const s = sumarDia(undefined);
  assert.deepEqual(
    { prot: s.prot, carb: s.carb, gras: s.gras, kcal: s.kcal },
    { prot: 0, carb: 0, gras: 0, kcal: 0 }
  );
  assert.deepEqual(Object.keys(s.comidas), ['desayuno', 'comida', 'cena', 'colaciones']);
});

test('sumarDia: suma macros de todas las comidas y deriva la kcal del TOTAL', () => {
  const dia = {
    desayuno: [entrada({ prot: 20, carb: 30, gras: 5 })],
    comida: [entrada({ prot: 40, carb: 50, gras: 15 }), entrada({ prot: 5, carb: 0, gras: 0 })],
    cena: [],
    colaciones: []
  };
  const s = sumarDia(dia);
  assert.equal(s.prot, 65);
  assert.equal(s.carb, 80);
  assert.equal(s.gras, 20);
  // Coherencia: la kcal total ES la derivada de los macros totales.
  assert.equal(s.kcal, kcalDerivada(s));
});

test('sumarDia: subtotal por comida con su propia kcal derivada', () => {
  const dia = { desayuno: [entrada({ prot: 10, carb: 20, gras: 4 })] };
  const s = sumarDia(dia);
  assert.deepEqual(s.comidas.desayuno, { prot: 10, carb: 20, gras: 4, kcal: 156 });
  assert.equal(s.comidas.cena.kcal, 0);
});

// ---------- metaDelDia ----------

const META = (origen, comidas) => ({ kcal: 600, prot: 45, carb: 60, gras: 20, comidas, origen });

test('metaDelDia: sin meta → null', () => {
  assert.equal(metaDelDia(null, null), null);
  assert.equal(metaDelDia(undefined, { comidasDiario: 3 }), null);
});

test('metaDelDia: fórmula multiplica por meta.comidas', () => {
  const md = metaDelDia(META('formula', 3), null);
  assert.deepEqual(md, { kcal: 1800, prot: 135, carb: 180, gras: 60, n: 3 });
});

test('metaDelDia: manual_dia multiplica por meta.comidas', () => {
  assert.equal(metaDelDia(META('manual_dia', 4), null).prot, 180);
});

test('metaDelDia: manual_comida sin comidasDiario → pendiente (la UI pregunta UNA vez)', () => {
  assert.deepEqual(metaDelDia(META('manual_comida', 1), null), { pendiente: true });
  assert.deepEqual(metaDelDia(META('manual_comida', 1), { comidasDiario: null }), { pendiente: true });
});

test('metaDelDia: manual_comida con perfil.comidasDiario multiplica por él', () => {
  const md = metaDelDia(META('manual_comida', 1), { comidasDiario: 4 });
  assert.deepEqual(md, { kcal: 2400, prot: 180, carb: 240, gras: 80, n: 4 });
});

test('metaDelDia: meta.comidas nulo o inválido (metaCache migrada) degrada a ×1', () => {
  assert.equal(metaDelDia(META('formula', null), null).n, 1);
  assert.equal(metaDelDia(META('formula', 0), null).n, 1);
});

test('metaDelDia: la kcal del día sigue cuadrando 4/4/9 si la meta por comida cuadraba', () => {
  const md = metaDelDia(META('formula', 3), null);
  assert.equal(md.kcal, kcalDerivada(md));
});

// ---------- estadoMacro («Tu día»: lo que falta o sobra en cada barra) ----------
import { estadoMacro } from '../js/diario.js';

test('estadoMacro: lo que falta, «en tu meta» (±4 g) y lo que sobra con «+»', () => {
  assert.equal(estadoMacro(80, 120, 'g'), 'faltan 40 g');
  assert.equal(estadoMacro(118, 120, 'g'), 'en tu meta');
  assert.equal(estadoMacro(124, 120, 'g'), 'en tu meta');
  assert.equal(estadoMacro(169, 120, 'g'), '+49 g');
  assert.equal(estadoMacro(2854, 2637, 'kcal'), '+217 kcal');
  assert.equal(estadoMacro(2600, 2637, 'kcal'), 'en tu meta');
  assert.equal(estadoMacro(0, 0, 'g'), 'en tu meta');
});

// ---------- orden intuitivo: lo común primero, platillos aparte ----------
const BASE_ORDEN = [
  { id: 'T1', nombre: 'Tortilla de harina de trigo integral', grupo: 'Cereales y tubérculos', estado: 'listo para comer' },
  { id: 'T2', nombre: 'Tortilla de maíz', grupo: 'Cereales y tubérculos', estado: 'listo para comer' },
  { id: 'T3', nombre: 'Taco de tortilla de maíz con res', grupo: 'Platillos y antojitos (FNDDS)', estado: 'listo para comer' },
  { id: 'P1', nombre: 'Pollo en mole', grupo: 'Platillos y antojitos (FNDDS)', estado: 'listo para comer' },
  { id: 'P2', nombre: 'Pollo entero con piel, rostizado', grupo: 'Carnes y aves', estado: 'cocido' },
  { id: 'P3', nombre: 'Pechuga de pollo sin piel, asada', grupo: 'Carnes y aves', estado: 'cocido' },
  { id: 'P4', nombre: 'Pollo al cilantro y limón (COSECHA)', grupo: 'Carta COSECHA', estado: 'listo para comer', fuente: 'Carta COSECHA (js/data.js)' },
  { id: 'H1', nombre: 'Huevo de codorniz entero crudo', grupo: 'Lácteos y huevo', estado: 'crudo' },
  { id: 'H2', nombre: 'Huevo entero cocido (duro)', grupo: 'Lácteos y huevo', estado: 'cocido' },
  { id: 'B1', nombre: 'Plátano macho verde, crudo', grupo: 'Frutas', estado: 'crudo' },
  { id: 'B2', nombre: 'plátano maduro y semimaduro, crudo', grupo: 'Frutas', estado: 'crudo' },
];

test('orden: "tortilla" trae primero la de maíz y deja los tacos en Platillos', () => {
  const g = buscarAgrupado(construirIndice(BASE_ORDEN), 'tortilla');
  assert.deepEqual(g.alimentos.map(a => a.id), ['T2', 'T1']);
  assert.deepEqual(g.platillos.map(a => a.id), ['T3']);
});

test('orden: "pollo" abre con la pechuga; el guisado va a Platillos y lo de la carta a COSECHA', () => {
  const g = buscarAgrupado(construirIndice(BASE_ORDEN), 'pollo');
  assert.equal(g.alimentos[0].id, 'P3');
  assert.deepEqual(g.platillos.map(a => a.id), ['P1']);
  assert.deepEqual(g.cosecha.map(a => a.id), ['P4']);
});

test('orden: lo raro baja ("huevo" → entero antes que codorniz; "plátano" → Tabasco antes que macho)', () => {
  const idx = construirIndice(BASE_ORDEN);
  assert.equal(buscar(idx, 'huevo')[0].id, 'H2');
  assert.equal(buscar(idx, 'platano')[0].id, 'B2');
  assert.equal(buscar(idx, 'platano macho')[0].id, 'B1');
});

test('seccionDe: platillos y carta COSECHA se distinguen del resto', () => {
  assert.equal(seccionDe({ grupo: 'Platillos y antojitos (FNDDS)' }), 'platillos');
  assert.equal(seccionDe({ grupo: 'Carta COSECHA' }), 'cosecha');
  assert.equal(seccionDe({ grupo: 'Frutas' }), 'alimentos');
});

test('alimento solo: lo que va "con" otra cosa baja; "con piel" no cuenta', () => {
  const idx = construirIndice([
    { id: 'A1', nombre: 'Arroz blanco cocido con aceite', grupo: 'Cereales y tubérculos', estado: 'cocido' },
    { id: 'A2', nombre: 'Arroz blanco cocido', grupo: 'Cereales y tubérculos', estado: 'cocido' },
    { id: 'C1', nombre: 'Pechuga de pollo con piel, asada', grupo: 'Carnes y aves', estado: 'cocido' },
    { id: 'C2', nombre: 'Pechuga de pollo con verduras', grupo: 'Carnes y aves', estado: 'cocido' },
  ]);
  assert.equal(buscar(idx, 'arroz')[0].id, 'A2');
  assert.equal(buscar(idx, 'pechuga')[0].id, 'C1');
});

test('pidePlatillo: solo cuando la búsqueda nombra un platillo', () => {
  assert.equal(pidePlatillo('pollo'), false);
  assert.equal(pidePlatillo('tortilla'), false);
  assert.equal(pidePlatillo('tacos de pastor'), true);
  assert.equal(pidePlatillo('Tamal'), true);
  assert.equal(pidePlatillo('pollo en mole'), true);
});

// ── Orden "lo que la gente come" (3-nov-2026) ───────────────────────────────

const BASE_HUEVO = [
  { id: 'E1', nombre: 'Huevo entero frito', grupo: 'Lácteos y huevo', estado: 'cocido' },
  { id: 'E2', nombre: 'Huevo entero cocido (duro)', grupo: 'Lácteos y huevo', estado: 'cocido' },
  { id: 'E3', nombre: 'Huevos rancheros', grupo: 'Lácteos y huevo', estado: 'listo para comer' },
  { id: 'E4', nombre: 'Huevo revuelto u omelet sin grasa añadida', grupo: 'Lácteos y huevo', estado: 'cocido' },
  { id: 'E5', nombre: 'Huevo revuelto', grupo: 'Lácteos y huevo', estado: 'cocido' },
  { id: 'E6', nombre: 'Huevo de codorniz entero crudo', grupo: 'Lácteos y huevo', estado: 'crudo' },
  { id: 'E7', nombre: 'Burrito de huevo con chorizo', grupo: 'Platillos y antojitos (FNDDS)', estado: 'listo para comer' },
];

test('orden: "huevo" y "huevos" abren con el cocido y el revuelto; el platillo y lo compuesto van detrás', () => {
  const idx = construirIndice(BASE_HUEVO);
  for (const q of ['huevo', 'huevos', 'HUEVOS']) {
    const ids = buscar(idx, q).map(a => a.id);
    assert.deepEqual(ids.slice(0, 3), ['E2', 'E5', 'E1'], q);
    assert.ok(ids.indexOf('E3') > ids.indexOf('E1'), 'rancheros después del frito');
    assert.ok(ids.indexOf('E4') > ids.indexOf('E5'), 'el «u omelet» después del revuelto simple');
    assert.ok(ids.indexOf('E6') > ids.indexOf('E3'), 'codorniz después de los rancheros');
  }
  // El burrito con chorizo no es un alimento: va a Platillos, no a la lista principal.
  const g = buscarAgrupado(idx, 'huevos');
  assert.ok(!g.alimentos.some(a => a.id === 'E7'));
  assert.deepEqual(g.platillos.map(a => a.id), ['E7']);
});

test('orden: lo entre paréntesis no alarga el nombre («Leche entera (3.25% grasa)» antes que la deslactosada)', () => {
  const idx = construirIndice([
    { id: 'L1', nombre: 'Leche deslactosada entera', grupo: 'Lácteos y huevo', estado: 'listo para comer' },
    { id: 'L2', nombre: 'Leche entera (3.25% grasa)', grupo: 'Lácteos y huevo', estado: 'listo para comer' },
  ]);
  assert.equal(buscar(idx, 'leche')[0].id, 'L2');
});

test('proteína de suero: se encuentra por "whey", "proteína en polvo", "scoop" y va antes que la soya', () => {
  const idx = construirIndice([
    { id: 'S1', nombre: 'proteína aislada de soya', sinonimos: [], grupo: 'Leguminosas, semillas y grasas', estado: 'listo para comer' },
    { id: 'W1', nombre: 'Proteína de suero de leche (whey) en polvo', grupo: 'Lácteos y huevo', estado: 'listo para comer',
      sinonimos: ['whey', 'whey protein', 'proteína en polvo', 'proteína whey', 'scoop de proteína', 'suero de leche en polvo'] },
  ]);
  for (const q of ['whey', 'proteina en polvo', 'scoop', 'suero', 'Proteína']) {
    assert.equal(buscar(idx, q)[0].id, 'W1', q);
  }
  assert.deepEqual(buscar(idx, 'proteina').map(a => a.id), ['W1', 'S1']);
});

test('orden: "aceite" abre con el de oliva; "pollo" con la pechuga sin piel', () => {
  const idx = construirIndice([
    { id: 'O1', nombre: 'aceite de coco', grupo: 'Leguminosas, semillas y grasas', estado: 'listo para comer' },
    { id: 'O2', nombre: 'aceite de oliva', grupo: 'Leguminosas, semillas y grasas', estado: 'listo para comer' },
    { id: 'P1', nombre: 'Pechuga de pollo con piel, rostizada', grupo: 'Carnes y aves', estado: 'cocido' },
    { id: 'P2', nombre: 'Pechuga de pollo sin piel, rostizada', grupo: 'Carnes y aves', estado: 'cocido' },
  ]);
  assert.equal(buscar(idx, 'aceite')[0].id, 'O2');
  assert.equal(buscar(idx, 'pollo')[0].id, 'P2');
});

test('la base real tiene proteína de suero y el huevo crudo trae su pieza', async () => {
  const { readFileSync } = await import('node:fs');
  const base = JSON.parse(readFileSync(new URL('../data/alimentos.json', import.meta.url), 'utf8'));
  const idx = construirIndice(base);
  const w = buscar(idx, 'whey')[0];
  assert.ok(w && /suero de leche/i.test(w.nombre));
  assert.equal(w.fuente, 'USDA FDC (FNDDS)');
  assert.ok(w.porciones.some(p => /scoop/i.test(p.nombre) && p.g > 0));
  const crudo = base.find(a => a.nombre === 'Huevo entero crudo (grande)');
  assert.ok(crudo.porciones.some(p => /pieza/i.test(p.nombre) && p.g === 50.3));
  assert.equal(new Set(base.map(a => a.id)).size, base.length, 'ids únicos');
  assert.equal(new Set(base.map(a => a.fuente + a.id_fuente)).size, base.length, 'id_fuente únicos');
});
