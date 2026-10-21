const test = require('node:test');
const assert = require('node:assert/strict');
const { SPD, DATA, lib } = require('./helpers.cjs');

const inst = DATA.INSTRUMENTS.find(i => i.id === 'aurora-5l'), dets = SPD.detectors(inst);
const pool = [...lib.values()].filter(f => f.kind === 'dye' && ['Polymer dye', 'Tandem', 'Small molecule', 'Phycobiliprotein'].includes(f.group))
  .map(f => { const s = SPD.simulateSignature(f, inst, dets); return { id: f.name, sig: s.sig, brightness: f.brightness, bestEx: s.bestEx }; })
  .filter(p => p.bestEx > 0.15);

test('fluor-set search keeps required fluors, hits the target and respects the similarity limit', async () => {
  const r = await SPD.optimizeFluorSet(pool, ['PE', 'APC'], { target: 20, maxCos: 0.95, timeLimitMs: 20000 });
  assert.equal(r.ids.length, 20); assert.ok(r.ids.includes('PE') && r.ids.includes('APC'));
  const cols = r.ids.map(id => pool.find(p => p.id === id).sig), C = SPD.cosineMatrix(cols), n = cols.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(C[i * n + j] <= 0.95 + 1e-9);
  assert.ok(Math.abs(SPD.complexityIndex(cols) - r.objective) / r.objective < 0.02, 'objective ≈ exact CI');
});

test('assignment: never worse than the starting assignment; locks and reserved fluors respected', async () => {
  const names = ['BV421', 'BV510', 'BV605', 'PE', 'PE-Cy7', 'APC', 'BB515', 'BUV395'];
  const cols = names.map(n => SPD.simulateSignature(lib.get(n), inst, dets).sig), an = SPD.analyzePanel(cols);
  const br = names.map(n => lib.get(n).brightness);
  const markers = names.map((n, i) => ({ name: 'M' + i, expression: [1, 3, 2, 4][i % 4], weight: i === 0 ? 2 : 1, tags: [i % 2 ? 'T' : 'B'], lockedFluor: -1 }));
  markers[3].lockedFluor = 3;
  const initial = names.map((_, i) => i);
  const base = SPD.evaluateAssignment(markers, initial, an, br, names.length, {}).cost;
  const r = await SPD.optimizeAssignment(markers, an, br, names.length, { initial, reserved: [7] });
  assert.ok(r.cost <= base + 1e-12);
  assert.equal(r.assignment[3], 3, 'locked marker kept');
  assert.equal(new Set(r.assignment).size, names.length);
});

test('identical markers: optimizer keeps the current assignment (ties are not reshuffled)', async () => {
  const names = ['BV421', 'PE', 'APC', 'BB515'];
  const cols = names.map(n => SPD.simulateSignature(lib.get(n), inst, dets).sig), an = SPD.analyzePanel(cols);
  const markers = names.map(() => ({ expression: 2, weight: 1, tags: [], lockedFluor: -1 }));
  const r = await SPD.optimizeAssignment(markers, an, [3, 3, 3, 3], 4, { initial: [0, 1, 2, 3] });
  assert.deepEqual(r.assignment, [0, 1, 2, 3]);
});

test('zero-weight markers (autofluorescence) never produce NaN costs', () => {
  const names = ['BV421', 'PE'];
  const cols = names.map(n => SPD.simulateSignature(lib.get(n), inst, dets).sig), an = SPD.analyzePanel(cols);
  const ev = SPD.evaluateAssignment([{ expression: 2, weight: 1, tags: ['all'] }, { expression: 0, weight: 0, tags: ['all'] }], [0, 1], an, [3, 1], 2, {});
  assert.ok(Number.isFinite(ev.cost));
});
