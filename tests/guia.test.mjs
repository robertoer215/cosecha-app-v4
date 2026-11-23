import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIPS, siguiente } from '../js/guia.js';
import { migrar } from '../js/almacen.js';

test('guía: sale el primer consejo no visto cuyo elemento está a la vista', () => {
  const enPantalla = new Set(['.tabbar', '.dia-vacia-btn']);
  const ver = sel => (enPantalla.has(sel) ? { sel } : null);
  // La barra de pestañas va al final: el consejo del Diario gana aunque ambos se vean.
  assert.equal(siguiente(new Set(), ver).tip.id, 'diario-agregar');
  assert.equal(siguiente(new Set(['diario-agregar']), ver).tip.id, 'pestanas');
  assert.equal(siguiente(new Set(TIPS.map(t => t.id)), ver), null);
  assert.equal(siguiente(new Set(), () => null), null);
  assert.equal(new Set(TIPS.map(t => t.id)).size, TIPS.length, 'ids repetidos');
});

test('guía: lo visto sobrevive a la migración y la basura se descarta', () => {
  assert.deepEqual(migrar({ preferencias: { guia: ['hoy-perfil', 3, null] } }).preferencias.guia, ['hoy-perfil']);
  assert.equal('guia' in migrar({ preferencias: { guia: 'x' } }).preferencias, false);
  assert.equal('guia' in migrar({}).preferencias, false);
});
