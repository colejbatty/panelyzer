#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
// Bundles Spectral Panel Designer into one self-contained, offline HTML file.
//   node scripts/build.mjs          -> dist/SpectralPanelDesigner.html (+ dist/index.html for GitHub Pages)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

const spectra = read('data/fpbase_spectra.txt').trim();
const hcLibrary = read('data/honeychrome_library.json').trim();
const js = [
  read('src/engine.js'),
  read('src/data_lib.js'),
  `self.SPD_FPBASE_LINES = ${JSON.stringify(spectra)};\nself.SPD_HC_LIBRARY = ${hcLibrary};`,
  read('src/charts.js'),
  read('src/app_core.js'),
  read('src/app_views.js'),
].join('\n;\n').replace(/<\/script/gi, '<\\/script');

const appVersion = (read('src/app_core.js').match(/APP_VERSION = '([^']+)'/) || [])[1];
if (appVersion !== pkg.version) {
  console.error(`Version mismatch: package.json ${pkg.version} vs APP_VERSION ${appVersion} in src/app_core.js`);
  process.exit(1);
}

/** Reproducible build date: SOURCE_DATE_EPOCH, else the last commit date, else today. */
function buildDate() {
  if (process.env.SOURCE_DATE_EPOCH) return new Date(1000 * +process.env.SOURCE_DATE_EPOCH).toISOString().slice(0, 10);
  try { return execSync('git log -1 --format=%cs', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || today(); } catch { return today(); }
}
function today() { return new Date().toISOString().slice(0, 10); }

const html = read('src/index.html')
  .replace('/*__CSS__*/', () => read('src/styles.css'))
  .replace('/*__JS__*/', () => js)
  .replace('__VERSION__', pkg.version)
  .replace('__BUILD__', buildDate());

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'SpectralPanelDesigner.html'), html);
writeFileSync(join(root, 'dist', 'index.html'), html);
console.log(`dist/SpectralPanelDesigner.html  ${(html.length / 1024).toFixed(0)} KB  (v${pkg.version})`);
