// GUÍA EN CONTEXTO — consejos que aparecen la primera vez que algo está en
// pantalla ("toca aquí", "esto es…"), uno a la vez, como TipKit en iOS. No hay
// tutorial obligatorio: se cierran con ×, tocando el elemento señalado o con
// "No mostrar más". Lo ya visto se guarda en preferencias.guia (vía almacén).
import * as almacen from './almacen.js';

// En orden de prioridad: sale el primero no visto cuyo elemento esté a la vista.
// La barra de pestañas va al final porque se ve en todas las pantallas.
export const TIPS = [
  { id: 'hoy-perfil', sel: '#hoy-sin-meta .hoy-bv-cta', t: 'Empieza aquí', m: 'Con tu perfil calculamos tu meta para cada comida. Toma un minuto.' },
  { id: 'pedir-pasos', sel: '#vista-pedir #stepper', t: 'Son tres pasos', m: 'Tu perfil, tu plato y el resumen. Puedes volver a cualquiera tocando su número.' },
  { id: 'pedir-barra', sel: '#global-tracker.visible', t: 'Tu meta en vivo', m: 'Esta barra se llena con cada ingrediente que eliges y te dice cuánto te falta.' },
  { id: 'pedir-qr', sel: '.qr-section', t: 'Así pides', m: 'Muestra este código en caja y te preparan tu plato con las porciones exactas.' },
  { id: 'diario-agregar', sel: '.dia-vacia-btn', t: 'Registra lo que comes', m: 'Toca aquí y busca tu alimento. Hay porciones caseras, como «1 pieza grande».' },
  { id: 'entrenar-rutinas', sel: '.en-rut .en-card-nombre', t: 'Rutinas listas', m: 'Ábrela para ver sus ejercicios y empezarla.' },
  { id: 'sesion-serie', sel: '[data-acc="empezar-serie"]', t: 'Tu serie', m: 'Tócalo al empezar y otra vez al terminar. El descanso corre solo.' },
  { id: 'pestanas', sel: '.tabbar', t: 'Todo a un toque', m: 'Aquí cambias entre Hoy, Pedir, Diario y Entrenar.' },
];

// El primer consejo pendiente cuyo elemento se ve. `ver(sel)` devuelve el
// elemento visible o null (inyectable para probarlo sin navegador).
export function siguiente(vistos, ver) {
  for (const tip of TIPS) {
    if (vistos.has(tip.id)) continue;
    const el = ver(tip.sel);
    if (el) return { tip, el };
  }
  return null;
}

function verEnPantalla(sel) {
  const el = document.querySelector(sel);
  if (!el || !el.getClientRects().length) return null;   // no está o está oculto
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight ? el : null;
}

let vistos, actual = null, burbuja, espera;

function guardarVistos() {
  almacen.actualizar(e => ({ ...e, preferencias: { ...e.preferencias, guia: [...vistos] } }));
}

function cerrar(todos = false) {
  if (!actual) return;
  if (todos) TIPS.forEach(t => vistos.add(t.id)); else vistos.add(actual.tip.id);
  guardarVistos();
  actual.el.classList.remove('guia-foco');
  actual = null;
  burbuja.hidden = true;
  programar();   // puede haber otro consejo esperando en esta misma pantalla
}

function colocar() {
  if (!actual) return;
  const r = actual.el.getBoundingClientRect(), b = burbuja.getBoundingClientRect();
  const margen = 16, hueco = 12;
  // Ni bajo la hora/batería (≈56px) ni encima de la barra de pestañas.
  const piso = document.querySelector('.tabbar')?.getBoundingClientRect().top ?? innerHeight;
  const abajo = r.bottom + hueco + b.height < piso - 8;
  const top = abajo ? r.bottom + hueco : r.top - hueco - b.height;
  const centro = Math.max(r.left, 0) + Math.min(r.width, innerWidth) / 2;
  const left = Math.min(Math.max(centro - b.width / 2, margen), innerWidth - margen - b.width);
  burbuja.style.top = `${Math.max(top, 56)}px`;
  burbuja.style.left = `${left}px`;
  burbuja.dataset.lado = abajo ? 'abajo' : 'arriba';
  burbuja.style.setProperty('--flecha', `${Math.min(Math.max(centro - left, 20), b.width - 20)}px`);
}

function revisar() {
  if (actual) {
    if (verEnPantalla(actual.tip.sel) === actual.el) { colocar(); return; }
    actual.el.classList.remove('guia-foco');   // su pantalla se fue: sin marcarlo visto
    actual = null;
    burbuja.hidden = true;
  }
  actual = siguiente(vistos, verEnPantalla);
  if (!actual) return;
  burbuja.querySelector('.guia-t').textContent = actual.tip.t;
  burbuja.querySelector('.guia-m').textContent = actual.tip.m;
  actual.el.classList.add('guia-foco');
  burbuja.hidden = false;
  colocar();
}

// Revisa a lo más cada 400 ms: deja asentar la pantalla y no se queda esperando
// para siempre si algo (el cronómetro) cambia el DOM cada segundo.
function programar() { espera ??= setTimeout(() => { espera = null; revisar(); }, 400); }

export function iniciarGuia() {
  vistos = new Set(almacen.cargar().preferencias.guia || []);
  if (TIPS.every(t => vistos.has(t.id))) return;
  burbuja = document.createElement('div');
  burbuja.className = 'guia';
  burbuja.hidden = true;
  burbuja.setAttribute('role', 'status');   // VoiceOver lo lee sin robar el foco
  burbuja.innerHTML = `<div class="guia-txt"><p class="guia-t"></p><p class="guia-m"></p>
    <button type="button" class="guia-todos">No mostrar más consejos</button></div>
    <button type="button" class="guia-x" aria-label="Cerrar consejo">×</button>`;
  document.body.append(burbuja);
  burbuja.querySelector('.guia-x').addEventListener('click', () => cerrar());
  burbuja.querySelector('.guia-todos').addEventListener('click', () => cerrar(true));
  // Tocar lo señalado también cuenta como aprendido (y la acción sigue su curso).
  // Por selector (Entrenar repinta y reemplaza el elemento) o por el botón que
  // lo contiene (tocar cualquier parte de la tarjeta de una rutina también vale).
  document.addEventListener('click', e => {
    if (actual && (e.target.closest?.(actual.tip.sel) || actual.el.closest('summary, button')?.contains(e.target))) cerrar();
  }, true);
  new MutationObserver(programar).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'open'] });
  addEventListener('scroll', () => { requestAnimationFrame(colocar); programar(); }, { passive: true });
  addEventListener('resize', programar);
  programar();
}
