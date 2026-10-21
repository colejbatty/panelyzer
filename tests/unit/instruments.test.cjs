const test = require('node:test');
const assert = require('node:assert/strict');
const { SPD, DATA, HC } = require('./helpers.cjs');

test('preset detector counts match published configurations', () => {
  const count = id => SPD.detectors(DATA.INSTRUMENTS.find(i => i.id === id)).length;
  assert.equal(count('aurora-5l'), 64);
  assert.equal(count('id7000-5l'), 147);
  assert.equal(count('id7000-7l'), 184);
});

test('detector names match Honeychrome channel naming (Aurora and ID7000)', () => {
  for (const [id, key] of [['aurora-5l', 'Aurora'], ['id7000-7l', 'ID7000']]) {
    const dets = SPD.detectors(DATA.INSTRUMENTS.find(i => i.id === id));
    const names = new Set(HC[key].channels.map(SPD.normDetName));
    const matched = dets.filter(d => names.has(SPD.normDetName(d.name))).length;
    assert.ok(matched >= dets.length - 2, `${id}: ${matched}/${dets.length}`);
  }
});

test('ID7000 shared grid is monotone and per-laser start channels are right', () => {
  const inst = DATA.INSTRUMENTS.find(i => i.id === 'id7000-5l');
  for (const L of inst.lasers) {
    const first = +L.detectors[0].name.split('-')[1];
    assert.equal(first, { 355: 1, 405: 1, 488: 4, 561: 10, 637: 17 }[L.wl]);
    for (let i = 1; i < L.detectors.length; i++) assert.ok(L.detectors[i].lo >= L.detectors[i - 1].hi - 1e-6);
  }
});

test('channel-name normalization', () => {
  assert.equal(SPD.normDetName('UV1-A'), 'UV1');
  assert.equal(SPD.normDetName('405CH12-A'), '405-12');
  assert.equal(SPD.normDetName('405nm CH12'), '405-12');
  assert.equal(SPD.normDetName('488-4'), '488-4');
});
