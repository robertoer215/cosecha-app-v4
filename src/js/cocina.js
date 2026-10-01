// ═════════════════════════════════════════════════════════════════════════════
// COCINA — el plato se CIERRA contra n8n.
//
// Lo puro vive aquí, sin DOM, para poder probarlo en Node: armar el pedido con
// el contrato del webhook, comparar lo que vuelve con lo que el cliente ya vio
// en pantalla, y la llamada en sí con su timeout. app.js solo pinta.
//
// Regla que ordena todo: los números que ve el cliente son los LOCALES. La
// respuesta de cocina confirma, explica y propone. Si discrepa, gana cocina,
// pero la discrepancia se muestra con las dos cifras: nunca se sustituye en
// silencio.
// ═════════════════════════════════════════════════════════════════════════════

export const COCINA_URL = 'https://n8n.srv1683942.hstgr.cloud/webhook/cosecha-plato';
// MODO DEMO (esta copia, Fase 0): el envío a cocina está APAGADO. El webhook de
// arriba escribe un pedido REAL en la hoja de Pedidos de producción, así que
// ninguna petición debe salir de esta copia. La guarda vive AQUÍ, en la función
// que llama, no en quien la usa: así ningún código futuro lo rodea por accidente.
// Pasar a false solo con OK del dueño y un webhook propio.
export const MODO_DEMO = true;
// 15 s, no 8: medido el 18-sep-2026 desde el navegador, cocina tarda 4,5–6,1 s
// (n8n 3,6–5,4 s, el agente 1,6–3,4 s de eso) y el máximo visto el 17-sep fue 7,6 s.
// Con 8 s un teléfono en Wi-Fi caía en "Sin confirmar" con el pedido YA registrado.
export const COCINA_TIMEOUT_MS = 15000;

// n8n devuelve los tamaños como etiqueta de la carta; la app trabaja con el factor.
export const K_DE_ETIQUETA = { 'Pequeña': 0.5, 'Estándar': 1, 'Grande': 1.5, '2 porciones': 2, '2 porciones y media': 2.5, '3 porciones': 3, '3 porciones y media': 3.5, '4 porciones': 4 };

// De dónde sale la meta. Cocina recibe siempre macros POR COMIDA, vengan de la
// fórmula o de "Ingresar mis macros"; lo que necesita saber es quién los puso,
// para que el agente hable bien (los del cliente no se cuestionan ni se
// atribuyen a la app) y para que quede registrado. `comidas` acompaña: en
// manual_comida es 1 (la meta ya venía por comida, sin repartir).
export function origenMeta(meta) {
  if (meta.objetivo !== 'manual') return 'formula';
  return meta.comidas === 1 ? 'manual_comida' : 'manual_dia';
}

// El pedido, con el contrato del webhook. `lineas` van en el orden en que el
// cliente las ve (pasos + extras) y SIEMPRE con tamaño: así cocina no tiene
// que adivinar nada y `coincide_con_la_app` deja de ser null.
// Los alérgenos del catálogo no están verificados por cocina: `sin` va vacío.
export function armarPedido(meta, lineas, extra = {}) {
  return {
    macros_objetivo: { kcal: meta.kcal, prot: meta.prot, carb: meta.carb, gras: meta.gras },
    meta_origen: origenMeta(meta),
    comidas: meta.comidas,
    restricciones: { sin: [] },
    seleccion: lineas.map(l => ({ id: l.id, tamano: l.tamano })),
    ...extra
  };
}

// La clave con la que se decide si un plato YA se pidió: meta + selección. Los
// campos del upsell no entran: volver a abrir el mismo resumen no debe generar
// un segundo pedido.
export function clavePedido(pedido) {
  return JSON.stringify({ m: pedido.macros_objetivo, s: pedido.seleccion });
}

// ¿Cocina calculó lo mismo que la pantalla? Se compara TODO lo que el cliente
// ve: el total, y cada línea (tamaño, gramos, precio, macros). No basta con
// `coincide_con_la_app`: ese campo compara con lo que se ENVIÓ, y si el envío
// ya difería de la pantalla lo daría por bueno.
export function compararConCocina(local, resp) {
  const lineasCocina = Array.isArray(resp.lineas) ? resp.lineas : [];
  const lineas = [];
  for (const l of local.lineas) {
    const c = lineasCocina.find(x => x.id === l.id);
    if (!c) {
      const r = (resp.rechazados || []).find(x => x.id === l.id);
      lineas.push({ id: l.id, nombre: l.nombre, local: l, cocina: null, motivo: r ? r.motivo : null });
      continue;
    }
    const kc = K_DE_ETIQUETA[c.tamano];
    const mc = c.macros || {};
    const igual = kc === l.tamano && Number(c.g) === l.g && Number(c.precio) === l.precio
      && Number(mc.prot) === l.macros.prot && Number(mc.carb) === l.macros.carb
      && Math.abs(Number(mc.gras) - l.macros.gras) < 1e-9 && Number(mc.kcal) === l.macros.kcal;
    if (!igual) lineas.push({ id: l.id, nombre: l.nombre, local: l, cocina: { tamano: kc ?? null, etiqueta: c.tamano, g: Number(c.g), precio: Number(c.precio), macros: mc }, motivo: null });
  }
  for (const c of lineasCocina) {
    if (!local.lineas.some(l => l.id === c.id)) lineas.push({ id: c.id, nombre: c.nombre, local: null, cocina: { tamano: K_DE_ETIQUETA[c.tamano] ?? null, etiqueta: c.tamano, g: Number(c.g), precio: Number(c.precio), macros: c.macros || {} }, motivo: null });
  }
  const total = Number(resp.total) !== local.total ? { local: local.total, cocina: Number(resp.total) } : null;
  const mt = resp.macros_totales || {};
  const macrosDifieren = Number(mt.prot) !== local.macros.prot || Number(mt.carb) !== local.macros.carb
    || Math.abs(Number(mt.gras) - local.macros.gras) > 1e-9 || Number(mt.kcal) !== local.macros.kcal;
  const macros = macrosDifieren ? { local: local.macros, cocina: { kcal: Number(mt.kcal), prot: Number(mt.prot), carb: Number(mt.carb), gras: Number(mt.gras) } } : null;
  // Solo cuenta lo concreto: si cocina dijera "no coincide" con cifras iguales no
  // habría nada que enseñar, y "gana cocina" no cambiaría ni un número.
  const hay = !!total || lineas.length > 0 || !!macros;
  return { hay, total, lineas, macros, coincide: resp.coincide_con_la_app };
}

const ETIQUETAS = Object.keys(K_DE_ETIQUETA);
const num = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v)) ? Number(v) : null;
const str = v => typeof v === 'string' ? v : '';

// La respuesta de cocina se NORMALIZA antes de usarse. Lo esencial (pedido,
// líneas con tamaño conocido, gramos, precios, macros y total) tiene que tener
// la forma del contrato o la respuesta entera se descarta; lo accesorio
// (explicación, avisos, rechazados, propuesta) se limpia campo a campo. Así
// ningún NaN, null, objeto o etiqueta desconocida llega a la pantalla.
export function normalizarRespuesta(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (typeof d.pedido_id !== 'string' || !/^[\x20-\x7E]{1,64}$/.test(d.pedido_id)) return null;
  if (!Array.isArray(d.lineas)) return null;
  const macrosDe = m => {
    if (!m || typeof m !== 'object') return null;
    const o = { kcal: num(m.kcal), prot: num(m.prot), carb: num(m.carb), gras: num(m.gras) };
    return Object.values(o).every(v => v !== null) ? o : null;
  };
  const lineas = [];
  for (const l of d.lineas) {
    if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !ETIQUETAS.includes(l.tamano)) return null;
    const g = num(l.g), precio = num(l.precio), macros = macrosDe(l.macros);
    if (g === null || precio === null || !macros) return null;
    lineas.push({ id: l.id, nombre: str(l.nombre) || l.id, categoria: str(l.categoria), tamano: l.tamano, g, precio, macros });
  }
  const total = num(d.total), macros_totales = macrosDe(d.macros_totales);
  if (total === null || !macros_totales) return null;
  let propuesta_cierre = null;
  const p = d.propuesta_cierre;
  if (p && typeof p === 'object' && typeof p.id === 'string' && ETIQUETAS.includes(p.tamano) && num(p.precio_extra) !== null) {
    propuesta_cierre = { ...p, precio_extra: num(p.precio_extra), descripcion: str(p.descripcion) };
  }
  const rechazados = Array.isArray(d.rechazados)
    ? d.rechazados.filter(x => x && typeof x === 'object' && typeof x.motivo === 'string' && x.motivo.trim())
        .map(x => ({ id: str(x.id), nombre: str(x.nombre), motivo: x.motivo }))
    : [];
  return {
    pedido_id: d.pedido_id, lineas, macros_totales, total,
    coincide_con_la_app: typeof d.coincide_con_la_app === 'boolean' ? d.coincide_con_la_app : null,
    propuesta_cierre,
    motivo_sin_propuesta: str(d.motivo_sin_propuesta) || null,
    explicacion: str(d.explicacion).trim(),
    avisos: Array.isArray(d.avisos) ? d.avisos.filter(a => typeof a === 'string' && a.trim()) : [],
    rechazados,
    dentro_de_umbral: d.dentro_de_umbral === true,
    desviacion: d.desviacion && typeof d.desviacion === 'object' ? d.desviacion : null,
    auditoria: d.auditoria && typeof d.auditoria === 'object' ? d.auditoria : null
  };
}

// La llamada. Devuelve la promesa y una forma de cancelarla (si el cliente
// vuelve a editar el plato antes de que cocina conteste, la respuesta vieja no
// debe pintar encima del resumen nuevo). Timeout y fallo de red terminan igual:
// { ok:false } con su motivo, y el resumen se queda con los números locales.
export function llamarCocina(pedido, { timeoutMs = COCINA_TIMEOUT_MS, fetchImpl = globalThis.fetch, url = COCINA_URL, modoDemo = MODO_DEMO } = {}) {
  // En demo se resuelve al instante, sin red y con la misma forma que un fallo:
  // app.js ya sabe quedarse con los números locales; solo cambia el motivo.
  if (modoDemo) return { promesa: Promise.resolve({ ok: false, motivo: 'demo', errores: [] }), cancelar: () => {} };
  const ctrl = new AbortController();
  let porTimeout = false;
  const timer = setTimeout(() => { porTimeout = true; ctrl.abort(); }, timeoutMs);
  const promesa = (async () => {
    try {
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pedido),
        signal: ctrl.signal
      });
      let data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      const errores = data && typeof data === 'object' && Array.isArray(data.errores) ? data.errores.map(String) : [];
      // Un rechazo llega como 400, pero el nodo Respond de n8n contesta 200 si el
      // código no va en `options`: `ok:false` manda igual y sus errores se enseñan.
      if (!r.ok || (data && typeof data === 'object' && data.ok === false)) return { ok: false, motivo: 'http', status: r.status, errores };
      const limpia = normalizarRespuesta(data);
      if (!limpia) return { ok: false, motivo: 'respuesta_invalida', status: r.status, errores: [] };
      return { ok: true, data: limpia };
    } catch (e) {
      if (ctrl.signal.aborted) return { ok: false, motivo: porTimeout ? 'timeout' : 'cancelado', errores: [] };
      return { ok: false, motivo: 'red', errores: [] };
    } finally {
      clearTimeout(timer);
    }
  })();
  return { promesa, cancelar: () => ctrl.abort() };
}
