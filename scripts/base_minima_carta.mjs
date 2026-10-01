// Genera data/alimentos.json desde la carta COSECHA (js/data.js, bebidas,
// postres). Es la base MÍNIMA del Diario: valores propios del restaurante,
// nada inventado, convertidos a 100 g (o 100 ml en bebidas) desde la porción
// de la etiqueta — conversión de unidades, no corrección. Cuando la base
// grande (USDA) esté lista, su generador REEMPLAZA este archivo y este script
// deja de usarse: no sobrescribas la base grande con él.
//   node scripts/base_minima_carta.mjs
import { ING } from '../js/data.js';
import { BEB } from '../js/bebidas.js';
import { POS } from '../js/postres.js';
import { writeFileSync } from 'node:fs';

const r2 = v => Math.round(v * 100) / 100;
const por100 = (it, base) => ({
  kcal: r2(it.kcal / base * 100),
  proteina_g: r2(it.prot / base * 100),
  carbohidratos_g: r2(it.carb / base * 100),
  grasa_g: r2(it.gras / base * 100),
});
const desvia = a => Math.abs(a.kcal - (4 * a.proteina_g + 4 * a.carbohidratos_g + 9 * a.grasa_g)) / Math.max(a.kcal, 1) > 0.15;

const GRUPO = { proteina: 'Proteínas', carbohidrato: 'Cereales y tubérculos', vegetal: 'Verduras', grasa: 'Grasas', bebida: 'Bebidas', postre: 'Postres' };

let n = 0;
const fila = (it, base, porcionNombre, gramosPorcion) => {
  const m = por100(it, base);
  n += 1;
  return {
    id: 'ALI-' + String(n).padStart(4, '0'),
    nombre: it.nombre,
    sinonimos: [],
    grupo: GRUPO[it.cat] || 'Otros',
    estado: 'listo para comer',
    ...m,
    fibra_g: null,
    fuente: 'Carta COSECHA (js/data.js)',
    id_fuente: it.id,
    licencia: 'Propia',
    porciones: [{ nombre: porcionNombre, g: gramosPorcion, fuente: 'Carta COSECHA' }],
    kcalDesvia: desvia(m),
  };
};

const filas = [
  ...ING.map(it => fila(it, it.g, `Porción estándar (${it.g} g)`, it.g)),
  // Bebidas: la etiqueta es por pieza en ml; 1 ml ≈ 1 g para registrar en el diario.
  ...BEB.map(it => fila(it, it.ml, `Botella (${it.ml} ml)`, it.ml)),
  ...POS.map(it => fila(it, it.g, `Pieza (${it.g} g)`, it.g)),
];

writeFileSync(new URL('../data/alimentos.json', import.meta.url), JSON.stringify(filas, null, 1));
console.log(`data/alimentos.json: ${filas.length} alimentos de la carta (${filas.filter(f => f.kcalDesvia).length} con kcal que se desvía >15 % de 4/4/9, marcados)`);
