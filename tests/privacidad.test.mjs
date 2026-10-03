// Tests de privacidad (docs/privacidad/) — correr con: npm test
//
// No prueban la ley: prueban que el código no se aleje de lo que el aviso
// promete. Si uno falla, casi siempre falta actualizar docs/privacidad/
// inventario.json y privacidad.html (ver docs/privacidad/README.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CLAVE, migrar, guardar, borrarTodo } from '../js/almacen.js';
import { AVISO_VERSION, RESPONSABLE, avisoAceptado, datoLegal } from '../js/privacidad.js';

const leer = ruta => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
const inventario = JSON.parse(leer('docs/privacidad/inventario.json'));
const jsArchivos = readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js'));
const cssArchivos = readdirSync(new URL('../css/', import.meta.url)).filter(f => f.endsWith('.css'));

// Storage en memoria con la interfaz que usa almacen.js (key/length incluidos:
// borrarTodo() recorre las claves).
function storageFalso(inicial = {}) {
  const datos = { ...inicial };
  return {
    datos,
    get length() { return Object.keys(datos).length; },
    key: i => Object.keys(datos)[i] ?? null,
    getItem: k => (k in datos ? datos[k] : null),
    setItem: (k, v) => { datos[k] = String(v); },
    removeItem: k => { delete datos[k]; }
  };
}

// Dominios a los que la app le pide algo al navegador. En HTML solo cuentan
// los recursos que se CARGAN (script, img, link…), no los enlaces <a>; en CSS,
// url() e @import; en JS, cualquier literal con URL absoluta (un literal en
// código es algo que el código usa). www.w3.org es el espacio de nombres SVG.
function dominiosDe(texto, tipo) {
  const pats = {
    html: [/<(?:script|img|iframe|source|video|audio|embed)\b[^>]*\bsrc=["']https?:\/\/([^/"'?#]+)/gi,
           /<link\b[^>]*\bhref=["']https?:\/\/([^/"'?#]+)/gi],
    css: [/url\(\s*["']?https?:\/\/([^/"')?#]+)/gi],
    js: [/["'`]https?:\/\/([^/"'`?#]+)/g]
  }[tipo];
  const fuera = new Set(['www.w3.org']);
  const res = new Set();
  for (const p of pats) for (const m of texto.matchAll(p)) if (!fuera.has(m[1])) res.add(m[1]);
  return res;
}

test('el aviso tiene UNA sola versión: js/privacidad.js = inventario.json = privacidad.html', () => {
  assert.equal(inventario.aviso.version, AVISO_VERSION);
  assert.match(leer('privacidad.html'), new RegExp(`data-legal="version">${AVISO_VERSION.replace('.', '\\.')}<`));
});

test('todo dominio externo que carga la app está declarado en el inventario', () => {
  const declarados = new Set(inventario.terceros.map(t => t.dominio));
  const usados = new Map();
  const anotar = (archivo, set) => set.forEach(d => usados.set(d, archivo));
  anotar('index.html', dominiosDe(leer('index.html'), 'html'));
  anotar('privacidad.html', dominiosDe(leer('privacidad.html'), 'html'));
  cssArchivos.forEach(f => anotar(`css/${f}`, dominiosDe(leer(`css/${f}`), 'css')));
  jsArchivos.forEach(f => anotar(`js/${f}`, dominiosDe(leer(`js/${f}`), 'js')));
  const sinDeclarar = [...usados].filter(([d]) => !declarados.has(d)).map(([d, f]) => `${d} (en ${f})`);
  assert.deepEqual(sinDeclarar, [], 'Declara estos dominios en docs/privacidad/inventario.json y en privacidad.html');
});

test('solo js/almacen.js toca el almacenamiento del navegador; nadie usa cookies', () => {
  const toca = /\b(?:localStorage|sessionStorage|indexedDB)\s*[.[]|document\.cookie/;
  const infractores = jsArchivos.filter(f => f !== 'almacen.js' && toca.test(leer(`js/${f}`)));
  assert.deepEqual(infractores, []);
  assert.doesNotMatch(leer('index.html'), toca);
});

test('la clave de almacenamiento vigente está declarada en el inventario', () => {
  assert.ok(inventario.almacenamiento_local.some(c => c.clave === CLAVE), `Falta "${CLAVE}" en inventario.json`);
});

test('borrarTodo quita todo lo de COSECHA y nada ajeno', () => {
  const st = storageFalso({ [CLAVE]: '{"v":1}', 'cosecha.v0': 'viejo', 'otra-app': 'ajeno' });
  assert.equal(borrarTodo(st), true);
  assert.deepEqual(Object.keys(st.datos), ['otra-app']);
});

test('tras borrarTodo nada resucita lo borrado en esa visita; otro storage sigue funcionando', () => {
  const st = storageFalso({ [CLAVE]: '{"v":1}' });
  borrarTodo(st);
  assert.equal(guardar({ v: 1 }, st), false);
  assert.equal(st.getItem(CLAVE), null);
  const otro = storageFalso();
  assert.equal(guardar({ v: 1 }, otro), true);
});

test('borrarTodo no lanza si el storage está bloqueado', () => {
  assert.equal(borrarTodo({ get length() { throw new Error('bloqueado'); } }), false);
});

test('el perfil conserva QUÉ versión del aviso se aceptó', () => {
  const base = { sexo: 'masculino', edad: 25, peso: 75, altura: 178, actividad: 'moderado', objetivo: 'mantener', comidas: 4, terminos: true };
  assert.equal(migrar({ v: 1, perfil: { ...base, avisoVersion: AVISO_VERSION } }).perfil.avisoVersion, AVISO_VERSION);
  assert.equal(migrar({ v: 1, perfil: { ...base, avisoVersion: 7 } }).perfil.avisoVersion, null);
  assert.equal(migrar({ v: 1, perfil: base }).perfil.avisoVersion, null);
});

test('solo cuenta la aceptación del aviso VIGENTE', () => {
  assert.equal(avisoAceptado({ terminos: true, avisoVersion: AVISO_VERSION }), true);
  assert.equal(avisoAceptado({ terminos: true, avisoVersion: '0.9' }), false);
  assert.equal(avisoAceptado({ terminos: true, avisoVersion: null }), false);
  assert.equal(avisoAceptado({ terminos: false, avisoVersion: AVISO_VERSION }), false);
  assert.equal(avisoAceptado(null), false);
});

test('los datos del responsable nunca se inventan: vacío = pendiente', () => {
  for (const k of Object.keys(RESPONSABLE)) {
    const v = RESPONSABLE[k];
    assert.ok(v === null || (typeof v === 'string' && v.trim()), `RESPONSABLE.${k} debe ser null o texto real`);
    if (v === null) assert.equal(datoLegal(k), null);
  }
});
