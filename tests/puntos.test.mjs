import test from 'node:test';
import assert from 'node:assert/strict';
import { puntos } from '../js/puntos.js';

test('puntos: una cifra de matriz 5×7 por dígito, lo demás se ignora', () => {
  const n = s => (s.match(/<circle/g) || []).length;
  assert.equal(n(puntos(8)), 17);
  assert.equal(n(puntos(2238)), 2 * n(puntos(2)) + n(puntos(3)) + 17);
  assert.equal(n(puntos('kcal')), 0);
  assert.match(puntos(0), /aria-hidden="true"/);
});
