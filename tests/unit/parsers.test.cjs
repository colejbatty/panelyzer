const test = require('node:test');
const assert = require('node:assert/strict');
const { SPD, DATA, lib, writeFCS, gauss, fixture, cos } = require('./helpers.cjs');

const inst = DATA.INSTRUMENTS.find(i => i.id === 'aurora-5l');
const dets = SPD.detectors(inst);

test('reference CSV: fluors-in-rows and detectors-in-rows', () => {
  const a = SPD.simulateSignature(lib.get('PE'), inst, dets).sig, b = SPD.simulateSignature(lib.get('APC'), inst, dets).sig;
  const rows = 'Fluor,' + dets.map(d => d.name + '-A').join(',') + '\nPE,' + [...a].join(',') + '\nAPC,' + [...b].join(',') + '\n';
  const r1 = SPD.parseReferenceTable(rows, dets);
  assert.equal(r1.orientation, 'fluors-in-rows'); assert.equal(r1.matched, 64);
  assert.ok(cos(r1.signatures[0].sig, a) > 0.999999);
  const cols = 'Detector\tPE\tAPC\n' + dets.map((d, i) => `${d.name}\t${a[i]}\t${b[i]}`).join('\n');
  const r2 = SPD.parseReferenceTable(cols, dets);
  assert.equal(r2.orientation, 'detectors-in-rows');
  assert.ok(cos(r2.signatures[1].sig, b) > 0.999999);
  assert.throws(() => SPD.parseReferenceTable('a,b\n1,2', dets));
});

test('custom spectrum CSV is resampled and normalized', () => {
  let csv = 'wavelength,ex,em\n';
  for (let w = 350; w <= 800; w += 2) csv += `${w},${Math.exp(-(((w - 470) / 25) ** 2))},${2 * Math.exp(-(((w - 640) / 30) ** 2))}\n`;
  const s = SPD.parseSpectrumTable(csv);
  assert.equal(SPD.peakWl(s.ex), 468); assert.equal(SPD.peakWl(s.em), 640);
});

test('FCS parse + single-stain signature extraction recovers the spectrum', () => {
  const rng = SPD.makeRng(11), truth = SPD.simulateSignature(lib.get('PE'), inst, dets).sig;
  const names = ['FSC-A', 'SSC-A', ...dets.map(d => d.name + '-A')];
  const ev = [], neg = [];
  for (let e = 0; e < 8000; e++) {
    const a = rng() < 0.4 ? 2e5 * Math.exp(0.3 * gauss(rng)) : 0;
    ev.push([5e5 + 5e4 * gauss(rng), 2e5 + 3e4 * gauss(rng), ...dets.map((d, i) => { const m = 800 + a * truth[i]; return m + 3 * Math.sqrt(m) * gauss(rng); })]);
    neg.push([5e5 + 5e4 * gauss(rng), 2e5 + 3e4 * gauss(rng), ...dets.map(() => 800 + 85 * gauss(rng))]);
  }
  const fcs = SPD.parseFCS(writeFCS(names, ev)), unst = SPD.parseFCS(writeFCS(names, neg));
  assert.equal(fcs.N, 8000); assert.equal(fcs.P, 66); assert.equal(fcs.names[2], 'UV1-A');
  const r = SPD.signatureFromFCS(fcs, dets, { negative: unst });
  assert.equal(r.peakDet, 'YG1'); assert.ok(cos(r.sig, truth) > 0.9999, 'with unstained');
  assert.ok(cos(SPD.signatureFromFCS(fcs, dets, {}).sig, truth) > 0.999, 'internal negative');
  const af = SPD.autofluorescenceFromFCS(unst, dets);
  assert.ok(af.nEvents > 1000 && Math.max(...af.sig) === 1);
});

test('Honeychrome .kit: profiles in fluorescence_channel_ids order, AF via channel_names', () => {
  const kit = JSON.parse(fixture('synthetic_experiment.kit'));
  const r = SPD.parseHoneychromeKit(kit, dets);
  assert.equal(r.matched, 64); assert.equal(r.refs.length, 4); assert.equal(r.af.length, 1); assert.equal(r.af[0].components, 2);
  const pe = r.refs.find(x => x.label === 'PE');
  assert.equal(dets[pe.sig.indexOf(1)].name, 'YG1'); assert.equal(pe.antigen, 'CD8');
  assert.throws(() => SPD.parseHoneychromeKit({}, dets));
});

test('Panel Check export (written by the Python plugin) is readable', () => {
  const pc = JSON.parse(fixture('panel_check_export.json'));
  const r = SPD.parsePanelCheck(pc, dets);
  assert.equal(r.matched, 64); assert.equal(r.refs.length, 4); assert.ok(r.panelCheck);
  assert.ok(Math.abs(r.spread.scale - 7) < 1e-9); assert.equal(r.refs[0].stainIndex, 500);
  assert.equal(r.af[0].name, 'Synthetic AF');
});
