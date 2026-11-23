// Cifras de matriz de puntos (5×7) como SVG en línea: la cifra del anillo de Hoy.
// Solo dígitos: cualquier otro carácter se ignora. El SVG va aria-hidden porque
// el número accesible lo da el aria-label del anillo.
const G = {
  0: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};
const PASO = 4.4, RADIO = 1.9, HUECO = 3;

export function puntos(n) {
  let x = 0, c = '';
  for (const ch of String(n)) {
    const g = G[ch];
    if (!g) continue;
    g.forEach((fila, r) => {
      for (let k = 0; k < 5; k++) {
        if (fila[k] === '1') c += `<circle cx="${+(x + k * PASO + RADIO).toFixed(1)}" cy="${+(r * PASO + RADIO).toFixed(1)}" r="${RADIO}"/>`;
      }
    });
    x += 4 * PASO + 2 * RADIO + HUECO;
  }
  const w = +Math.max(0, x - HUECO).toFixed(1), h = +(6 * PASO + 2 * RADIO).toFixed(1);
  return `<svg class="puntos" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">${c}</svg>`;
}
