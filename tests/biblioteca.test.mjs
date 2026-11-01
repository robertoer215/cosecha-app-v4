// Tests de js/biblioteca.js: agrupación en maestros, filtros por casillas y
// orden por popularidad. Fixtures inline + un chequeo de integridad de los
// datos reales (data/grupos-ejercicios.json contra data/ejercicios.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizar, equipoDe, construirMaestros, buscarMaestros, filtrosVacios, cuentaFiltros,
         marcarFiltro, quitarFiltro, partesMarcadas, zonasParaAfinar, zonaDe, nombreParte, ZONAS,
         OPCIONES_FILTRO } from '../js/biblioteca.js';

const ej = (id, nombre, equipo, musculo, extra = {}) => ({ id, nombre, nombreEn: id, equipo,
  musculosPrimarios: [musculo], musculosSecundarios: [], categoria: 'fuerza', nivel: 'principiante', ...extra });

const CATALOGO = [
  ej('BB', 'Press de banca - Barra', 'barra', 'pecho'),
  ej('DB', 'Press de banca - Mancuerna', 'mancuernas', 'pecho'),
  ej('SM', 'Press de banca - Smith', 'máquina', 'pecho'),
  ej('IN', 'Press inclinado - Mancuerna', 'mancuernas', 'pecho', { nivel: 'intermedio' }),
  ej('OHP', 'Press militar de pie - Barra', 'barra', 'hombros'),
  ej('FP', 'Face pull - Polea', 'polea', 'hombros'),
  ej('RARO', 'Abdominal raro', 'no especificado', 'abdomen', { categoria: 'estiramiento' }),
  ej('DUP', 'Press de banca - Barra (duplicado)', 'barra', 'pecho'),
];
const GRUPOS = {
  maestros: [
    { nombre: 'Press de banca', grupos: [
      { nombre: 'Plano', variantes: [{ id: 'DB', etiqueta: 'Mancuernas', pop: 4 }, { id: 'BB', etiqueta: 'Barra', pop: 5 },
        { id: 'SM', etiqueta: 'Smith', pop: 3 }] },
      { nombre: 'Inclinado', variantes: [{ id: 'IN', etiqueta: 'Mancuernas', pop: 4 }, { id: 'NO-EXISTE', etiqueta: 'X', pop: 5 }] },
    ] },
    { nombre: 'Press militar', variantes: [{ id: 'OHP', etiqueta: 'De pie', pop: 5 }] },
    { nombre: 'Maestro vacío', variantes: [{ id: 'NO-EXISTE-2', etiqueta: 'X', pop: 1 }] },
  ],
  sueltos: { FP: 4 },
  ocultos: ['DUP'],
};

test('normalizar quita acentos y mayúsculas', () => {
  assert.equal(normalizar('Press Francés'), 'press frances');
});

test('equipoDe separa Smith y barra Z y junta «no especificado» con «otro»', () => {
  assert.equal(equipoDe({ nombre: 'Press de banca - Smith', equipo: 'máquina' }), 'Smith');
  assert.equal(equipoDe({ nombre: 'Curl con barra Z agarre cerrado', equipo: 'barra' }), 'barra Z');
  assert.equal(equipoDe({ nombre: 'Algo', equipo: 'no especificado' }), 'otro');
  assert.equal(equipoDe({ nombre: 'Algo', equipo: 'mancuernas' }), 'mancuernas');
});

test('construirMaestros agrupa, salta ids perdidos y deja sueltos los no agrupados', () => {
  const ms = construirMaestros(CATALOGO, GRUPOS);
  assert.deepEqual(ms.map(m => m.nombre), ['Press de banca', 'Press militar', 'Face pull - Polea', 'Abdominal raro']);
  assert.equal(ms[0].n, 4);
  assert.equal(ms.reduce((s, m) => s + m.n, 0), CATALOGO.length - 1, 'ningún ejercicio se pierde ni se repite; el oculto no sale');
  assert.ok(!ms.some(m => m.grupos.some(g => g.variantes.some(v => v.e.id === 'DUP'))), 'el duplicado oculto no se lista');
  assert.equal(ms.find(m => m.nombre === 'Face pull - Polea').pop, 4, 'popularidad de sueltos');
  assert.equal(ms.find(m => m.nombre === 'Abdominal raro').pop, 1, 'popularidad por defecto');
});

test('construirMaestros sin archivo de grupos, o con forma rota: cada ejercicio es su propio maestro', () => {
  assert.equal(construirMaestros(CATALOGO, null).length, CATALOGO.length);
  assert.equal(construirMaestros(CATALOGO, { maestros: { roto: true } }).length, CATALOGO.length);
  assert.equal(construirMaestros(CATALOGO, { maestros: [{ nombre: 'X', variantes: 'no es lista' }] }).length, CATALOGO.length);
});

test('buscarMaestros sin texto ni filtros ordena por popularidad, y adentro también', () => {
  const r = buscarMaestros(construirMaestros(CATALOGO, GRUPOS), '', filtrosVacios());
  assert.deepEqual(r.map(x => x.m.nombre), ['Press de banca', 'Press militar', 'Face pull - Polea', 'Abdominal raro']);
  assert.deepEqual(r[0].grupos.map(g => g.nombre), ['Plano', 'Inclinado']);
  assert.deepEqual(r[0].grupos[0].variantes.map(v => v.etiqueta), ['Barra', 'Mancuernas', 'Smith']);
});

test('buscarMaestros: el maestro que empieza con lo escrito va primero', () => {
  const r = buscarMaestros(construirMaestros(CATALOGO, GRUPOS), 'press militar', filtrosVacios());
  assert.equal(r[0].m.nombre, 'Press militar');
  assert.equal(r.length, 1);
});

test('buscarMaestros: el texto del maestro y del grupo cuenta para encontrar la variante', () => {
  const r = buscarMaestros(construirMaestros(CATALOGO, GRUPOS), 'banca inclinado', filtrosVacios());
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].grupos.map(g => g.nombre), ['Inclinado']);
});

test('buscarMaestros: casillas del mismo filtro suman y filtros distintos se combinan', () => {
  const ms = construirMaestros(CATALOGO, GRUPOS);
  const f = filtrosVacios();
  f.equipo.add('mancuernas'); f.equipo.add('Smith');
  let r = buscarMaestros(ms, '', f);
  assert.deepEqual(r.map(x => x.m.nombre), ['Press de banca']);
  assert.deepEqual(r[0].grupos[0].variantes.map(v => v.etiqueta), ['Mancuernas', 'Smith'], 'solo las variantes que pasan');
  f.nivel.add('intermedio');
  r = buscarMaestros(ms, '', f);
  assert.deepEqual(r[0].grupos.map(g => g.nombre), ['Inclinado']);
  assert.equal(r[0].n, 1);
  assert.equal(cuentaFiltros(f), 3);
  const g = filtrosVacios();
  g.musculo.add('hombros'); g.musculo.add('abdomen');
  assert.deepEqual(buscarMaestros(ms, '', g).map(x => x.m.nombre), ['Press militar', 'Face pull - Polea', 'Abdominal raro']);
  const t = filtrosVacios();
  t.tipo.add('estiramiento');
  assert.deepEqual(buscarMaestros(ms, '', t).map(x => x.m.nombre), ['Abdominal raro']);
});

test('Músculo filtra por zonas generales y se puede afinar dentro de una zona', () => {
  const cat = [
    ej('CB', 'Curl de bíceps - Barra', 'barra', 'bíceps'),
    ej('TP', 'Extensión de tríceps - Polea', 'polea', 'tríceps'),
    ej('MU', 'Curl de muñeca - Barra', 'barra', 'antebrazos'),
    ej('SQ', 'Sentadilla - Barra', 'barra', 'cuádriceps'),
    ej('SH', 'Encogimientos - Barra', 'barra', 'trapecios'),
    ej('PM', 'Peso muerto - Barra', 'barra', 'lumbar'),
  ];
  const ms = construirMaestros(cat, null);
  const nombres = f => buscarMaestros(ms, '', f).map(x => x.m.nombre.split(' ')[0]).sort();
  const f = filtrosVacios();
  marcarFiltro(f, 'musculo', 'brazos', true);
  assert.deepEqual(nombres(f), ['Curl', 'Curl', 'Extensión'], 'Brazos trae bíceps, tríceps y antebrazos');
  assert.equal(cuentaFiltros(f), 1);
  assert.deepEqual(zonasParaAfinar(f), ['brazos']);
  marcarFiltro(f, 'parte', 'bíceps', true);
  assert.deepEqual(buscarMaestros(ms, '', f).map(x => x.m.nombre), ['Curl de bíceps - Barra'], 'afinado: solo bíceps');
  assert.deepEqual(partesMarcadas(f, 'brazos'), ['bíceps']);
  assert.equal(cuentaFiltros(f), 1, 'la zona afinada cuenta por sus partes, no doble');
  marcarFiltro(f, 'parte', 'tríceps', true);
  assert.equal(cuentaFiltros(f), 2);
  marcarFiltro(f, 'musculo', 'piernas', true);
  assert.deepEqual(nombres(f), ['Curl', 'Extensión', 'Sentadilla'], 'otra zona sin afinar suma entera');
  assert.deepEqual(zonasParaAfinar(f), ['brazos', 'piernas'], 'en orden de cuerpo');
  // Desmarcar la zona se lleva sus partes: al volver a marcarla sale entera.
  marcarFiltro(f, 'musculo', 'brazos', false);
  assert.equal(f.parte.size, 0);
  marcarFiltro(f, 'musculo', 'brazos', true);
  assert.equal(buscarMaestros(ms, '', f).length, 4);
  // Quitar la etiqueta de la última parte quita la zona (si no, seguiría
  // filtrando sin que se vea).
  const g = filtrosVacios();
  marcarFiltro(g, 'musculo', 'brazos', true); marcarFiltro(g, 'parte', 'bíceps', true); marcarFiltro(g, 'parte', 'tríceps', true);
  quitarFiltro(g, 'parte', 'bíceps');
  assert.ok(g.musculo.has('brazos') && g.parte.has('tríceps'), 'queda tríceps');
  quitarFiltro(g, 'parte', 'tríceps');
  assert.ok(!g.musculo.has('brazos') && cuentaFiltros(g) === 0, 'sin partes se va la zona');
  // Trapecios va con Hombros y lumbar con Espalda (como «espalda baja»).
  const h = filtrosVacios();
  marcarFiltro(h, 'musculo', 'hombros', true);
  assert.deepEqual(buscarMaestros(ms, '', h).map(x => x.m.nombre), ['Encogimientos - Barra']);
  const e2 = filtrosVacios();
  marcarFiltro(e2, 'musculo', 'espalda', true);
  assert.deepEqual(buscarMaestros(ms, '', e2).map(x => x.m.nombre), ['Peso muerto - Barra']);
  assert.equal(nombreParte('lumbar'), 'espalda baja');
  assert.equal(nombreParte('bíceps'), 'bíceps');
});

test('«tambien» suma músculos al filtro sin cambiar el ejercicio', () => {
  const cat = [ej('BUL', 'Sentadilla búlgara - Mancuernas', 'mancuernas', 'cuádriceps'), ej('HT', 'Hip thrust - Barra', 'barra', 'glúteos')];
  const ms = construirMaestros(cat, { maestros: [], tambien: { BUL: ['glúteos'], NO_EXISTE: ['pecho'] } });
  const f = filtrosVacios();
  marcarFiltro(f, 'musculo', 'glúteos', true);
  assert.deepEqual(buscarMaestros(ms, '', f).map(x => x.m.nombre).sort(), ['Hip thrust - Barra', 'Sentadilla búlgara - Mancuernas']);
  const p = filtrosVacios();
  marcarFiltro(p, 'musculo', 'piernas', true);
  assert.deepEqual(buscarMaestros(ms, '', p).map(x => x.m.nombre), ['Sentadilla búlgara - Mancuernas'], 'sigue en su zona de siempre');
  assert.deepEqual(cat[0].musculosPrimarios, ['cuádriceps'], 'el ejercicio no se toca');
  assert.equal(construirMaestros(cat, { tambien: 'roto' }).length, 2, 'un «tambien» roto no rompe nada');
});

test('zonas: cada músculo en una sola zona y solo se afina lo que tiene varias partes', () => {
  const vistos = new Set();
  for (const z of ZONAS) for (const p of z.partes) { assert.ok(!vistos.has(p), `${p} en dos zonas`); vistos.add(p); }
  for (const z of ZONAS) if (z.afinar) assert.ok(z.partes.length > 1, `${z.v} no tiene qué afinar`);
  assert.deepEqual(OPCIONES_FILTRO.musculo, ['pecho', 'espalda', 'hombros', 'brazos', 'abdomen', 'glúteos', 'piernas']);
});

test('buscarMaestros sin coincidencias devuelve lista vacía', () => {
  assert.deepEqual(buscarMaestros(construirMaestros(CATALOGO, GRUPOS), 'zzz', filtrosVacios()), []);
});

// ── Integridad de los datos reales ───────────────────────────────────────────

const catalogo = JSON.parse(readFileSync(new URL('../data/ejercicios.json', import.meta.url), 'utf8'));
const grupos = JSON.parse(readFileSync(new URL('../data/grupos-ejercicios.json', import.meta.url), 'utf8'));

test('grupos-ejercicios.json: ids existentes, sin repetidos, pop 1–5 y etiquetas únicas por nivel', () => {
  const ids = new Set(catalogo.map(e => e.id));
  const vistos = new Set();
  for (const m of grupos.maestros) {
    const listas = m.grupos ? m.grupos.map(g => g.variantes) : [m.variantes];
    assert.ok(listas.every(l => l.length), `${m.nombre}: grupo vacío`);
    for (const l of listas) {
      const et = new Set();
      for (const v of l) {
        assert.ok(ids.has(v.id), `${m.nombre}: id inexistente ${v.id}`);
        assert.ok(!vistos.has(v.id), `${v.id} está en dos maestros`);
        assert.ok(v.pop >= 1 && v.pop <= 5, `${v.id}: pop fuera de rango`);
        assert.ok(!et.has(v.etiqueta), `${m.nombre}: etiqueta repetida «${v.etiqueta}»`);
        vistos.add(v.id); et.add(v.etiqueta);
      }
    }
  }
  for (const [id, p] of Object.entries(grupos.sueltos)) {
    assert.ok(ids.has(id) && !vistos.has(id) && p >= 1 && p <= 5, `suelto inválido ${id}`);
  }
  for (const id of grupos.ocultos) {
    assert.ok(ids.has(id) && !vistos.has(id) && !(id in grupos.sueltos), `oculto inválido ${id}`);
  }
  const porIdReal = new Map(catalogo.map(e => [e.id, e]));
  for (const [id, ms] of Object.entries(grupos.tambien || {})) {
    assert.ok(ids.has(id), `tambien con id inexistente ${id}`);
    for (const m of ms) {
      assert.ok(zonaDe(m), `tambien con músculo sin zona: ${id} ${m}`);
      assert.ok(!porIdReal.get(id).musculosPrimarios.includes(m), `tambien repite el principal: ${id} ${m}`);
    }
  }
});

test('datos reales: cada ejercicio no oculto queda en algún maestro y las casillas cubren todo', () => {
  const ms = construirMaestros(catalogo, grupos);
  assert.equal(ms.reduce((s, m) => s + m.n, 0) + grupos.ocultos.length, catalogo.length);
  for (const e of catalogo) {
    assert.ok(OPCIONES_FILTRO.equipo.includes(equipoDe(e)), `equipo sin casilla: ${equipoDe(e)}`);
    assert.ok(OPCIONES_FILTRO.tipo.includes(e.categoria), `tipo sin casilla: ${e.categoria}`);
    assert.ok(OPCIONES_FILTRO.nivel.includes(e.nivel), `nivel sin casilla: ${e.nivel}`);
    for (const m of e.musculosPrimarios) assert.ok(zonaDe(m), `músculo sin zona: ${m}`);
  }
  // Los básicos de glúteo salen al marcar Glúteos aunque su músculo principal sea otro.
  const gl = filtrosVacios();
  marcarFiltro(gl, 'musculo', 'glúteos', true);
  const glu = buscarMaestros(ms, '', gl).slice(0, 8).map(x => x.m.nombre);
  for (const n of ['Hip thrust', 'Sentadilla búlgara', 'Desplantes', 'Peso muerto']) assert.ok(glu.includes(n), `Glúteos sin ${n}: ${glu}`);
  const ab = filtrosVacios();
  marcarFiltro(ab, 'musculo', 'abdomen', true);
  assert.ok(buscarMaestros(ms, '', ab).some(x => x.m.nombre === 'Escaladores'), 'Escaladores también en Abdomen');
  const top = buscarMaestros(ms, '', filtrosVacios()).slice(0, 3).map(x => x.m.nombre);
  assert.ok(top.includes('Press de banca') && top.includes('Sentadilla'), `los básicos primero: ${top}`);
});
