// ═════════════════════════════════════════════════════════════════════════════
// TEMPORIZADOR — el descanso entre series, patrón Hevy/Strong.
//
// La regla que ordena todo: el tiempo restante SIEMPRE se deriva de la hora de
// FIN (finMs) contra el reloj, nunca restando segundos en un intervalo. Un
// setInterval se congela cuando la pantalla se bloquea o la pestaña duerme;
// con la hora de fin, al volver tras 2 minutos en segundo plano el restante es
// exacto sin hacer nada. El intervalo de la UI solo REPINTA, no cuenta.
//
// Lo puro vive arriba, con reloj inyectable para poder probarlo en Node. La
// capa de navegador (wake lock, beep, vibración) va abajo con detección de
// capacidades: importar este módulo en Node no toca DOM ni navigator.
// ═════════════════════════════════════════════════════════════════════════════

// Un descanso. `ahora` se inyecta en los tests; en la app es el reloj real.
// `finMs` es getter a propósito: ajustar() y saltar() lo mueven y quien guardó
// el objeto debe ver siempre el fin vigente, no una copia de la creación.
export function crearDescanso({ duracionS, ahora = () => Date.now() }) {
  let finMs = ahora() + duracionS * 1000;
  return {
    get finMs() { return finMs; },
    // Redondeo hacia ARRIBA: con 300 ms por correr el cliente ve "1", no "0".
    // Es lo que hace un cronómetro de verdad: el 0 llega con el final. Y nunca
    // negativo: tras dormir la pestaña el reloj puede estar muy pasado del fin.
    restanteS() { return Math.max(0, Math.ceil((finMs - ahora()) / 1000)); },
    // ±15 s mueven el FIN, no un contador. El mínimo es ahora(): quitar 15 s a
    // un descanso con 10 por correr lo termina ya, no lo deja "debiendo" 5.
    ajustar(deltaS) { finMs = Math.max(ahora(), finMs + deltaS * 1000); },
    // Saltar el descanso = el fin es ahora. Mismo camino que un fin natural:
    // quien mire restanteS() o haTerminado() no distingue cómo terminó.
    saltar() { finMs = ahora(); },
    haTerminado() { return ahora() >= finMs; },
  };
}

// 90 → '1:30'. Sin horas a propósito: ningún descanso entre series las necesita.
// Entrada rara (negativos, NaN) → '0:00': formatear pinta, no valida.
export function formatear(s) {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Capa de navegador. Todo con detección de capacidades y en try/catch: en Node
// no existe navigator ni AudioContext y este módulo debe importar igual.
// ─────────────────────────────────────────────────────────────────────────────

// El sentinel vive aquí, no en quien pide: así liberarWakeLock() siempre sabe
// qué soltar y pedir dos veces no acumula bloqueos.
let sentinel = null;

// Mantener la pantalla encendida durante el descanso. Si el navegador no lo
// soporta (o el usuario lo niega), null y la app sigue: el fin se calcula por
// hora de fin precisamente porque la pantalla PUEDE apagarse.
export async function pedirWakeLock() {
  if (typeof navigator === 'undefined' || !navigator.wakeLock) return null;
  try {
    liberarWakeLock();
    sentinel = await navigator.wakeLock.request('screen');
    // El sistema lo suelta solo al ir a segundo plano: se limpia la referencia
    // para no "liberar" después un sentinel ya muerto.
    sentinel.addEventListener?.('release', () => { sentinel = null; });
    return sentinel;
  } catch (e) {
    return null;
  }
}

export function liberarWakeLock() {
  try { if (sentinel) sentinel.release(); } catch (e) { /* ya estaba suelto */ }
  sentinel = null;
}

// Un solo AudioContext para toda la sesión: crearlo por beep acumula contextos
// (Chrome los limita a 6) y en iOS solo sirve el que nació de un gesto.
let ctxAudio = null;

// Llamar en el PRIMER toque del usuario (empezar descanso, abrir entreno): iOS
// solo permite crear/reanudar audio dentro de un gesto, y el aviso de fin llega
// después, sin gesto. Preparado aquí, avisarFin() ya puede sonar solo.
export function prepararAudio() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    if (!ctxAudio) ctxAudio = new AC();
    if (ctxAudio.state === 'suspended') ctxAudio.resume();
    return ctxAudio;
  } catch (e) {
    return null;
  }
}

// Fin del descanso: doble beep corto sintetizado (nada de archivos: un .mp3 es
// una petición más y en iOS ni suena sin gesto) + vibración con el mismo
// patrón. La envolvente de ganancia evita el "clic" de cortar la onda en seco.
export function avisarFin() {
  const c = prepararAudio();
  if (c) {
    try {
      const beep = (t0) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.frequency.value = 880;
        osc.connect(gain);
        gain.connect(c.destination);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        osc.start(t0);
        osc.stop(t0 + 0.22);
      };
      const t = c.currentTime;
      beep(t);
      beep(t + 0.3);
    } catch (e) { /* sin audio el aviso sigue: queda la vibración */ }
  }
  if (typeof navigator !== 'undefined') {
    try { navigator.vibrate?.([200, 100, 200]); } catch (e) { /* opcional */ }
  }
}
