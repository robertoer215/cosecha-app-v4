import { ING, SIZES, OBJ_LABEL, CATS, CAT_LABEL, IMG_DIR, MAX_MODULOS_CAT } from './data.js';
import { precio, mac, calcularMeta, metaManualComida, metaManualTotal,
         porcionar, explicarCambio, proponerCierre, tamanosPermitidos, UMBRAL_G, cubrenGrasa, nombreCorto } from './calc.js';
import { armarPedido, clavePedido, compararConCocina, llamarCocina, K_DE_ETIQUETA, origenMeta } from './cocina.js';
import * as almacen from './almacen.js';

let meta = {}, selBase = {}, szBase = {}, selExtra = {}, szExtra = {};

// ── MODO IA ──────────────────────────────────────────────────────────────────
// El usuario sigue eligiendo QUÉ comer, en el mismo orden y con las mismas
// tarjetas. Lo único que deja de preguntársele es CUÁNTO: el tamaño lo resuelve
// porcionar() sobre TODOS los módulos a la vez, y se recalcula en cada toque.
//
//   szManual  overrides que el usuario fijó a mano desde "Ajustar". Son los
//             únicos tamaños que el porcionador no puede mover: se clavan y el
//             resto se optimiza a su alrededor.
//   szBase    caché de los tamaños VIGENTES (los que devolvió el porcionado, o
//             el override). El resumen, el QR y el ticket lo leen tal cual, así
//             que nada aguas abajo tuvo que enterarse del cambio.
let szManual = {}, ajustando = {}, ultimoPorc = null, porque = null, idsRecalc = [];
let modoActual = 'calc';
let subModoActual = 'comida';
let platoCatIdx = 0;

const CATS_STEPS = ['proteina', 'carbohidrato', 'vegetal', 'grasa'];
const STEP_LABELS = {proteina:'Proteína', carbohidrato:'Carbohidrato', vegetal:'Vegetal', grasa:'Grasa saludable'};

const $ = id => document.getElementById(id);

// ── SHELL · tres áreas en una app ────────────────────────────────────────────
// Pedir (esta pantalla), Diario y Entrenar conviven como <main> hermanos; la
// tabbar fija de abajo cambia cuál se ve. Los módulos se montan la PRIMERA vez
// que se abren, con import dinámico: la carga inicial de Pedir no crece. El
// perfil y la meta POR COMIDA viven en el almacén local y se comparten: nadie
// rellena su perfil dos veces.
let estadoLocal = almacen.cargar();
const modulosMontados = {};

function getMetaCompartida() {
  if (meta && typeof meta.kcal === 'number') {
    return { kcal: meta.kcal, prot: meta.prot, carb: meta.carb, gras: meta.gras, comidas: meta.comidas, origen: origenMeta(meta) };
  }
  // Sin meta viva se lee el disco FRESCO: un respaldo recién importado desde
  // el Diario debe verse aquí sin obligar a pasar por Hoy primero.
  estadoLocal = almacen.cargar();
  return estadoLocal.metaCache;
}

// CSS de los módulos bajo demanda, junto con su JS: cargarlos eager costaba
// ~18 KB a la carga inicial de Pedir y rompía la promesa de que no crece.
const cssCargado = {};
function cargarCSS(nombre) {
  if (!cssCargado[nombre]) {
    cssCargado[nombre] = new Promise(res => {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = `css/${nombre}.css`;
      l.onload = () => res();
      // Un CSS que falló no se cachea como cargado: el siguiente toque reintenta.
      l.onerror = () => { delete cssCargado[nombre]; l.remove(); res(); };
      document.head.appendChild(l);
    });
  }
  return cssCargado[nombre];
}

// Quien llega a Pedir desde "Completa tu perfil" (Hoy, Diario o Entrenar)
// venía a otra cosa: tras Continuar vuelve a donde estaba, no al menú del
// restaurante. Navegar a otra pestaña por su cuenta cancela la vuelta.
let volverTrasPerfil = null;
window.crearPerfil = function(origen) {
  window.goTab('pedir');
  volverTrasPerfil = origen;
  goStep(0);
};

async function montarModulo(tab) {
  if (modulosMontados[tab]) return;
  const raiz = $(tab === 'diario' ? 'vista-diario' : 'vista-entrenar');
  // El flag se pone ANTES del await: un doble toque rápido en la pestaña
  // montaba el módulo dos veces (listeners y render duplicados).
  modulosMontados[tab] = 'montando';
  try {
    await cargarCSS(tab === 'diario' ? 'diario' : 'entreno');
    const mod = await import(tab === 'diario' ? './diario.js' : './entreno.js');
    (tab === 'diario' ? mod.initDiario : mod.initEntreno)({ raiz, getMeta: getMetaCompartida });
    modulosMontados[tab] = mod;
  } catch (e) {
    delete modulosMontados[tab];   // reintentable en el siguiente toque
    raiz.innerHTML = '<p class="modulo-error">Esta sección no se pudo cargar. Recarga la página e intenta de nuevo.</p>';
    console.warn('modulo ' + tab + ':', e.message);
  }
}

window.goTab = async function(tab) {
  if (tab !== 'pedir') volverTrasPerfil = null;
  const vistas = { hoy: 'vista-hoy', pedir: 'vista-pedir', diario: 'vista-diario', entrenar: 'vista-entrenar' };
  Object.entries(vistas).forEach(([k, id]) => {
    $(id).hidden = k !== tab;
    const btn = $('tab-' + k);
    if (k === tab) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  });
  if (tab === 'hoy') { renderHoy(); window.scrollTo(0, 0); return; }
  if (tab !== 'pedir' && !modulosMontados[tab]) {
    await montarModulo(tab);
  } else if (modulosMontados[tab] && modulosMontados[tab] !== 'montando') {
    // El almacén pudo cambiar desde otra pestaña (un plato añadido al diario
    // desde Pedir, por ejemplo): el módulo decide qué refrescar.
    modulosMontados[tab].refrescar?.();
  }
  window.scrollTo(0, 0);
};

// El plato del resumen entra al diario en UN toque, con los mismos números que
// muestra la pantalla (lineasLocales: el mismo motor que ve cocina).
window.agregarPlatoAlDiario = function() {
  const btn = $('btn-diario-plato');
  // Ya añadido: el mismo botón lleva al Diario (un toque, sin buscar la pestaña).
  if (btn && btn.dataset.ok === '1') { window.goTab('diario'); return; }
  const local = lineasLocales();
  if (!local.lineas.length) return;
  const entrada = {
    id: 'PLATO-' + Date.now(),
    // El nombre dice QUÉ plato fue: dos platos del mismo día no se confunden.
    nombre: 'Plato COSECHA · ' + local.lineas.map(l => l.nombre.split(' ')[0]).join(', '),
    detalle: local.lineas.map(l => l.nombre).join(', '),
    gramos: local.lineas.reduce((a, l) => a + l.g, 0),
    porcion: null,
    macros: { prot: local.macros.prot, carb: local.macros.carb, gras: local.macros.gras, kcalFuente: local.macros.kcal },
    origen: 'plato',
    ts: Date.now()
  };
  // Escritura ATÓMICA: la entrada se añade sobre el estado fresco del disco.
  // Con el snapshot viejo de esta pestaña se borraba lo registrado en Diario.
  const r = almacen.actualizar(e => almacen.agregarAlDiario(e, almacen.hoyISO(), almacen.comidaPorHora(), entrada));
  estadoLocal = r.estado;
  if (!btn) return;
  if (!r.guardado) {
    // Nunca afirmar un guardado que no ocurrió (modo privado, cuota llena).
    btn.textContent = 'No se pudo guardar en este dispositivo. Toca para reintentar';
    return;
  }
  btn.textContent = '✓ En tu diario de hoy · Ver diario →';
  btn.classList.add('ok');
  btn.dataset.ok = '1';
  platoEnDiario = clavePlato();
};

// Clave del plato en pantalla (meta + líneas con tamaño): volver al resumen
// del MISMO plato no reactiva el botón; solo un plato distinto lo rearma.
let platoEnDiario = null;
function clavePlato() {
  return JSON.stringify(lineasLocales().lineas.map(l => [l.id, l.tamano]));
}

// La pantalla Hoy: resumen del día (lo consumido del diario contra la meta) y
// las tres acciones. Se repinta en cada apertura releyendo el almacén, porque
// Diario, Entrenar o Pedir pudieron escribir desde su pestaña.
function renderHoy() {
  estadoLocal = almacen.cargar();
  const f = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  $('hoy-fecha').textContent = f.charAt(0).toUpperCase() + f.slice(1);
  const m = getMetaCompartida();
  $('hoy-resumen').hidden = !m;
  $('hoy-sin-meta').hidden = !!m;
  if (m) {
    const dia = estadoLocal.diario[almacen.hoyISO()] || {};
    const tot = { prot: 0, carb: 0, gras: 0 };
    Object.values(dia).forEach(lista => (lista || []).forEach(e => {
      tot.prot += e.macros?.prot || 0; tot.carb += e.macros?.carb || 0; tot.gras += e.macros?.gras || 0;
    }));
    // kcal derivadas 4/4/9, igual que la meta: el panel siempre cuadra.
    const kcal = Math.round(4 * tot.prot + 4 * tot.carb + 9 * tot.gras);
    // Meta manual POR COMIDA sin responder cuántas comidas al día: Hoy no
    // adivina (pintar la meta de UNA comida como meta del día engaña). El
    // Diario hace la pregunta; aquí solo lo consumido y la invitación.
    const nDia = m.origen === 'manual_comida' ? estadoLocal.perfil?.comidasDiario : m.comidas;
    const pendiente = !(nDia > 0);
    $('hoy-barras').hidden = pendiente;
    $('hoy-nota').hidden = !pendiente;
    if (pendiente) {
      $('hoy-kcal').textContent = `${kcal} kcal hoy`;
      $('hoy-nota').textContent = 'Tu meta es por comida. Responde en el Diario cuántas comidas registras al día y aquí verás tu meta diaria.';
    } else {
      const metaDia = { kcal: m.kcal * nDia, prot: m.prot * nDia, carb: m.carb * nDia, gras: m.gras * nDia };
      $('hoy-kcal').textContent = `${kcal} / ${metaDia.kcal} kcal`;
      [['p', 'prot'], ['c', 'carb'], ['g', 'gras']].forEach(([s, k]) => {
        $('hoy-v-' + s).textContent = `${Math.round(tot[k])}/${metaDia[k]}g`;
        const b = $('hoy-b-' + s);
        b.style.transform = `scaleX(${Math.min(1, metaDia[k] ? tot[k] / metaDia[k] : 0)})`;
        // El exceso se marca con la misma trama que el Diario y el tracker.
        b.classList.toggle('bover', metaDia[k] > 0 && tot[k] > metaDia[k] + UMBRAL_G);
      });
    }
  }
  // Lo último de Entrenar: una sesión a medias invita a retomarla; si no, la última hecha.
  const ult = $('hoy-ultimo');
  const activa = estadoLocal.entreno?.sesionActiva;
  const sesiones = estadoLocal.entreno?.sesiones || [];
  if (activa) {
    ult.hidden = false;
    ult.innerHTML = `<button class="hoy-card hoy-card-accent" onclick="goTab('entrenar')"><div><div class="hc-t">Tienes una sesión en curso</div><div class="hc-s">Tócala para continuar donde la dejaste</div></div></button>`;
  } else if (sesiones.length) {
    const s = sesiones[sesiones.length - 1];
    const series = (s.ejercicios || []).reduce((a, e) => a + (e.series || []).filter(x => x.hecha).length, 0);
    const volKg = (s.ejercicios || []).reduce((a, e) => a + (e.series || []).filter(x => x.hecha).reduce((b, x) => b + (x.reps || 0) * (x.pesoKg || 0), 0), 0);
    const lb = estadoLocal.perfil?.unidadPeso === 'lb';
    const vol = Math.round(lb ? volKg / 0.45359237 : volKg);
    ult.hidden = false;
    // Mismas reglas que el historial de Entrenar: concordancia y el volumen solo
    // cuando lo hay ("0 kg de volumen" en peso corporal decía que no hiciste nada).
    const fechaS = new Date(s.inicioMs).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
    ult.innerHTML = `<div class="hc-s">Última sesión: ${fechaS} · ${series} ${series === 1 ? 'serie' : 'series'}${vol > 0 ? ` · ${vol} ${lb ? 'lb' : 'kg'} de volumen` : ''}</div>`;
  } else {
    ult.hidden = true;
    ult.innerHTML = '';
  }
}

// Al calcular la meta, el perfil y la meta quedan en el almacén para que
// Diario y Entrenar los usen sin volver a preguntar nada. Escritura ATÓMICA
// sobre el estado fresco del disco (el snapshot viejo pisaba comidasDiario y
// lo que Diario o Entrenar hubieran guardado desde su pestaña).
function persistirPerfilYMeta() {
  const metaNueva = { kcal: meta.kcal, prot: meta.prot, carb: meta.carb, gras: meta.gras, comidas: meta.comidas, origen: origenMeta(meta) };
  const r = almacen.actualizar(e => {
    const previo = e.perfil || {};
    // En modo manual los campos de la fórmula están ocultos y pueden traer
    // basura olvidada: se conservan los del perfil previo, nunca se pisan
    // (un null ahí tiraba el perfil ENTERO al migrar en la siguiente carga).
    const formula = modoActual === 'calc'
      ? { sexo: $('sexo').value, edad: numCampo('edad'), peso: numCampo('peso'), altura: numCampo('altura'),
          comidas: +$('comidas').value,
          objetivo: document.querySelector('.obj-card.selected')?.dataset.o,
          actividad: document.querySelector('.act-card.selected')?.dataset.a }
      : { sexo: previo.sexo ?? null, edad: previo.edad ?? null, peso: previo.peso ?? null, altura: previo.altura ?? null,
          comidas: previo.comidas ?? +$('comidas').value, objetivo: previo.objetivo ?? null, actividad: previo.actividad ?? null };
    let nuevo = almacen.guardarPerfil(e, {
      ...previo,
      ...formula,
      modo: modoActual, subModo: subModoActual,
      // Lo tecleado en "Ingresar mis macros" se conserva: sin esto, recargar
      // devolvía los valores de referencia y Continuar sustituía la meta real.
      manual: { mcProt: numCampo('mc-prot'), mcCarb: numCampo('mc-carb'), mcGras: numCampo('mc-gras'),
                mComidas: +$('m-comidas').value, mProt: numCampo('m-prot'), mCarb: numCampo('m-carb'), mGras: numCampo('m-gras') },
      unidadPeso: previo.unidadPeso || 'kg',
      comidasDiario: previo.comidasDiario ?? null,
      terminos: modoActual === 'calc' ? true : (previo.terminos ?? false),
      actualizado: Date.now()
    });
    return almacen.guardarMetaCache(nuevo, metaNueva);
  });
  estadoLocal = r.estado;
}

// Con perfil y términos guardados, la meta se recalcula en silencio con la
// misma calcularMeta() (nada de fórmulas paralelas) y Pedir abre en "Arma tu
// plato". El perfil sigue a un toque en el stepper para cambiarlo.
function prepararMetaGuardada() {
  const p = estadoLocal.perfil;
  if (!p || !p.terminos || !estadoLocal.metaCache) return;
  const vuelta = volverTrasPerfil;
  volverTrasPerfil = null;
  window.calcular();
  volverTrasPerfil = vuelta;
}

// Una sesión de pesas a medias monta Entrenar en segundo plano al abrir la app:
// así el aviso de fin de descanso suena aunque estés en Hoy (tras un reload,
// iOS descarta pestañas en el gym), en vez de perderse en silencio.
function montarSesionActiva() {
  const a = estadoLocal.entreno?.sesionActiva;
  if (a && !a.finMs) montarModulo('entrenar');
}

// Tras importar un respaldo desde el Diario: la meta viva de esta visita ya no
// vale (gana la del respaldo), el formulario se rellena con el perfil importado
// y cada módulo montado relee el almacén.
window.addEventListener('cosecha:importado', () => {
  meta = {};
  estadoLocal = almacen.cargar();
  restaurarPerfil();
  prepararMetaGuardada();
  Object.values(modulosMontados).forEach(m => m?.refrescar?.());
  renderHoy();
});

// Un perfil ya guardado rellena el formulario al abrir, y los términos
// aceptados no se vuelven a pedir: Continuar queda a un toque.
function restaurarPerfil() {
  const p = estadoLocal.perfil;
  if (!p) return;
  try {
    if (p.sexo) $('sexo').value = p.sexo;
    if (p.edad) $('edad').value = p.edad;
    if (p.peso) $('peso').value = p.peso;
    if (p.altura) $('altura').value = p.altura;
    if (p.comidas) $('comidas').value = String(p.comidas);
    if (p.objetivo) document.querySelectorAll('.obj-card').forEach(c => c.classList.toggle('selected', c.dataset.o === p.objetivo));
    if (p.actividad) document.querySelectorAll('.act-card').forEach(c => c.classList.toggle('selected', c.dataset.a === p.actividad));
    if (p.manual) {
      // Los valores manuales guardados sustituyen a los de referencia.
      const m = p.manual;
      if (m.mcProt != null) $('mc-prot').value = m.mcProt;
      if (m.mcCarb != null) $('mc-carb').value = m.mcCarb;
      if (m.mcGras != null) $('mc-gras').value = m.mcGras;
      if (m.mComidas != null) $('m-comidas').value = String(m.mComidas);
      if (m.mProt != null) $('m-prot').value = m.mProt;
      if (m.mCarb != null) $('m-carb').value = m.mCarb;
      if (m.mGras != null) $('m-gras').value = m.mGras;
    }
    if (p.modo === 'manual') {
      window.setMode('manual');
      if (p.subModo === 'total') window.setSubMode('total');
    }
    if (p.terminos) {
      $('terms-btn').classList.add('accepted');
      $('terms-icon').textContent = '●';
      $('terms-btn-txt').textContent = 'Aceptado';
      $('btn-calcular').disabled = false;
    }
  } catch (e) { console.warn('perfil guardado:', e.message); }
}

// Foto del ingrediente. Las fotos son cuadradas y los contenedores no siempre:
// `foco` recentra el recorte en los platos que no están al centro de su imagen.
// Van con loading="lazy" porque el paso 2 sólo muestra una categoría a la vez.
function foto(it, cls) {
  if (!it.img) return '';
  const pos = it.foco ? ` style="object-position:${it.foco}"` : '';
  return `<img class="${cls}" src="${IMG_DIR}${it.img}" alt="${it.nombre}" loading="lazy" decoding="async" width="600" height="600"${pos}>`;
}

window.aceptarTerminos = function() {
  const btn = $('terms-btn');
  const accepted = btn.classList.toggle('accepted');
  $('terms-icon').textContent = accepted ? '●' : '○';
  $('terms-btn-txt').textContent = accepted ? 'Aceptado' : 'Entendido, acepto continuar';
  $('btn-calcular').disabled = !accepted;
};

window.setMode = function(modo) {
  modoActual = modo;
  $('formula-form').style.display = modo === 'calc' ? 'block' : 'none';
  $('manual-form').style.display  = modo === 'manual' ? 'block' : 'none';
  $('mt-calc').classList.toggle('mt-active', modo === 'calc');
  $('mt-manual').classList.toggle('mt-active', modo === 'manual');
  $('mt-calc').setAttribute('aria-pressed', String(modo === 'calc'));
  $('mt-manual').setAttribute('aria-pressed', String(modo === 'manual'));
  limpiarErrores();
  if (modo === 'manual') {
    $('btn-calcular').disabled = false;
    window.kcalManual();
  } else {
    const aceptado = $('terms-btn') && $('terms-btn').classList.contains('accepted');
    $('btn-calcular').disabled = !aceptado;
  }
};

window.setSubMode = function(sub) {
  subModoActual = sub;
  $('sub-comida').style.display = sub === 'comida' ? 'block' : 'none';
  $('sub-total').style.display  = sub === 'total'  ? 'block' : 'none';
  $('st-comida').classList.toggle('st-active', sub === 'comida');
  $('st-total').classList.toggle('st-active', sub === 'total');
  $('st-comida').setAttribute('aria-pressed', String(sub === 'comida'));
  $('st-total').setAttribute('aria-pressed', String(sub === 'total'));
  limpiarErrores();
  window.kcalManual();
};

const CAMPOS_MANUALES = ['mc-prot', 'mc-carb', 'mc-gras', 'm-prot', 'm-carb', 'm-gras'];

// Las kcal del modo manual no se piden: se derivan de los macros (4P + 4C + 9G,
// con el mismo redondeo por comida que va a usar la meta) y se enseñan en vivo
// bajo los campos. Antes el formulario "Total del día" exigía las kcal y luego
// las ignoraba. Escribir en un campo también le quita la marca de error.
window.kcalManual = function() {
  const cm = $('mc-kcal'), tot = $('m-kcal-live');
  if (cm) {
    const p = numCampo('mc-prot'), c = numCampo('mc-carb'), g = numCampo('mc-gras');
    cm.textContent = (p === null || c === null || g === null) ? '' : `= ${metaManualComida({ prot: p, carb: c, gras: g }).kcal} kcal por comida`;
  }
  if (tot) {
    const comidas = +$('m-comidas').value;
    const p = numCampo('m-prot'), c = numCampo('m-carb'), g = numCampo('m-gras');
    tot.textContent = (p === null || c === null || g === null) ? '' : `= ${metaManualTotal({ protTotal: p, carbTotal: c, grasTotal: g, comidas }).kcal} kcal por comida · ${comidas} comidas`;
  }
  CAMPOS_MANUALES.forEach(idc => { const el = $(idc); if (el && el.classList.contains('invalid') && numCampo(idc) !== null) { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); } });
  if (!document.querySelector('#manual-form input.invalid')) { const b = $('manual-error'); if (b) b.textContent = ''; }
};

// Errores de formulario EN el formulario, no en un alert(): el campo se marca
// (aria-invalid + subrayado rojo), el mensaje dice qué campo y qué rango bajo los
// campos (role=alert) y el foco salta al primero con problema.
function errorFormulario(idError, ids) {
  const partes = ids.map(idc => {
    const el = $(idc), lbl = document.querySelector(`label[for="${idc}"]`);
    const [nombre, unidad] = (lbl ? lbl.textContent : idc).split(' — ');
    if (el) { el.classList.add('invalid'); el.setAttribute('aria-invalid', 'true'); }
    return `${nombre.trim()} ${el.min}–${el.max}${unidad ? ' ' + unidad.trim() : ''}`;
  });
  const box = $(idError);
  // "el 0 es válido" solo aplica a los macros manuales: en la fórmula ningún
  // campo admite 0 y la coletilla contradecía al propio mensaje.
  const cero = idError === 'manual-error' ? '; el 0 es válido' : '';
  if (box) box.textContent = `Revisa: ${partes.join(', ')}. Solo números dentro del rango${cero}.`;
  const primero = $(ids[0]);
  if (primero) primero.focus();
}
function limpiarErrores() {
  document.querySelectorAll('input.invalid').forEach(el => { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); });
  ['formula-error', 'manual-error'].forEach(idc => { const b = $(idc); if (b) b.textContent = ''; });
}

window.selObj = el => { document.querySelectorAll('.obj-card').forEach(c=>{c.classList.remove('selected');c.setAttribute('aria-pressed','false');}); el.classList.add('selected'); el.setAttribute('aria-pressed','true'); };
window.selAct = el => { document.querySelectorAll('.act-card').forEach(c=>{c.classList.remove('selected');c.setAttribute('aria-pressed','false');}); el.classList.add('selected'); el.setAttribute('aria-pressed','true'); };

// Lee un input numérico validando contra los min/max declarados en el HTML.
// Devuelve null si está vacío, no es número o está fuera de rango (el 0 sí es válido si min lo permite).
function numCampo(id) {
  const el = $(id), v = String(el.value).trim();
  if (v === '') return null;
  const n = +v;
  if (!Number.isFinite(n)) return null;
  if (el.min !== '' && n < +el.min) return null;
  if (el.max !== '' && n > +el.max) return null;
  return n;
}

window.calcular = function() {
  limpiarErrores();
  const malos = ids => ids.filter(idc => numCampo(idc) === null);
  if (modoActual === 'manual') {
    if (subModoActual === 'comida') {
      const m = malos(['mc-prot', 'mc-carb', 'mc-gras']);
      if (m.length) { errorFormulario('manual-error', m); return; }
      meta = metaManualComida({ prot: numCampo('mc-prot'), carb: numCampo('mc-carb'), gras: numCampo('mc-gras') });
    } else {
      const m = malos(['m-prot', 'm-carb', 'm-gras']);
      if (m.length) { errorFormulario('manual-error', m); return; }
      meta = metaManualTotal({ protTotal: numCampo('m-prot'), carbTotal: numCampo('m-carb'), grasTotal: numCampo('m-gras'), comidas: +$('m-comidas').value });
    }
  } else {
    const m = malos(['edad', 'peso', 'altura']);
    if (m.length) { errorFormulario('formula-error', m); return; }
    const edad = numCampo('edad'), peso = numCampo('peso'), altura = numCampo('altura');
    meta = calcularMeta({
      sexo: $('sexo').value,
      edad, peso, altura,
      comidas: +$('comidas').value,
      objetivo: document.querySelector('.obj-card.selected').dataset.o,
      actividad: document.querySelector('.act-card.selected').dataset.a
    });
  }
  selBase = {}; szBase = {}; selExtra = {}; szExtra = {};
  szManual = {}; ajustando = {}; ultimoPorc = null; porque = null; idsRecalc = [];
  platoCatIdx = 0;
  reiniciarCocina();
  persistirPerfilYMeta();
  renderMeta();
  renderBase();
  updateGlobalTracker();
  goStep(1);
  if (volverTrasPerfil) window.goTab(volverTrasPerfil);
};

// Los módulos elegidos, en el orden en que el usuario los fue eligiendo por
// pasos. El orden importa: es el que ve en pantalla y el que sale en el ticket.
function itemsElegidos() {
  const out = [];
  CATS_STEPS.forEach(cat => (selBase[cat] || []).forEach(id => {
    const it = ING.find(i => i.id === id);
    if (it) out.push(it);
  }));
  return out;
}

// Los extras del paso 5 son parte del plato: cuentan en la barra de macros y en
// el resumen, así que TIENEN que contar en el porcionado. Si no, la tarjeta
// afirma "Cierra tu meta" mientras la barra justo encima marca 90/71 g.
function extrasElegidos() {
  return Object.keys(selExtra)
    .filter(id => selExtra[id])
    .map(id => ING.find(i => i.id === id))
    .filter(Boolean);
}

// El plato completo: los módulos base y los extras ya agregados.
function itemsPlato() { return [...itemsElegidos(), ...extrasElegidos()]; }

// Módulos de una categoría YA en el plato, base o extra. El tope por categoría
// cuenta los dos: si no, el paso 5 ofrecía como extra el tercer carbohidrato que
// el paso 2 acababa de negar, y n8n rechazaba el plato con 400.
function enCategoria(cat) {
  return (selBase[cat] || []).length + extrasElegidos().filter(e => e.cat === cat).length;
}

// "Elige hasta 2 · 1 elegido + 1 extra": el encabezado dice el tope y cuenta lo
// mismo que cuenta el tope, base y extras, para que nunca contradiga a la tarjeta
// que dice "Máximo 2 por categoría".
function textoEncabezado(cat) {
  const base = (selBase[cat] || []).length, extra = extrasElegidos().filter(e => e.cat === cat).length;
  let t = `Elige hasta ${MAX_MODULOS_CAT}`;
  if (base) t += ` · ${base} elegido${base > 1 ? 's' : ''}`;
  if (extra) t += `${base ? ' +' : ' ·'} ${extra} extra`;
  return t;
}

// Solo los overrides de módulos que siguen en el plato: si el usuario ajusta un
// módulo a mano y luego lo quita, ese tamaño no debe seguir atando al resto.
// Los extras van siempre clavados: su tamaño lo eligió el usuario en el paso 5
// y el porcionador no debe moverlo por su cuenta.
function fijosVigentes(items) {
  const f = {};
  items.forEach(it => {
    if (selExtra[it.id]) f[it.id] = szExtra[it.id] ?? 1;
    else if (szManual[it.id] != null) f[it.id] = szManual[it.id];
  });
  return f;
}

// Corre en LOCAL, en cada toque, sin red: cientos de miles de combinaciones como
// mucho, resueltas por encuentro en el medio en pocos milisegundos.
function recalcular(manual = []) {
  const items = itemsPlato();
  const antes = ultimoPorc;
  if (!items.length) { ultimoPorc = null; szBase = {}; porque = null; idsRecalc = []; return null; }
  const r = porcionar(items, meta, { fijos: fijosVigentes(items) });
  // El porqué se deriva del diff de tamaños, nunca de un modelo de lenguaje, y
  // excluye lo que acaba de mover el usuario: la app no firma acciones ajenas.
  porque = explicarCambio(antes, r, items, meta, { manual });
  idsRecalc = porque ? porque.ids : [];
  ultimoPorc = r;
  // szBase solo cachea los módulos BASE; el tamaño de los extras lo manda szExtra.
  szBase = {};
  Object.keys(r.tamanos).forEach(id => { if (!selExtra[id]) szBase[id] = r.tamanos[id]; });
  return r;
}

// A3 · Qué pasaría si tocaras ESTA tarjeta. El mismo porcionado, con el módulo
// candidato añadido de forma hipotética.
// El orden importa de verdad: porcionar() enumera las combinaciones en el orden
// de `items` y conserva la primera cuando dos empatan en coste y precio. Si la
// tarjeta simulase el plato en otro orden que el que resulta al tocarla, podría
// prometer 100 g y $12 y entregar 150 g y $18. Se simula con el mismo recorrido.
function itemsConCandidato(cand) {
  const out = [];
  CATS_STEPS.forEach(cat => {
    const ids = [...(selBase[cat] || [])];
    if (cand.cat === cat && !ids.includes(cand.id)) ids.push(cand.id);
    ids.forEach(id => { const it = ING.find(i => i.id === id); if (it) out.push(it); });
  });
  return [...out, ...extrasElegidos()];
}

function hipotetico(it) {
  const items = itemsConCandidato(it);
  return porcionar(items, meta, { fijos: fijosVigentes(items) });
}

const MACRO_CORTO = { prot: 'proteína', carb: 'carbos', gras: 'grasas' };

// Etiqueta del tamaño para la tarjeta. A partir de 2 porciones el número va en
// negrita: es la respuesta a "¿cuántas de esto llevo?" y tiene que leerse de un
// vistazo, no descifrarse.
function etiquetaTamano(k) {
  const sv = SIZES.find(s => s.k === k);
  if (!sv) return 'Estándar';
  // "2½ porciones": el entero y la media en negrita, que es lo que hay que leer.
  return k >= 2 ? `<b>${Math.floor(k)}${k % 1 ? '½' : ''}</b> porciones` : sv.l;
}

// "¿Qué tan cerca me deja?" — el macro que quedaría MÁS lejos de la meta, que es
// el que de verdad limita el plato. Si los tres caben en el umbral, lo dice.
function textoCercania(r) {
  if (!r) return { txt: '', cierra: false };
  if (r.dentroDeUmbral) return { txt: 'Cierra tu meta', cierra: true };
  let k = 'prot', peor = -1;
  for (const m of ['prot', 'carb', 'gras']) {
    const d = Math.abs(r.desviacion[m]);
    if (d > peor) { peor = d; k = m; }
  }
  const v = r.desviacion[k];
  const n = Math.abs(Math.round(v * 10) / 10);
  return { txt: `Te deja ${v < 0 ? '−' : '+'}${n} g ${MACRO_CORTO[k]}`, cierra: false };
}

function totals() {
  let p=0,c=0,g=0,k=0;
  CATS.forEach(cat => {
    (selBase[cat]||[]).forEach(id => {
      const it=ING.find(i=>i.id===id); const m=mac(it,szBase[id]||1);
      p+=m.prot; c+=m.carb; g+=m.gras; k+=m.kcal;
    });
  });
  Object.keys(selExtra).forEach(id => {
    if(selExtra[id]){ const it=ING.find(i=>i.id===id); const m=mac(it,szExtra[id]||1); p+=m.prot;c+=m.carb;g+=m.gras;k+=m.kcal; }
  });
  return {prot:Math.round(p),carb:Math.round(c),gras:Math.round(g*10)/10,kcal:Math.round(k)};
}

function updateGlobalTracker() {
  if(meta.kcal===undefined) return; // 0 es una meta válida (manual): el tracker debe refrescarse igual
  const t = totals();
  const pp=Math.min(100,Math.round(t.prot/(meta.prot||1)*100));
  const cp=Math.min(100,Math.round(t.carb/(meta.carb||1)*100));
  const gp=Math.min(100,Math.round(t.gras/(meta.gras||1)*100));
  $('gt-kcal').textContent=`${t.kcal} / ${meta.kcal} kcal`;
  $('gtv-p').textContent=`${t.prot}/${meta.prot}g`;
  $('gtv-c').textContent=`${t.carb}/${meta.carb}g`;
  $('gtv-g').textContent=`${t.gras}/${meta.gras}g`;
  const bp=$('gtb-p'),bc=$('gtb-c'),bg=$('gtb-g');
  // scaleX en vez de width: sin reflow y sin animar una dimensión (ver .bar-fill)
  bp.style.transform=`scaleX(${pp/100})`;bc.style.transform=`scaleX(${cp/100})`;bg.style.transform=`scaleX(${gp/100})`;
  bp.className='bar-fill bp'+(t.prot>meta.prot?' bover':'');
  bc.className='bar-fill bc'+(t.carb>meta.carb?' bover':'');
  bg.className='bar-fill bg2'+(t.gras>meta.gras?' bover':'');
  $('global-tracker').classList.add('visible');
  renderPorque();
}

function renderMeta() {
  $('meta-panel').innerHTML=`
  <div class="meta-panel">
    <div class="meta-top">
      <div><div class="meta-ey">Meta por comida</div><div class="meta-ctx">${meta.objetivo === 'manual' ? (meta.comidas === 1 ? 'Macros personalizados por comida' : `${meta.comidas} comidas · Macros personalizados`) : `${meta.comidas} comidas · ${OBJ_LABEL[meta.objetivo]}`}</div></div>
      <div class="meta-tag">${meta.kcal} kcal</div>
    </div>
    <div class="meta-nums">
      <div class="mn"><div class="mn-val">${meta.prot}<span class="mn-unit">g</span></div><div class="mn-lbl p">Proteína</div></div>
      <div class="mn"><div class="mn-val">${meta.carb}<span class="mn-unit">g</span></div><div class="mn-lbl c">Carbos</div></div>
      <div class="mn"><div class="mn-val">${meta.gras}<span class="mn-unit">g</span></div><div class="mn-lbl g">Grasas</div></div>
      <div class="mn"><div class="mn-val">${meta.kcal}<span class="mn-unit" style="font-size:9px">cal</span></div><div class="mn-lbl k">Energía</div></div>
    </div>
    ${meta.ajusteCarb ? `<div class="meta-warn">Con tu perfil, la proteína y grasa objetivo cubren prácticamente todas tus calorías del día, así que tu meta de carbohidratos por comida quedó en 0 g. Te recomendamos validar tu plan con un especialista.</div>` : ''}
  </div>`;
}

function renderSubNav() {
  const dots = CATS_STEPS.map((c,i) => {
    const done = i < platoCatIdx;
    const active = i === platoCatIdx;
    return `<div class="psn-dot${active?' psn-active':done?' psn-done':''}">${done?'✓':(i+1)}</div>`;
  }).join('<div class="psn-line"></div>');
  const extraActive = platoCatIdx === 4;
  const extraDot = `<div class="psn-line"></div><div class="psn-dot${extraActive?' psn-active':''}">5</div>`;
  const lbl = platoCatIdx < 4 ? STEP_LABELS[CATS_STEPS[platoCatIdx]] : 'Extras sugeridos';
  return `<div class="plato-subnav">
    <div class="psn-steps">${dots}${extraDot}</div>
    <div class="psn-lbl">${lbl}</div>
  </div>`;
}

function renderBase() {
  $('base-mods').innerHTML = '';
  $('sugg-wrap').innerHTML = '';

  if (platoCatIdx === 4) {
    $('base-mods').innerHTML = renderSubNav();
    renderSugg();
    renderPlatoButtons();
    updateGlobalTracker();
    return;
  }

  const cat = CATS_STEPS[platoCatIdx];
  const items = ING.filter(i => i.cat === cat);
  const selCount = (selBase[cat]||[]).length;

  let html = renderSubNav();
  // Al llegar a la grasa saludable con la meta ya cubierta por lo elegido, el
  // aviso va ANTES de las tarjetas: la decisión que se pide aquí es no añadir.
  if (cat === 'grasa') html += nudgeGrasaHTML();
  html += `<div class="cat-sec"><div class="cat-hd"><span class="cat-nm">${CAT_LABEL[cat]}</span><span class="cat-ht">${textoEncabezado(cat)}</span></div><div class="items-grid">`;
  items.forEach(it => { html += tarjetaHTML(it, cat); });
  html += `</div></div><div id="cierre-wrap"></div>`;
  $('base-mods').innerHTML = html;
  renderCierre();
  renderPlatoButtons();
  updateGlobalTracker();
}

// ── FASE B · LA PROPUESTA DE CIERRE ──────────────────────────────────────────
// El cuello de botella del modo IA no es el algoritmo, es el inventario: el
// techo de carbohidratos con un solo módulo en Grande son 57 g contra una meta
// media de 96 g por comida, y a 1.346 de 1.600 perfiles (84%) no le alcanza
// ninguno por sí solo. La app ya soportaba varios módulos por categoría
// (selBase[cat] es un arreglo) y porcionar() los maneja sin cambios.
//
// No se impone: se propone, con lo que aporta y lo que cuesta, y acepta el
// usuario tocando "Añadir" —que es exactamente lo mismo que tocar la tarjeta.
function renderCierre() {
  const wrap = $('cierre-wrap');
  if (!wrap) return;
  const cat = CATS_STEPS[platoCatIdx];
  // El plato ENTERO, extras incluidos: es el mismo plato que porciona "+ Añadir".
  // Calcularlo sin los extras prometía un tamaño y un precio que no ocurrían.
  const plato = itemsPlato();

  // Solo donde el inventario se queda corto de verdad, con al menos un módulo de
  // la categoría ya elegido y sitio para otro: si no, esto sería la carta otra vez.
  const nCat = enCategoria(cat);
  if (cat !== 'carbohidrato' || !(selBase[cat] || []).length || nCat >= MAX_MODULOS_CAT) { wrap.innerHTML = ''; return; }

  const candidatos = ING.filter(i => i.cat === 'carbohidrato' && !selExtra[i.id]);
  // `colocar`: el candidato se enumera donde quedará al pulsar "+ Añadir", para
  // que la caja prometa exactamente lo que ocurre (empates incluidos).
  const p = proponerCierre(plato, meta, candidatos, { fijos: fijosVigentes(plato), colocar: (_, c) => itemsConCandidato(c) });
  if (!p) { wrap.innerHTML = ''; return; }

  const actual = ultimoPorc ? ultimoPorc.desviacion : null;
  // Si el macro que el candidato aporta ya SOBRA, ofrecer "cerrar la meta"
  // añadiendo más comida se contradice (y el reequilibrio que haría el motor
  // confunde): la caja solo aparece cuando de verdad FALTA ese macro.
  if (actual && actual[p.macro] > 0) { wrap.innerHTML = ''; return; }
  const falta = actual ? Math.abs(Math.round(actual[p.macro] * 10) / 10) : null;
  const verbo = actual && actual[p.macro] > 0 ? 'Te sobran' : 'Te faltan';
  const lbl = SIZES.find(s => s.k === p.tamano)?.l || 'Estándar';
  const quedaria = Math.abs(Math.round(p.desviacion[p.macro] * 10) / 10);
  const aportaG = p.macro === 'gras' ? p.aporta.gras : p.aporta[p.macro];

  wrap.innerHTML = `<div class="sugg-box">
    <div class="sugg-hd"><span class="sugg-badge">Cierre sugerido</span>
      <span class="sugg-desc">${falta !== null ? `${verbo} ${falta} g de ${MACRO_CORTO[p.macro]}` : 'Para acercarte a tu meta'}</span></div>
    <div class="sugg-item">
      <div class="sugg-thumb">${foto(p.it, 'sugg-img')}</div>
      <div class="sugg-main">
        <div class="sugg-macro-tag">Segundo ${CAT_LABEL[p.it.cat].toLowerCase()}</div>
        <div class="sugg-name">${p.it.nombre}</div>
        <div class="sugg-why">${lbl} · ${p.g} g · aporta ${aportaG} g de ${MACRO_CORTO[p.macro]}. Te dejaría a ${quedaria} g de tu meta${p.dentroDeUmbral ? ', dentro del umbral' : ''}.</div>
        <div class="sugg-controls">
          <div class="sugg-price">${p.deltaPrecio >= 0 ? '+' : '−'}$${Math.abs(p.deltaPrecio)}</div>
          <button class="btn-add off" onclick="event.stopPropagation();selBI('${p.it.id}','${p.it.cat}')">+ Añadir</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ── GRASAS CUBIERTAS · el aviso del paso de grasa saludable ──────────────────
// La grasa es el macro que se llena primero: salmón, tenderloin, camote y
// esquites la traen de serie, y es frecuente llegar a este paso con la meta ya
// alcanzada sin haber elegido ninguna. cubrenGrasa() lo detecta con el mismo
// porcionado que manda en el resto de la app, sobre el plato SIN sus módulos de
// grasa (base o extra). En este paso solo se tocan grasas, así que su resultado
// no cambia mientras se está en él: la caja nace con el paso y nunca se inserta
// a mitad (sin saltos). Lo único que cambia al elegir una grasa es el texto, en
// sitio. El texto no lleva cifras a propósito: persuade con QUIÉN cubre la meta.
function estadoNudgeGrasa() {
  const plato = itemsPlato();
  const sinGrasa = plato.filter(it => it.cat !== 'grasa');
  const c = cubrenGrasa(plato, meta, { fijos: fijosVigentes(sinGrasa) });
  if (!c) return null;
  return { c, grasas: plato.filter(it => it.cat === 'grasa') };
}

// "salmón y camote" / "salmón, camote y esquites"; con más de tres fuentes se
// generaliza: una lista larga ya no persuade, aturde.
function nombrarFuentes(fuentes) {
  if (fuentes.length > 3) return 'lo que ya elegiste';
  const n = fuentes.map(nombreCorto);
  return n.length === 1 ? n[0] : n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1];
}

function textosNudgeGrasa({ c, grasas }) {
  const fuentes = nombrarFuentes(c.fuentes);
  if (grasas.length) {
    return { estado: 'elegida',
      titulo: 'Tus grasas ya estaban cubiertas',
      texto: `Antes de este paso ya alcanzabas tu meta de grasas con ${fuentes}. Si quitas ${nombrarFuentes(grasas)}, tu plato vuelve a estar cubierto sin pagar de más.`,
      boton: 'Quitar y seguir sin grasa extra →', accion: 'quitarGrasasYSeguir()' };
  }
  if (c.estado === 'encima') {
    return { estado: 'encima',
      titulo: 'Tus grasas saludables ya están completas',
      texto: `Con ${fuentes} ya alcanzas tu meta de grasas, y con el plato completo la pasas. Añadir más te alejaría de tu objetivo: lo mejor es seguir sin grasa extra.`,
      boton: 'Seguir sin grasa extra →', accion: 'nextCat()' };
  }
  return { estado: 'justa',
    titulo: 'Ya llegaste a tu meta de grasas saludables',
    texto: `Con ${fuentes} ya alcanzas tu meta de grasas de esta comida. Puedes seguir sin añadir nada aquí: tu plato queda equilibrado y no pagas de más.`,
    boton: 'Seguir sin grasa extra →', accion: 'nextCat()' };
}

function nudgeGrasaHTML() {
  const est = estadoNudgeGrasa();
  if (!est) return '';
  const t = textosNudgeGrasa(est);
  return `<div class="nudge" id="nudge-grasa" role="status" data-estado="${t.estado}">
    <div class="nudge-hd"><span class="sugg-badge">Grasas cubiertas</span></div>
    <div class="nudge-title" id="nudge-title">${t.titulo}</div>
    <p class="nudge-text" id="nudge-text">${t.texto}</p>
    <button type="button" class="btn-add off nudge-btn" id="nudge-btn" onclick="${t.accion}">${t.boton}</button>
  </div>`;
}

// Solo el texto cambia al elegir o quitar una grasa; la caja ya estaba.
function refrescarNudgeGrasa() {
  const box = $('nudge-grasa');
  if (!box) return;
  const est = estadoNudgeGrasa();
  if (!est) return;
  const t = textosNudgeGrasa(est);
  box.dataset.estado = t.estado;
  setTexto($('nudge-title'), t.titulo);
  setTexto($('nudge-text'), t.texto);
  const btn = $('nudge-btn');
  setTexto(btn, t.boton);
  btn.setAttribute('onclick', t.accion);
}

// Quitar TODAS las grasas del plato (base y extras) y pasar al siguiente paso.
window.quitarGrasasYSeguir = function() {
  (selBase.grasa || []).forEach(id => { delete szManual[id]; delete ajustando[id]; });
  delete selBase.grasa;
  extrasElegidos().filter(it => it.cat === 'grasa').forEach(it => { delete selExtra[it.id]; delete szExtra[it.id]; delete szManual[it.id]; });
  recalcular();
  window.nextCat();
};

// La tarjeta ya no pregunta "¿cuánto?" sino "¿qué tan cerca me deja?".
// El tamaño que enseña es el que se aplicará al tocarla: elegida, el resuelto;
// sin elegir, el que tendría si entrara al plato.
// Estado de una tarjeta. Un módulo agregado como EXTRA en el paso 5 ya está en el
// plato: se pinta elegido y tocarlo lo quita, igual que a cualquier otro. Si no,
// la tarjeta prometía un tamaño, el toque lo duplicaba en selBase y el resumen y
// el QR lo listaban dos veces. Y cuando la categoría llega a su tope de módulos,
// las demás tarjetas lo dicen en vez de prometer un hipotético que no ocurrirá.
function estadoTarjeta(it, cat) {
  const esExtra = !!selExtra[it.id];
  const isSel = esExtra || (selBase[cat]||[]).includes(it.id);
  const tope = !isSel && enCategoria(cat) >= MAX_MODULOS_CAT;
  const r = isSel || tope ? ultimoPorc : hipotetico(it);
  const sz = esExtra ? (szExtra[it.id] ?? 1) : isSel ? (szBase[it.id] ?? 1) : (!tope && r ? r.tamanos[it.id] : 1);
  const m = mac(it, sz), pr = precio(it, sz);
  const fit = esExtra ? { txt:'En tu plato como extra', cierra:false }
            : tope    ? { txt:`Máximo ${MAX_MODULOS_CAT} por categoría`, cierra:false }
            : isSel   ? { txt:'', cierra:false } : textoCercania(r);
  return { isSel, esExtra, tope, sz, m, pr, fit };
}

function tarjetaHTML(it, cat) {
  const { isSel, esExtra, tope, sz, m, pr, fit } = estadoTarjeta(it, cat);
  const abierto = !!ajustando[it.id];

  // La tarjeta es un botón también para el teclado: Tab llega, Enter y Espacio
  // eligen o quitan, aria-pressed dice el estado y aria-disabled el tope. El
  // keydown solo actúa si el foco está en la propia tarjeta, no en sus píldoras.
  return `<div class="icard${isSel?' sel':''}${tope?' tope':''}${abierto?' ajustando':''}${idsRecalc.includes(it.id)?' recalc':''}" data-id="${it.id}"
      role="button" tabindex="0" aria-pressed="${isSel}"${tope?' aria-disabled="true"':''} aria-label="${it.nombre}"
      onclick="selBI('${it.id}','${cat}')"
      onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selBI('${it.id}','${cat}');}">
      <div class="i-photo">${foto(it,'i-img')}<div class="i-check"></div></div>
      <div class="i-body">
        <div class="i-top"><div class="i-name">${it.nombre}</div></div>
        <div class="i-macros"><div class="mp"><b>${m.prot}g</b> P</div><div class="mp"><b>${m.carb}g</b> C</div><div class="mp"><b>${m.gras}g</b> G</div></div>
        <div class="i-price">$${pr} MXN</div>
        <div class="i-fit${fit.cierra?' cierra':''}">${fit.txt}</div>
        <div class="i-foot">
          <div class="i-size-val">${etiquetaTamano(sz)} · ${m.g} g</div>
          <button type="button" class="btn-ajustar"${esExtra?' hidden':''} aria-expanded="${abierto}" aria-controls="pills-${it.id}"
            aria-label="Ajustar el tamaño de ${it.nombre}"
            onclick="event.stopPropagation();toggleAjuste('${it.id}')">Ajustar</button>
        </div>
        <div class="size-pills" id="pills-${it.id}" role="group" aria-label="Tamaño de ${it.nombre}">${tamanosPermitidos(it).map(k=>{
          const sv = SIZES.find(s=>s.k===k);
          const esResuelto = ultimoPorc && ultimoPorc.tamanos[it.id] === sv.k && szManual[it.id] == null;
          // role="button" promete teclado: Enter y Espacio tienen que funcionar, o
          // el foco entra en un callejón sin salida (WCAG 2.1.1). aria-pressed dice
          // cuál está activo a quien no ve el relleno negro.
          return `<div class="sz-pill${sz===sv.k?' sz-on':''}${esResuelto?' sz-rec':''}" role="button" tabindex="0" data-k="${sv.k}"
            aria-pressed="${sz===sv.k}" aria-label="${sv.l}, ${mac(it,sv.k).g} gramos"
            onclick="event.stopPropagation();setSzB('${it.id}','${cat}',${sv.k})"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();setSzB('${it.id}','${cat}',${sv.k});}">${sv.c||sv.l}${esResuelto?'<span class="rec-lbl">Resuelto</span>':''}</div>`;
        }).join('')}</div>
      </div>
    </div>`;
}

// Actualiza las tarjetas que YA están en el DOM en vez de reconstruir el HTML.
// Dos razones: la transition de opacity solo existe si el nodo sobrevive al
// cambio (con innerHTML nuevo no hay nada que transicionar), y así las fotos no
// se vuelven a decodificar en cada toque.
function refrescarTarjetas() {
  const cat = CATS_STEPS[platoCatIdx];
  if (platoCatIdx === 4) { renderBase(); return; }
  // El contador del encabezado también se actualiza en sitio: si no, se queda
  // congelado en el valor que tenía al entrar al paso.
  const ht = document.querySelector('.cat-ht');
  if (ht) ht.textContent = textoEncabezado(cat);
  document.querySelectorAll('.icard[data-id]').forEach(card => {
    const id = card.dataset.id;
    const it = ING.find(i => i.id === id);
    if (!it) return;
    const { isSel, esExtra, tope, sz, m, pr, fit } = estadoTarjeta(it, cat);

    card.classList.toggle('sel', isSel);
    card.setAttribute('aria-pressed', String(isSel));
    card.classList.toggle('tope', tope);
    if (tope) card.setAttribute('aria-disabled', 'true'); else card.removeAttribute('aria-disabled');
    const btnA = card.querySelector('.btn-ajustar'); if (btnA) btnA.hidden = esExtra;
    card.classList.toggle('ajustando', !!ajustando[id]);
    setTexto(card.querySelector('.i-price'), `$${pr} MXN`);
    setTexto(card.querySelector('.i-size-val'), `${etiquetaTamano(sz)} · ${m.g} g`, true);
    const elFit = card.querySelector('.i-fit');
    setTexto(elFit, fit.txt);
    if (elFit) elFit.classList.toggle('cierra', fit.cierra);
    card.querySelectorAll('.mp').forEach((el,i) => {
      setTexto(el, `<b>${[m.prot,m.carb,m.gras][i]}g</b> ${['P','C','G'][i]}`, true);
    });
    card.querySelectorAll('.sz-pill').forEach(pill => {
      const k = Number(pill.dataset.k);
      const esResuelto = ultimoPorc && ultimoPorc.tamanos[id] === k && szManual[id] == null;
      pill.classList.toggle('sz-on', sz === k);
      pill.classList.toggle('sz-rec', esResuelto);
      pill.setAttribute('aria-pressed', String(sz === k));
      const lblRec = pill.querySelector('.rec-lbl');
      if (esResuelto && !lblRec) pill.insertAdjacentHTML('beforeend', '<span class="rec-lbl">Resuelto</span>');
      if (!esResuelto && lblRec) lblRec.remove();
    });
    const btn = card.querySelector('.btn-ajustar');
    if (btn) btn.setAttribute('aria-expanded', String(!!ajustando[id]));
    // A4 · pulso del borde solo en las tarjetas que de verdad cambiaron de tamaño.
    card.classList.remove('recalc');
    if (idsRecalc.includes(id)) { void card.offsetWidth; card.classList.add('recalc'); }
  });
  refrescarNudgeGrasa();
  renderCierre();
  renderPorque();
  updateGlobalTracker();
}

// Crossfade de la cifra: el texto nuevo se escribe YA (el feedback tiene que
// verse en menos de 100 ms) y lo que se difumina es su opacidad. Solo se toca
// lo que de verdad cambió, para no hacer parpadear media pantalla.
function setTexto(el, valor, esHTML) {
  if (!el) return;
  const actual = esHTML ? el.innerHTML : el.textContent;
  if (actual === valor) return;
  if (esHTML) el.innerHTML = valor; else el.textContent = valor;
  el.style.opacity = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
}

// A5 · La línea de porqué, bajo la barra de macros.
function renderPorque() {
  const el = $('porque');
  if (!el) return;
  el.innerHTML = porque ? `<span>${porque.texto}</span>` : '';
}

function renderPlatoButtons() {
  const isFirst = platoCatIdx === 0;
  const isLast = platoCatIdx === 4;
  $('plato-btn-row').innerHTML = `
    ${isFirst
      ? `<button class="btn btn-ghost" onclick="goStep(0)">← Perfil</button>`
      : `<button class="btn btn-ghost" onclick="prevCat()">← Anterior</button>`}
    ${isLast
      ? `<button class="btn btn-main" onclick="goResumen()">Ver resumen</button>`
      : `<button class="btn btn-main" onclick="nextCat()">Siguiente →</button>`}
  `;
}

// Cambiar de paso no reajusta nada: arrastrar la frase y el pulso a la pantalla
// siguiente (o al resumen, o al perfil) sería afirmar un reajuste que no acaba
// de ocurrir. Se limpian al navegar.
function olvidarPorque(){ porque = null; idsRecalc = []; }

window.nextCat = function() {
  platoCatIdx = Math.min(platoCatIdx + 1, 4);
  olvidarPorque();
  renderBase();
  window.scrollTo({top:0,behavior:'smooth'});
};
window.prevCat = function() {
  platoCatIdx = Math.max(platoCatIdx - 1, 0);
  olvidarPorque();
  renderBase();
  window.scrollTo({top:0,behavior:'smooth'});
};

window.selBI = function(id,cat) {
  // Un extra del paso 5 ya está en el plato: tocarlo lo quita, no lo duplica.
  if (selExtra[id]) {
    delete selExtra[id]; delete szExtra[id]; delete szManual[id]; delete ajustando[id];
    recalcular();
    refrescarTarjetas();
    return;
  }
  if(!selBase[cat]) selBase[cat]=[];
  const idx=selBase[cat].indexOf(id);
  // Al tope de módulos de la categoría la tarjeta ya lo dice; el toque no hace nada.
  if (idx === -1 && enCategoria(cat) >= MAX_MODULOS_CAT) return;
  if(idx>-1){
    selBase[cat].splice(idx,1);
    if(!selBase[cat].length) delete selBase[cat];
    // Al salir del plato el módulo pierde su override y su panel abierto: si
    // vuelve a entrar, vuelve a entrar como una decisión del sistema.
    delete szManual[id]; delete ajustando[id];
  } else {
    selBase[cat].push(id);
  }
  // El tamaño ya no se pregunta: se resuelve, para TODOS los módulos a la vez.
  recalcular();
  refrescarTarjetas();
};

// "Ajustar" — revelación progresiva. Quien no lo toque nunca sabrá que existe.
window.toggleAjuste = function(id){
  if (selExtra[id]) return;              // el tamaño de un extra se ajusta en el paso 5
  ajustando[id] = !ajustando[id];
  const card = document.querySelector(`.icard[data-id="${id}"]`);
  if(!card) return;
  card.classList.toggle('ajustando', ajustando[id]);
  const btn = card.querySelector('.btn-ajustar');
  if(btn) btn.setAttribute('aria-expanded', String(!!ajustando[id]));
};

// Fijar un tamaño a mano lo CLAVA: el porcionado deja de moverlo y optimiza el
// resto a su alrededor, en vez de ignorar el override o sacar el módulo de la
// cuenta. Volver a tocar el tamaño resuelto devuelve el módulo al automático.
window.setSzB = function(id,cat,k){
  if (selExtra[id]) return;              // un extra no se clava desde aquí
  if(szManual[id] === k) delete szManual[id];
  else szManual[id] = k;
  // Se le dice a recalcular() QUIÉN movió este tamaño, para que la línea de
  // porqué no se atribuya la acción del usuario.
  recalcular([id]);
  refrescarTarjetas();
};

function renderSugg() {
  if(!Object.keys(selBase).length){
    $('sugg-wrap').innerHTML=`<div class="sugg-box"><div class="sugg-ok"><div class="sugg-ok-lbl" style="padding:1.25rem;font-size:12px;font-family:Inter,sans-serif;color:var(--muted)">Selecciona ingredientes en los pasos anteriores para ver sugerencias.</div></div></div>`;
    return;
  }
  const t=totals();
  // gG se normaliza a 1 decimal: t.gras trae decimales binarios (13.3) y la resta
  // directa imprimiría artefactos tipo "6.699999999999999g" en pantalla.
  const gP=meta.prot-t.prot,gC=meta.carb-t.carb,gG=Math.round((meta.gras-t.gras)*10)/10;
  const suggs=[];
  // Un extra cuenta para el tope de su categoría: si ya hay dos módulos, no se ofrece.
  const libre=cat=>enCategoria(cat)<MAX_MODULOS_CAT;
  if(gP>8&&libre('proteina')){const b=ING.filter(i=>i.cat==='proteina'&&!(selBase.proteina||[]).includes(i.id)&&!selExtra[i.id]).sort((a,b2)=>b2.prot-a.prot)[0];if(b)suggs.push({it:b,why:`Faltan ~${gP}g de proteína para alcanzar tu meta.`,m:'Proteína'});}
  if(gC>10&&libre('carbohidrato')){const b=ING.filter(i=>i.cat==='carbohidrato'&&!(selBase.carbohidrato||[]).includes(i.id)&&!selExtra[i.id]).sort((a,b2)=>b2.carb-a.carb)[0];if(b)suggs.push({it:b,why:`Faltan ~${gC}g de carbohidratos para energía sostenida.`,m:'Carbohidrato'});}
  if(gG>5&&libre('grasa')){const b=ING.filter(i=>i.cat==='grasa'&&!(selBase.grasa||[]).includes(i.id)&&!selExtra[i.id]).sort((a,b2)=>b2.gras-a.gras)[0];if(b)suggs.push({it:b,why:`Faltan ~${gG}g de grasas saludables.`,m:'Grasa'});}
  if(!suggs.length){
    // El "✓" solo con el umbral OFICIAL de la app (±UMBRAL_G por macro, el
    // mismo del tracker y el resumen) y mirando también los EXCESOS: afirmar
    // "ya cubre tu meta" con la barra de carbos rayada arriba se contradecía.
    const enMeta=Math.abs(gP)<=UMBRAL_G&&Math.abs(gC)<=UMBRAL_G&&Math.abs(gG)<=UMBRAL_G;
    const exceso=[];
    if(-gP>UMBRAL_G)exceso.push(`${Math.round(-gP)} g de proteína`);
    if(-gC>UMBRAL_G)exceso.push(`${Math.round(-gC)} g de carbohidratos`);
    if(-gG>UMBRAL_G)exceso.push(`${Math.round(-gG*10)/10} g de grasas`);
    $('sugg-wrap').innerHTML=enMeta
      ?`<div class="sugg-box"><div class="sugg-ok"><div class="sugg-ok-mark">✓</div><div class="sugg-ok-lbl">Tu plato ya cubre tu meta nutricional.</div></div></div>`
      :`<div class="sugg-box"><div class="sugg-ok"><div class="sugg-ok-lbl" style="padding:1.25rem">${exceso.length?`Llevas ${exceso.join(' y ')} por encima de tu meta. Puedes ajustar tamaños en el paso anterior.`:'Tu plato está muy cerca de tu meta: revisa el detalle en el resumen.'}</div></div></div>`;
    return;
  }
  let items='';
  // La tarjeta promete "para alcanzar tu meta": el tamaño que propone tiene
  // que ser el que mejor cierra el déficit de SU macro, no siempre Estándar
  // (con 84 g de carbos de menos, un camote Estándar dejaba 50/93 y la app
  // ofrecía un segundo extra). Se elige entre los tamaños que vende cocina y
  // se fija como selección, así carta = botón = resumen.
  const MK={Proteína:['prot',gP],Carbohidrato:['carb',gC],Grasa:['gras',gG]};
  suggs.slice(0,2).forEach(s=>{
    if(!szExtra[s.it.id]){
      const [mk,falta]=MK[s.m];
      szExtra[s.it.id]=tamanosPermitidos(s.it).reduce((best,k)=>Math.abs(falta-mac(s.it,k)[mk])<Math.abs(falta-mac(s.it,best)[mk])?k:best,1);
    }
  });
  suggs.slice(0,2).forEach(s=>{
    const sz=szExtra[s.it.id]||1,isOn=!!selExtra[s.it.id];
    const pr=precio(s.it,sz);
    items+=`<div class="sugg-item">
      <div class="sugg-thumb">${foto(s.it,'sugg-img')}</div>
      <div class="sugg-main">
        <div class="sugg-macro-tag">${s.m}</div>
        <div class="sugg-name">${s.it.nombre}</div>
        <div class="sugg-why">${s.why}</div>
        <div class="sugg-controls">
          <div class="sugg-sizes" role="group" aria-label="Tamaño de ${s.it.nombre}">${tamanosPermitidos(s.it).map(k=>{const sv=SIZES.find(x=>x.k===k);return `<div class="ss-pill${sz===k?' ss-on':''}" role="button" tabindex="0" aria-pressed="${sz===k}" aria-label="${sv.l}, ${mac(s.it,k).g} gramos" onclick="setSzE('${s.it.id}',${k})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setSzE('${s.it.id}',${k});}">${sv.c||sv.l}</div>`;}).join('')}</div>
          <div class="sugg-price">$${pr}</div>
          <button class="btn-add ${isOn?'on':'off'}" onclick="toggleE('${s.it.id}')">${isOn?'Quitar':'+ Agregar'}</button>
        </div>
      </div>
    </div>`;
  });
  $('sugg-wrap').innerHTML=`<div class="sugg-box"><div class="sugg-hd"><span class="sugg-badge">Extras sugeridos</span><span class="sugg-desc">Para alcanzar tu meta de macros</span></div>${items}</div>`;
}

window.setSzE = function(id,k){ szExtra[id]=k; recalcular([id]); renderSugg(); updateGlobalTracker(); };
window.toggleE = function(id){
  if(selExtra[id]){ delete selExtra[id]; }
  else {
    const it=ING.find(i=>i.id===id);
    if(it && enCategoria(it.cat)>=MAX_MODULOS_CAT) return;   // tope por categoría, base o extra
    selExtra[id]=true; if(!szExtra[id])szExtra[id]=1;
  }
  recalcular([id]); renderSugg(); updateGlobalTracker();
};

// El texto del QR es COMPACTO y solo ASCII: qrcodejs 1.0.0 calcula mal el tamaño
// en cuanto hay un carácter fuera de ASCII (un acento bastaba para desbordar) y
// con nombres largos superaba su capacidad. Cocina lee el ticket; el QR lleva
// ids, factor y gramos, que es lo que caja necesita escanear.
function buildQRText() {
  const ts=new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
  const lines=['COSECHA '+ts];
  CATS.forEach(cat=>{ (selBase[cat]||[]).forEach(id=>{ const it=ING.find(i=>i.id===id);const sz=szBase[id]||1,m=mac(it,sz);lines.push(id+' x'+sz+' '+m.g+'g'); }); });
  Object.keys(selExtra).forEach(id=>{ const it=ING.find(i=>i.id===id);const sz=szExtra[id]||1,m=mac(it,sz);lines.push('E:'+id+' x'+sz+' '+m.g+'g'); });
  const t=totals();
  lines.push('P'+t.prot+' C'+t.carb+' G'+t.gras+' K'+t.kcal);
  // El id del pedido que devolvió cocina, cuando lo hay: es ASCII (fecha + ids).
  if (cocina.estado === 'confirmado' && cocina.respuesta) lines.push(String(cocina.respuesta.pedido_id));
  // Todo el texto se filtra a ASCII: el QR no tolera un solo carácter fuera, y la
  // hora local puede traer un espacio estrecho (U+202F) según el navegador.
  return lines.join('\n').replace(/[^\x20-\x7E\n]/g, '');
}

function buildQRInstructions() {
  const inst=[];
  // `cocina` dice cómo se emplata un tamaño compuesto ("2 Estándar + 1 Pequeña").
  const etqCocina = sz => { const s = SIZES.find(x => x.k === sz); return s.l.toLowerCase() + (s.cocina ? ` (${s.cocina})` : ''); };
  CATS.forEach(cat=>{ (selBase[cat]||[]).forEach(id=>{ const it=ING.find(i=>i.id===id);const sz=szBase[id]||1,m=mac(it,sz);inst.push({cat:CAT_LABEL[cat],name:it.nombre,g:m.g,sz:etqCocina(sz),isExtra:false}); }); });
  Object.keys(selExtra).forEach(id=>{ const it=ING.find(i=>i.id===id);const sz=szExtra[id]||1,m=mac(it,sz);inst.push({cat:CAT_LABEL[it.cat],name:it.nombre,g:m.g,sz:etqCocina(sz),isExtra:true}); });
  return inst;
}

// ── COCINA · el plato se CIERRA contra n8n ────────────────────────────────────
// El resumen se pinta al instante con los números locales y la llamada al
// webhook sale después, sin bloquear nada. Lo que vuelve CONFIRMA (mismos
// números), EXPLICA (texto ya auditado en n8n: aquí no se redacta nada) y
// PROPONE (el cierre). Si discrepa, gana cocina, pero se enseñan las dos
// cifras. Sin red o pasados 8 s, el resumen se queda como está, marcado
// "Sin confirmar con cocina", y el QR y el ticket siguen valiendo.
//
//   seq        número de la llamada vigente: la respuesta tardía de un plato
//              que ya se editó no puede pintar encima del resumen nuevo.
//   clave      meta + selección del plato pedido: volver a abrir el mismo
//              resumen no dispara un segundo pedido.
//   historial  platos que cocina YA confirmó en esta sesión, por clave: quitar
//              el extra y volver tampoco genera un pedido nuevo.
let cocina = { seq: 0, clave: null, estado: null, motivo: null, errores: [], respuesta: null, local: null, llamada: null, historial: new Map() };

function reiniciarCocina() {
  if (cocina.llamada) cocina.llamada.cancelar();
  cocina = { seq: cocina.seq, clave: null, estado: null, motivo: null, errores: [], respuesta: null, local: null, llamada: null, historial: new Map() };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const etq = k => SIZES.find(s => s.k === k)?.l || 'Estándar';
const SKEL = n => `<div class="cocina-skel" aria-hidden="true">${'<span></span>'.repeat(n)}</div>`;

// Las líneas tal como las ve el cliente: base con su tamaño resuelto y extras
// con el suyo, en el orden de los pasos + extras (el mismo que porciona la app).
function lineasLocales() {
  const lineas = itemsPlato().map(it => {
    const k = selExtra[it.id] ? (szExtra[it.id] ?? 1) : (szBase[it.id] ?? 1);
    const m = mac(it, k);
    return { id: it.id, nombre: it.nombre, cat: it.cat, esExtra: !!selExtra[it.id], tamano: k, g: m.g, precio: precio(it, k),
             macros: { kcal: m.kcal, prot: m.prot, carb: m.carb, gras: m.gras } };
  });
  return { lineas, total: lineas.reduce((a, l) => a + l.precio, 0), macros: totals() };
}

// La propuesta que hará cocina se puede PREDECIR en local: mismo motor, mismos
// datos, todas las líneas clavadas a su tamaño, que es como la calcula n8n. No
// se enseña ni un número de esa predicción: sirve solo para reservar el hueco
// con la altura EXACTA de la tarjeta que va a llegar (misma estructura, mismo
// texto, oculto), de modo que al llegar cambie el contenido y no se mueva nada.
function predecirPropuesta() {
  const plato = itemsPlato();
  if (!plato.length) return null;
  const fijos = {}, porCat = {};
  plato.forEach(it => { fijos[it.id] = selExtra[it.id] ? (szExtra[it.id] ?? 1) : (szBase[it.id] ?? 1); porCat[it.cat] = (porCat[it.cat] || 0) + 1; });
  const candidatos = ING.filter(c => !plato.some(i => i.id === c.id) && (porCat[c.cat] || 0) < MAX_MODULOS_CAT);
  const p = proponerCierre(plato, meta, candidatos, { fijos });
  if (!p) return null;
  // Mismo formato que n8n/src/resolver.js. Con todas las líneas clavadas la
  // propuesta nunca reajusta otra línea, así que el texto es predecible.
  const LBLM = { prot: 'proteína', carb: 'carbohidratos', gras: 'grasas' };
  const precioTxt = p.deltaPrecio >= 0 ? `+${p.deltaPrecio} MXN` : `${p.deltaPrecio} MXN (el plato sale más barato)`;
  const descripcion = `Se AÑADE ${p.it.nombre} en ${etq(p.tamano)} (${p.g} g), que aporta ${p.aporta[p.macro]} g de ${LBLM[p.macro]}. Las demás líneas no cambian. Diferencia de precio: ${precioTxt}.`;
  return { it: p.it, descripcion, extra: p.deltaPrecio };
}

// La tarjeta de la propuesta: reservada (mismo contenido, oculto: solo ocupa) o
// lista, con `descripcion` tal cual y el precio extra con signo.
function propuestaHTML({ it, descripcion, extra }, reservado) {
  const tag = enCategoria(it.cat) >= 1 ? 'Segundo ' + CAT_LABEL[it.cat].toLowerCase() : CAT_LABEL[it.cat];
  return `<div class="sugg-box cocina-propuesta" data-estado="${reservado ? 'reservado' : 'listo'}"${reservado ? ' aria-hidden="true"' : ''}>
    <div class="sugg-hd"><span class="sugg-badge">Cierre sugerido</span><span class="sugg-desc">${reservado ? 'Revisando…' : 'Según cocina'}</span></div>
    <div class="sugg-item">
      <div class="sugg-thumb">${reservado ? '' : foto(it, 'sugg-img')}</div>
      <div class="sugg-main">
        <div class="sugg-macro-tag">${tag}</div>
        <div class="sugg-name">${esc(it.nombre)}</div>
        <div class="sugg-why">${esc(descripcion)}</div>
        <div class="sugg-controls">
          <div class="sugg-price">${extra >= 0 ? '+' : '−'}$${Math.abs(extra)}</div>
          <button type="button" class="btn-add off"${reservado ? ' disabled tabindex="-1"' : ''} onclick="aceptarPropuestaCocina()">+ Añadir</button>
        </div>
      </div>
    </div>
  </div>`;
}

// Cambia un bloque sin que salte lo que el cliente está mirando: si el bloque
// queda por encima de lo visible, el scroll se compensa con lo que creció o
// encogió (lo que hace el anclaje de scroll del navegador, pero en todos).
function sinSalto(idRegion, fn) {
  const ancla = document.querySelector('.qr-section');
  const region = document.getElementById(idRegion);
  const bAntes = region ? region.getBoundingClientRect().bottom : 1;
  const tAntes = ancla ? ancla.getBoundingClientRect().top : null;
  fn();
  if (!ancla || tAntes === null || bAntes > 0) return;
  const delta = ancla.getBoundingClientRect().top - tAntes;
  if (delta) window.scrollBy(0, delta);
}

const ESTADO_LBL = { confirmando: 'Confirmando con cocina…', confirmado: 'Confirmado por cocina', sin_confirmar: 'Sin confirmar con cocina', demo: 'Modo demo' };
const MOTIVO_TXT = { timeout: 'Cocina no respondió a tiempo.', red: 'Sin conexión con cocina.',
                     http: 'Cocina no aceptó el pedido.', respuesta_invalida: 'Cocina respondió algo que no es un pedido.' };

// Pinta el hueco de cocina según el estado. Cambia el contenido, nunca la caja.
function pintarCocina() {
  const box = $('cocina');
  if (!box) return;
  sinSalto('cocina-propuesta', () => {
    const est = cocina.estado || 'confirmando';
    box.dataset.estado = est;
    $('cocina-estado').textContent = ESTADO_LBL[est];
    const body = $('cocina-body'), propWrap = $('cocina-propuesta');
    if (est === 'confirmando') {
      body.innerHTML = SKEL(8);
    } else if (est === 'demo') {
      // Sin jerga interna ("esta copia"): al usuario se le dice qué pasa y qué
      // vale de lo que ve.
      body.innerHTML = `<p class="cocina-nota">Modo demo: aquí no se envían pedidos a cocina. Tu resumen y tu código funcionan con los números de tu pantalla.</p>`;
      if (propWrap) propWrap.innerHTML = '';
    } else if (est === 'sin_confirmar') {
      const errs = cocina.errores.length ? ' ' + cocina.errores.map(esc).join('. ') + '.' : '';
      body.innerHTML = `<p class="cocina-nota">${MOTIVO_TXT[cocina.motivo] || MOTIVO_TXT.red}${errs} Tu resumen y tu código siguen siendo válidos con los números de tu pantalla.</p>`;
      if (propWrap) propWrap.innerHTML = '';
    } else {
      const r = cocina.respuesta;
      const disc = compararConCocina(cocina.local, r);
      let html = '';
      // La explicación es la que llega, ya auditada en n8n. Si no llega, se omite.
      if (r.explicacion) html += `<p class="cocina-texto">${esc(r.explicacion)}</p>`;
      r.avisos.forEach(a => { html += `<p class="cocina-aviso">${esc(a)}</p>`; });
      r.rechazados.forEach(x => { html += `<p class="cocina-aviso">${esc(x.nombre || x.id)}: ${esc(x.motivo)}</p>`; });
      if (disc.hay) html += discrepanciaHTML(disc);
      body.innerHTML = html;
      pintarTotalSegunCocina(disc);
      pintarPropuesta(r);
    }
    const ped = $('qr-pedido');
    if (ped) ped.textContent = est === 'confirmado' ? `Pedido ${cocina.respuesta.pedido_id}` : '';
  });
}

// La discrepancia se enseña con las dos cifras, línea a línea. Gana cocina.
function discrepanciaHTML(d) {
  const f = l => `${etq(l.tamano)} · ${l.g} g · $${l.precio}`;
  const fc = c => `${esc(c.etiqueta)} · ${c.g} g · $${c.precio}`;
  let h = `<div class="cocina-disc"><div class="cocina-disc-hd">Cocina calculó distinto</div>`;
  if (d.total) h += `<p><b>Total:</b> cocina calculó <b>$${d.total.cocina}</b>; tu pantalla decía $${d.total.local}.</p>`;
  d.lineas.forEach(l => {
    if (!l.cocina) h += `<p><b>${esc(l.nombre)}:</b> no está en el plato de cocina${l.motivo ? ` (${esc(l.motivo)})` : ''}; tu pantalla decía ${f(l.local)}.</p>`;
    else if (!l.local) h += `<p><b>${esc(l.nombre)}:</b> cocina añadió ${fc(l.cocina)}; no estaba en tu pantalla.</p>`;
    else h += `<p><b>${esc(l.nombre)}:</b> cocina calculó ${fc(l.cocina)}; tu pantalla decía ${f(l.local)}.</p>`;
  });
  if (d.macros) {
    const m = x => `${x.prot} g P · ${x.carb} g C · ${x.gras} g G · ${x.kcal} kcal`;
    h += `<p><b>Macros:</b> cocina calculó ${m(d.macros.cocina)}; tu pantalla decía ${m(d.macros.local)}.</p>`;
  }
  return h + '</div>';
}

function pintarTotalSegunCocina(disc) {
  const lbl = $('res-total-lbl'), val = $('res-total-val');
  if (!lbl || !val) return;
  if (disc.hay) { lbl.textContent = 'Total según cocina'; val.textContent = `$${cocina.respuesta.total} MXN`; }
  else { lbl.textContent = 'Total a pagar'; val.textContent = `$${cocina.local.total} MXN`; }
}

// La propuesta de cierre de cocina. Solo si se puede aceptar de verdad: existe
// en la carta, no está ya en el plato y su categoría no está al tope.
function pintarPropuesta(r) {
  const wrap = $('cocina-propuesta');
  if (!wrap) return;
  const p = r.propuesta_cierre;
  const it = p && ING.find(i => i.id === p.id);
  const k = p ? K_DE_ETIQUETA[p.tamano] : null;
  const puede = it && k != null && tamanosPermitidos(it).includes(k)
    && !selExtra[it.id] && !(selBase[it.cat] || []).includes(it.id) && enCategoria(it.cat) < MAX_MODULOS_CAT;
  wrap.innerHTML = puede ? propuestaHTML({ it, descripcion: p.descripcion, extra: p.precio_extra }, false) : '';
}

// UNA llamada por plato cerrado. La respuesta se aplica solo si sigue siendo la
// vigente; timeout, red y rechazo terminan igual: "Sin confirmar con cocina".
function confirmarConCocina(extra = {}) {
  const local = lineasLocales();
  const pedido = armarPedido(meta, local.lineas, extra);
  const clave = clavePedido(pedido);
  if (clave === cocina.clave && (cocina.estado === 'confirmando' || cocina.estado === 'confirmado' || cocina.estado === 'demo')) { pintarCocina(); return; }
  if (cocina.llamada) cocina.llamada.cancelar();
  // Un plato que cocina ya confirmó en esta sesión se vuelve a enseñar, no a pedir.
  const previo = cocina.historial.get(clave);
  if (previo) {
    cocina = { ...cocina, seq: cocina.seq + 1, clave, estado: 'confirmado', motivo: null, errores: [], respuesta: previo.respuesta, local: previo.local, llamada: null };
    pintarCocina();
    dibujarQR();
    return;
  }
  const seq = cocina.seq + 1;
  const llamada = llamarCocina(pedido);
  cocina = { ...cocina, seq, clave, estado: 'confirmando', motivo: null, errores: [], respuesta: null, local, llamada };
  pintarCocina();
  llamada.promesa.then(res => {
    if (seq !== cocina.seq || res.motivo === 'cancelado') return;   // el plato ya es otro
    try {
      if (res.ok) {
        cocina.estado = 'confirmado'; cocina.respuesta = res.data;
        cocina.historial.set(clave, { respuesta: res.data, local });
        if (cocina.historial.size > 20) cocina.historial.delete(cocina.historial.keys().next().value);
      } else {
        cocina.estado = res.motivo === 'demo' ? 'demo' : 'sin_confirmar'; cocina.motivo = res.motivo; cocina.errores = res.errores || [];
      }
      cocina.llamada = null;
      pintarCocina();
      // El QR se redibuja con el pedido solo si el resumen está a la vista: si el
      // cliente está editando, el plato de pantalla ya no es el de esta respuesta.
      if (res.ok && $('sc2').classList.contains('active')) dibujarQR();
    } catch (e) {
      cocina.estado = 'sin_confirmar'; cocina.motivo = 'respuesta_invalida'; cocina.errores = []; cocina.respuesta = null; cocina.llamada = null;
      pintarCocina();
      console.warn('cocina:', e.message);
    }
  });
}

// Aceptar el cierre. Lo prometido es "las demás líneas no cambian": se clavan a
// su tamaño de ahora (como si el cliente las hubiera fijado con Ajustar, que es
// lo que acaba de hacer al aceptar ESTE plato) y el módulo entra como extra al
// tamaño propuesto. Sin clavarlas, el porcionado reajustaba las líneas base al
// añadir el extra y el cliente recibía otro plato y otro precio que los que
// aceptó. Luego se repinta el resumen y se REPITE la llamada declarando el
// upsell y el pedido al que responde. Rechazarla es no tocar nada.
window.aceptarPropuestaCocina = function() {
  const r = cocina.respuesta, p = r && r.propuesta_cierre;
  if (cocina.estado !== 'confirmado' || !p) return;
  const it = ING.find(i => i.id === p.id);
  if (!it || selExtra[it.id] || (selBase[it.cat] || []).includes(it.id) || enCategoria(it.cat) >= MAX_MODULOS_CAT) return;
  const k = K_DE_ETIQUETA[p.tamano];
  // Un tamaño fuera del tope de la categoría no entra: n8n no lo propone nunca,
  // pero una respuesta malformada tampoco puede colar un vegetal a 4 porciones.
  if (k == null || !tamanosPermitidos(it).includes(k)) return;
  itemsPlato().forEach(x => { if (!selExtra[x.id] && szManual[x.id] == null) szManual[x.id] = szBase[x.id] ?? 1; });
  szExtra[it.id] = k;
  window.toggleE(it.id);
  // Las tarjetas del paso 2 siguen en el DOM: se refrescan para que, al volver,
  // enseñen los tamaños ya clavados y no un "Resuelto" que dejó de ser verdad.
  refrescarTarjetas();
  pintarResumen();
  confirmarConCocina({ upsell_aceptado: true, pedido_id_previo: r.pedido_id });
  // El cliente estaba abajo, en la propuesta: se le lleva al total nuevo (bajo el
  // tracker fijo, no debajo de él) y el foco pasa al estado de cocina.
  const total = document.querySelector('.res-total'), tracker = $('global-tracker');
  if (total) {
    total.style.scrollMarginTop = ((tracker ? tracker.offsetHeight : 0) + 12) + 'px';
    total.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  const box = $('cocina');
  if (box) { box.tabIndex = -1; box.focus({ preventScroll: true }); }
};

function dibujarQR() {
  const el = $('qr-canvas');
  if (!el || !window.QRCode) return;
  el.innerHTML = '';
  try { new QRCode(el, { text: buildQRText(), width: 120, height: 120, colorDark: '#1a1a18', colorLight: '#F4F2EE', correctLevel: QRCode.CorrectLevel.M }); }
  catch (e) { el.innerHTML = '<div class="qr-fallo">QR no disponible</div>'; console.warn('QR:', e.message); }
}

window.goResumen = function() {
  if(!Object.keys(selBase).length){
    // Error EN la interfaz, nunca alert() (regla del proyecto). Si ni
    // siquiera hay perfil, la guarda de goStep ya acomoda el mensaje ahí.
    if (!(meta && typeof meta.kcal === 'number')) { goStep(2); return; }
    goStep(1);
    const aviso = $('plato-aviso');
    if (aviso) {
      aviso.textContent = 'Elige al menos un módulo para ver tu resumen.';
      clearTimeout(aviso._t);
      aviso._t = setTimeout(() => { aviso.textContent = ''; }, 5000);
    }
    return;
  }
  pintarResumen();
  confirmarConCocina();
};

// El resumen LOCAL, al instante. El hueco de cocina y el de la propuesta nacen
// aquí, con su altura ya reservada, para que la respuesta no mueva nada.
function pintarResumen() {
  // El resumen nunca lleva la línea de porqué: repintarlo estando ya en él (al
  // aceptar el cierre) también la limpia.
  olvidarPorque(); renderPorque();
  let rows='',total=0,tP=0,tC=0,tG=0,tK=0;
  CATS.forEach(cat=>{
    (selBase[cat]||[]).forEach(id=>{
      const it=ING.find(i=>i.id===id);const sz=szBase[id]||1,m=mac(it,sz),pr=precio(it,sz);
      tP+=m.prot;tC+=m.carb;tG+=m.gras;tK+=m.kcal;total+=pr;
      rows+=`<div class="res-item"><div class="res-left"><div class="res-thumb">${foto(it,'res-img')}</div><div><div class="res-name">${it.nombre}</div><div class="res-sub">${SIZES.find(s=>s.k===sz)?.l||'Estándar'} · ${m.g}g</div></div></div><div class="res-right"><div class="res-macs"><span class="res-mac" style="color:var(--green)">${m.prot}g P</span><span class="res-mac" style="color:var(--blue)">${m.carb}g C</span><span class="res-mac" style="color:var(--amber)">${m.gras}g G</span></div><div class="res-price">$${pr}</div></div></div>`;
    });
  });
  Object.keys(selExtra).forEach(id=>{
    const it=ING.find(i=>i.id===id);const sz=szExtra[id]||1,m=mac(it,sz),pr=precio(it,sz);
    tP+=m.prot;tC+=m.carb;tG+=m.gras;tK+=m.kcal;total+=pr;
    rows+=`<div class="res-item"><div class="res-left"><div class="res-thumb">${foto(it,'res-img')}</div><div><div class="res-extra-tag">Extra</div><div class="res-name">${it.nombre}</div><div class="res-sub">${SIZES.find(s=>s.k===sz)?.l||'Estándar'} · ${m.g}g</div></div></div><div class="res-right"><div class="res-macs"><span class="res-mac" style="color:var(--green)">${m.prot}g P</span><span class="res-mac" style="color:var(--blue)">${m.carb}g C</span><span class="res-mac" style="color:var(--amber)">${m.gras}g G</span></div><div class="res-price">$${pr}</div></div></div>`;
  });
  const dP=Math.round(tP)-meta.prot,dC=Math.round(tC)-meta.carb,dG=Math.round(tG-meta.gras),dK=Math.round(tK)-meta.kcal;
  // Umbrales coherentes entre sí: ±TOLG g por macro equivalen hasta 4·4+4·4+9·4 = 68 kcal.
  // Reduce (no elimina del todo) los casos de "En tu meta" ×3 con kcal en rojo: las kcal de
  // etiqueta de data.js no cumplen 4/4/9 exacto y en platos grandes pueden apilarse más allá de 68.
  const TOLG=4,TOLK=TOLG*(4+4+9);
  const fmtKcal=v=>v>0?'+'+v:''+v;
  const clsKcal=v=>Math.abs(v)<=TOLK?'ok':'off';
  const clsMacro=v=>Math.abs(v)<=TOLG?'ok':v>0?'over':'under';
  const fmtMacro=(v,unit)=>{ if(Math.abs(v)<=TOLG) return 'En tu meta'; return v>0?`${v}${unit} de más`:`${Math.abs(v)}${unit} de menos`; };
  const insts=buildQRInstructions();
  // "Porción 3 porciones (3 Estándar)" era redundante: si el tamaño ya habla
  // de porciones, va tal cual; solo las piezas simples llevan el prefijo.
  const szTxt=sz=>/porci/i.test(sz)?sz:`Porción ${sz.toLowerCase()}`;
  const instHTML=insts.map((it,i)=>`<div class="qr-inst-item"><div class="qr-inst-num">${i+1}</div><div><div class="qr-inst-text">${it.name}${it.isExtra?' <span style="font-size:10px;color:var(--accent);font-family:Inter,sans-serif">(extra)</span>':''}</div><div class="qr-inst-detail">${szTxt(it.sz)} · <strong>${it.g}g</strong> · ${it.cat}</div></div></div>`).join('');
  const prediccion = predecirPropuesta();
  $('res-content').innerHTML=`
    <div class="res-wrap">${rows}<div class="res-total"><div class="res-total-lbl" id="res-total-lbl">Total a pagar</div><div class="res-total-val" id="res-total-val">$${total} MXN</div></div></div>
    <div class="gap-wrap"><div class="gap-hd">Diferencia vs tu meta</div><div class="gap-grid">
      <div class="gap-blk"><div class="gap-num ${clsKcal(dK)}">${fmtKcal(dK)}</div><div class="gap-lbl">kcal</div></div>
      <div class="gap-blk"><div class="gap-num ${clsMacro(dP)}">${fmtMacro(dP,'g')}</div><div class="gap-lbl">proteína</div></div>
      <div class="gap-blk"><div class="gap-num ${clsMacro(dC)}">${fmtMacro(dC,'g')}</div><div class="gap-lbl">carbos</div></div>
      <div class="gap-blk"><div class="gap-num ${clsMacro(dG)}">${fmtMacro(dG,'g')}</div><div class="gap-lbl">grasas</div></div>
    </div></div>
    <div class="gap-wrap cocina" id="cocina" data-estado="confirmando" aria-live="polite" aria-atomic="true">
      <div class="gap-hd"><span>Cocina</span><span class="cocina-estado" id="cocina-estado">${ESTADO_LBL.confirmando}</span></div>
      <div class="cocina-body" id="cocina-body">${SKEL(8)}</div>
    </div>
    <div id="cocina-propuesta" aria-live="polite">${prediccion ? propuestaHTML(prediccion, true) : ''}</div>
    <div class="qr-section"><div class="qr-hd"><div class="qr-hd-lbl">Código para cocina</div><div class="qr-hd-tag">Escanear en caja</div></div>
      <div class="qr-body"><div class="qr-code-wrap"><div id="qr-canvas"></div><p>Escanea para<br>ver orden</p><div class="qr-pedido" id="qr-pedido"></div></div>
      <div class="qr-instructions"><div class="qr-inst-title">Porciones exactas</div>${instHTML}</div></div></div>`;
  // Un plato nuevo en el resumen rearma el botón del diario (vive fuera de
  // res-content a propósito: así no se repinta con cada respuesta de cocina).
  const bd = $('btn-diario-plato');
  if (bd && clavePlato() !== platoEnDiario) { bd.textContent = '+ Añadir a mi diario'; bd.classList.remove('ok'); bd.disabled = false; delete bd.dataset.ok; }
  // Repintar el resumen estando ya en él (al aceptar el cierre) no debe
  // devolver al cliente al principio de la página.
  if (!$('sc2').classList.contains('active')) goStep(2);
  setTimeout(dibujarQR, 200);
}

window.goStep = function(n) {
  // Sin meta calculada no hay plato que armar: saltar ahí por el stepper
  // dejaba una pantalla muerta con el Perfil marcado "✓" sin estarlo.
  if (n > 0 && !(meta && typeof meta.kcal === 'number')) {
    n = 0;
    const err = $(modoActual === 'manual' ? 'manual-error' : 'formula-error');
    if (err) {
      err.textContent = 'Completa tu perfil y toca Continuar para armar tu plato.';
      clearTimeout(err._t);
      err._t = setTimeout(() => { err.textContent = ''; }, 5000);
    }
  }
  olvidarPorque();
  renderPorque();
  document.querySelectorAll('.screen').forEach((s,i)=>s.classList.toggle('active',i===n));
  for(let i=0;i<3;i++){
    const d=$('d'+i),l=$('l'+i);
    d.className='s-dot'+(i<n?' done':i===n?' active':'');
    l.className='s-lbl'+(i===n?' active':'');
    d.textContent=i<n?'✓':(i+1);
  }
  window.scrollTo({top:0,behavior:'smooth'});
};

// Las tarjetas de objetivo y actividad fijan la meta de TODA la app: tienen
// que operarse con teclado igual que las tarjetas del plato (role, tabindex,
// aria-pressed, Enter/Espacio). El keydown solo actúa con el foco en la
// propia tarjeta, mismo patrón que el resto del proyecto.
document.querySelectorAll('.obj-card, .act-card').forEach(c => {
  c.setAttribute('role', 'button');
  c.setAttribute('tabindex', '0');
  c.setAttribute('aria-pressed', String(c.classList.contains('selected')));
  c.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); c.click(); }
  });
});
// El stepper es navegación real: también opera con teclado.
document.querySelectorAll('.s-node').forEach(n => {
  n.setAttribute('role', 'button');
  n.setAttribute('tabindex', '0');
  n.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === n) { e.preventDefault(); n.click(); }
  });
});

// Arranque: el perfil guardado rellena el formulario (corre al final, cuando
// setMode y compañía ya existen en window) y la app abre en Hoy.
restaurarPerfil();
prepararMetaGuardada();
renderHoy();
montarSesionActiva();
