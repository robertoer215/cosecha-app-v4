// Fusiona los chunks traducidos de free-exercise-db (es-MX) en
// data/ejercicios.json con QA estricto: ids únicos, campos completos, listas
// de músculos no vacías. Un chunk malformado se reporta y se EXCLUYE entero
// antes que publicar filas rotas.
//   node scripts/fusionar_ejercicios.mjs <dir-con-ej-es-chunk-*.json>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('uso: node scripts/fusionar_ejercicios.mjs <dir>'); process.exit(1); }

const CAMPOS = ['id', 'nombre', 'nombreEn', 'musculosPrimarios', 'musculosSecundarios', 'equipo', 'nivel', 'categoria', 'instrucciones', 'imagenes'];
const valido = e => e && typeof e === 'object'
  && CAMPOS.every(c => c in e)
  && typeof e.id === 'string' && e.id
  && typeof e.nombre === 'string' && e.nombre.trim()
  && Array.isArray(e.musculosPrimarios) && e.musculosPrimarios.length > 0
  && typeof e.equipo === 'string'
  && ['principiante', 'intermedio', 'avanzado'].includes(e.nivel)
  && Array.isArray(e.instrucciones)
  && Array.isArray(e.imagenes);

const archivos = readdirSync(dir).filter(f => /^ej-es-chunk-\d+\.json$/.test(f)).sort();
const vistos = new Set();
const fuera = [];
const todos = [];
for (const f of archivos) {
  let arr;
  try { arr = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { fuera.push(`${f}: JSON inválido`); continue; }
  if (!Array.isArray(arr)) { fuera.push(`${f}: no es array`); continue; }
  const malos = arr.filter(e => !valido(e));
  if (malos.length) { fuera.push(`${f}: ${malos.length} filas inválidas (chunk excluido)`); continue; }
  for (const e of arr) {
    if (vistos.has(e.id)) { fuera.push(`${f}: id duplicado ${e.id} (omitido)`); continue; }
    vistos.add(e.id);
    todos.push(e);
  }
}
todos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
writeFileSync(new URL('../data/ejercicios.json', import.meta.url), JSON.stringify(todos, null, 1));
console.log(`data/ejercicios.json: ${todos.length} ejercicios desde ${archivos.length} chunks`);
if (fuera.length) { console.log('EXCLUIDO/OMITIDO:'); fuera.forEach(x => console.log(' -', x)); }
