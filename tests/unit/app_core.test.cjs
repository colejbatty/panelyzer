const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers.cjs');

const A = loadApp();

test('fluor name resolution: aliases, punctuation, “X (equivalent)” forms', () => {
  const r = s => (A.resolveFluor(s) || {}).name;
  assert.equal(r('AF647'), 'Alexa Fluor 647');
  assert.equal(r('PE/Dazzle 594'), 'PE-Dazzle 594');
  assert.equal(r('brilliant violet 605'), 'BV605');
  assert.equal(r('FITC (cFluor B520)'), 'FITC');
  assert.equal(r('NovaFluor Blue 610-30S'), 'NovaFluor Blue 610/30S');
  assert.equal(r('SBUV795'), 'StarBright UV 795');
  assert.equal(r('Imaginary Dye 999'), undefined);
  assert.ok(A.suggestFluors('BV6O5').includes('BV605'));
});

test('measured library is preferred over simulation on the Aurora preset', () => {
  assert.equal(A.signature('PE').source, 'library');
  assert.equal(A.signature('CF568').source, 'simulated');
  assert.ok(A.registry().byName.get('SBUV445').hcOnly, 'library-only fluors are added');
});

test('default simulation gains are fitted to the measured library', () => {
  const g = A.autoGains(A.instrument({ noGains: true }));
  assert.ok(g && g.n >= 40 && g.rmsAfter < g.rmsBefore);
});

test('panel analysis + warnings on a tiny panel', () => {
  A.state.rows = [A.newRow({ marker: 'CD3', fluor: 'APC' }), A.newRow({ marker: 'CD4', fluor: 'Alexa Fluor 647' }), A.newRow({ marker: 'X', fluor: 'Nonexistent 123' })];
  A.invalidate('all');
  const { names, an } = A.analysis();
  assert.deepEqual(names, ['APC', 'Alexa Fluor 647']);
  assert.ok(an.ci > 1);
  const w = A.panelWarnings().map(x => x.text).join('\n');
  assert.match(w, /not in the library/);
});

test('panel files: saved as "panelyzer"; files from before the rename still open', () => {
  const saved = JSON.parse(A.serialize());
  assert.equal(saved.app, 'panelyzer');
  const legacy = Object.assign({}, saved, { app: 'spectral-panel-designer', panelName: 'Old file' });
  A.load(legacy);
  assert.equal(JSON.parse(A.serialize()).app, 'panelyzer');
  assert.throws(() => A.load(Object.assign({}, saved, { app: 'something-else' })), /not a Panelyzer panel/);
});
