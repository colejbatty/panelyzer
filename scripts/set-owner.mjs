#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
// Replaces the OWNER placeholder in links with your GitHub user or organization.
//   node scripts/set-owner.mjs <github-user-or-org>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owner = process.argv[2];
if (!owner || !/^[A-Za-z0-9-]+$/.test(owner)) { console.error('usage: node scripts/set-owner.mjs <github-user-or-org>'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['README.md', 'CITATION.cff', 'CHANGELOG.md', 'CONTRIBUTING.md', 'package.json', 'src/index.html', 'plugin/panel_check_tab.py', 'docs/HONEYCHROME.md', '.github/ISSUE_TEMPLATE/config.yml'];
for (const f of files) {
  let s;
  try { s = readFileSync(join(root, f), 'utf8'); } catch { continue; }
  const t = s.replace(/OWNER(?=\.github\.io|\/panelyzer)/g, owner);
  if (t !== s) { writeFileSync(join(root, f), t); console.log('updated', f); }
}
