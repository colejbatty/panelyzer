#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Cole Batty and contributors
/**
 * Regenerates the README screenshots in docs/images/ from the built app.
 *   npm run build && node scripts/screenshots.mjs
 */
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'images');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
page.on('dialog', d => d.accept());
await page.goto('file://' + join(root, 'dist', 'SpectralPanelDesigner.html'));
await page.addStyleTag({ content: '.toast, .toasts, #toasts { display: none !important; }' });
await page.getByRole('button', { name: 'Load example' }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, 'panel.png') });

await page.click('.tab[data-tab=analysis]');
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, 'analysis.png') });

await page.click('.tab[data-tab=optimize]');
const card = page.locator('#tab-optimize .card', { hasText: 'Best fluors to add' });
await card.locator('input[type=text]').first().fill('CD86');
await card.getByRole('button', { name: 'Rank fluors' }).click();
await card.locator('.result-box tbody tr').first().waitFor({ timeout: 120000 });
await page.addStyleTag({ content: '.topbar { position: static !important; }' });
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: join(out, 'rank-add.png') });

await page.click('.tab[data-tab=library]');
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, 'library.png') });

await browser.close();
console.log('wrote docs/images/{panel,analysis,rank-add,library}.png');
