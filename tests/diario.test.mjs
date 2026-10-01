// Tests de las funciones puras del Diario (js/diario.js) — correr con: npm test
// Fixtures INLINE a propósito: los tests no leen data/alimentos.json (ese
// archivo es de la app, cambia por fuera y aquí solo metería ruido).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarTexto, construirIndice, buscar,
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
