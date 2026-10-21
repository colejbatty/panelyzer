const test = require('node:test');
const assert = require('node:assert/strict');
const { SPD, DATA, lib, cos } = require('./helpers.cjs');

test('detector-gain calibration recovers distorted references', () => {
  const inst = DATA.INSTRUMENTS.find(i => i.id === 'aurora-5l'), dets = SPD.detectors(inst), rng = SPD.makeRng(42);
  const gains = dets.map(() => 0.6 + 0.9 * rng());
  const fl = ['BV421', 'BV605', 'BUV395', 'BUV737', 'FITC', 'PE', 'PE-Cy7', 'APC', 'APC-Fire 750', 'BV785'];
  const pairs = fl.map(n => { const base = SPD.simulateRaw(lib.get(n), inst, dets); return { base, meas: SPD.normMax(base.map((v, i) => v * gains[i])) }; });
  const r = SPD.calibrateGains(pairs, dets);
  assert.ok(r.rmsAfter < r.rmsBefore / 20, `${r.rmsBefore} -> ${r.rmsAfter}`);
  const held = SPD.simulateRaw(lib.get('BV650'), inst, dets);
  const truth = held.map((v, i) => v * gains[i]);
  assert.ok(cos(held.map((v, i) => v * r.gains[i]), truth) > cos(held, truth), 'held-out dye improves');
});
