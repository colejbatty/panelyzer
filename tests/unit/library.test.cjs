const test = require('node:test');
const assert = require('node:assert/strict');
const { SPD, DATA, lib, spectraText, HC, B64 } = require('./helpers.cjs');

test('every bundled FPbase spectrum passes its checksum', () => {
  const lines = spectraText.trim().split('\n');
  assert.ok(lines.length >= 270);
  for (const line of lines) {
    const [name, , , , ec, , mc, chk] = line.split('|');
    let c = 0; for (const ch of ec + mc) c = (c * 31 + B64.indexOf(ch)) % 9973;
    assert.equal(c, +chk, `checksum ${name}`);
  }
});

test('library: every dye has metadata, derived dyes resolve, spectra are normalized', () => {
  assert.ok(lib.size >= 300, `library size ${lib.size}`);
  for (const f of lib.values()) {
    if (f.kind === 'dye') assert.ok(DATA.META[f.name], `META for ${f.name}`);
    assert.ok(Math.abs(Math.max(...f.em) - 1) < 1e-9 && Math.abs(Math.max(...f.ex) - 1) < 1e-9, `normalized ${f.name}`);
  }
  for (const d of DATA.DERIVED) assert.equal(lib.get(d.name).source, 'Derived');
});

test('known peak positions are where they should be', () => {
  const peaks = { BV421: [400, 425], FITC: [510, 525], PE: [570, 585], APC: [655, 665], 'PE-Cy7': [770, 790] };
  for (const [n, [lo, hi]] of Object.entries(peaks)) {
    const p = lib.get(n).emPeak; assert.ok(p >= lo && p <= hi, `${n} emission peak ${p}`);
  }
});

test('Honeychrome measured library: shapes and channel counts', () => {
  assert.equal(HC.Aurora.channels.length, 64);
  assert.equal(HC.ID7000.channels.length, 182);
  for (const key of ['Aurora', 'ID7000']) for (const [n, code] of Object.entries(HC[key].spectra)) {
    assert.equal(code.length, HC[key].channels.length, `${key} ${n}`);
    assert.ok([...code].some(c => c === '_'), `${key} ${n} has a peak of 1`);
  }
});

test('simulated signatures put fluors on the expected Aurora detectors', () => {
  const inst = DATA.INSTRUMENTS.find(i => i.id === 'aurora-5l'), dets = SPD.detectors(inst);
  const expect = { BV421: 'V1', PE: 'YG1', APC: 'R1', BUV395: 'UV2', 'PE-Cy7': 'YG9' };
  for (const [n, det] of Object.entries(expect)) assert.equal(SPD.simulateSignature(lib.get(n), inst, dets).peakDet, det, n);
});
