// Test helpers: engine + data loader, synthetic FCS writer, app-core loader (no DOM needed).
const path = require('node:path');
const fs = require('node:fs');
const base = require('../../tools/lib_node.cjs');

/** Minimal FCS 3.1 writer (float32, little endian). events: array of arrays. */
function writeFCS(names, events, extraKw = {}) {
  const P = names.length, N = events.length;
  const kw = Object.assign({ $BYTEORD: '1,2,3,4', $DATATYPE: 'F', $MODE: 'L', $NEXTDATA: '0', $PAR: String(P), $TOT: String(N) }, extraKw);
  names.forEach((n, i) => { kw[`$P${i + 1}N`] = n; kw[`$P${i + 1}B`] = '32'; kw[`$P${i + 1}E`] = '0,0'; kw[`$P${i + 1}R`] = '4194304'; });
  const text = (b, e) => '/' + Object.entries(Object.assign({}, kw, { $BEGINDATA: String(b).padStart(12, '0'), $ENDDATA: String(e).padStart(12, '0') })).map(([a, v]) => `${a}/${v}`).join('/') + '/';
  const tBeg = 58, len = text(0, 0).length, dBeg = tBeg + len, dEnd = dBeg + N * P * 4 - 1;
  const t = text(dBeg, dEnd);
  const header = ('FCS3.1    ' + [tBeg, tBeg + t.length - 1, dBeg, dEnd, 0, 0].map(v => String(v).padStart(8, ' ')).join('')).padEnd(58, ' ');
  const buf = Buffer.alloc(dEnd + 1);
  buf.write(header, 0, 'latin1'); buf.write(t, tBeg, 'latin1');
  let off = dBeg; for (const ev of events) for (const v of ev) { buf.writeFloatLE(v, off); off += 4; }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

function gauss(rng) { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }

/** Loads src/app_core.js headlessly (it only touches the DOM inside UI functions). */
function loadApp() {
  globalThis.self = globalThis;
  globalThis.SPD_FPBASE_LINES = base.spectraText;
  globalThis.SPD_HC_LIBRARY = base.HC;
  globalThis.SPD = base.SPD;
  globalThis.SPDCharts = { fluorColor: () => '#000' };
  delete require.cache[require.resolve('../../src/app_core.js')];
  require('../../src/app_core.js');
  return globalThis.SPDApp;
}

const fixture = name => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
module.exports = Object.assign({}, base, { writeFCS, gauss, loadApp, fixture });
