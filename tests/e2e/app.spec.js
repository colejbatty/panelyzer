// End-to-end tests against the built single file (dist/Panelyzer.html).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');
const APP = 'file://' + path.join(ROOT, 'dist', 'Panelyzer.html');
const FIX = name => path.join(ROOT, 'tests', 'fixtures', name);

/** Opens the app, collecting page errors and any non-file network request. */
async function openApp(page) {
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push('network: ' + r.url()); });
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  await page.goto(APP);
  return problems;
}
const loadExample = page => page.getByRole('button', { name: 'Load example' }).first().click();
const tab = (page, id) => page.click(`.tab[data-tab=${id}]`);
const rows = page => page.locator('#panel-body tr');

test('loads offline with no errors and an empty panel', async ({ page }) => {
  const problems = await openApp(page);
  await expect(page.locator('#instrument')).toBeVisible();
  await expect(page.locator('#btn-save')).toBeVisible();
  expect(problems).toEqual([]);
});

test('example panel: every row resolves and analysis renders', async ({ page }) => {
  const problems = await openApp(page);
  await loadExample(page);
  await expect(rows(page)).toHaveCount(24);
  const unresolved = await page.$$eval('#panel-body .m-fluor', els => els.filter(e => e.classList.contains('bad') || e.getAttribute('aria-invalid') === 'true').length);
  expect(unresolved).toBe(0);
  await expect(page.locator('#panel-tiles .tile').first()).toBeVisible();
  await tab(page, 'analysis');
  await expect(page.locator('#tab-analysis canvas, #tab-analysis svg').first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('optimizers: suggest fluors, optimize assignment, rank fluors to add', async ({ page }) => {
  const problems = await openApp(page);
  await loadExample(page);
  await tab(page, 'optimize');
  const opt = page.locator('#tab-optimize');
  await opt.getByRole('button', { name: 'Suggest fluors' }).click();
  await expect(opt.locator('.card', { hasText: 'Suggest fluors' }).locator('.result-box')).toContainText(/complexity|CI/i, { timeout: 120_000 });
  await opt.getByRole('button', { name: 'Optimize assignment' }).click();
  await expect(opt.locator('.card', { hasText: 'Optimize assignment' }).locator('.result-box')).not.toBeEmpty({ timeout: 120_000 });

  const card = opt.locator('.card', { hasText: 'Best fluors to add' });
  await card.locator('input[type=text]').first().fill('CD86');
  await card.getByRole('button', { name: 'Rank fluors' }).click();
  const ranked = card.locator('.result-box tbody tr');
  await expect(ranked.first()).toBeVisible({ timeout: 120_000 });
  expect(await ranked.count()).toBeGreaterThan(5);
  await ranked.first().getByRole('button', { name: 'Add' }).click();
  await tab(page, 'panel');
  await expect(rows(page)).toHaveCount(25);
  await expect(rows(page).last().locator('.m-marker')).toHaveValue('CD86');
  expect(problems).toEqual([]);
});

test('imports a Cytek-style panel CSV, resolving vendor names and reporting unknowns', async ({ page }) => {
  const problems = await openApp(page);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#tab-panel .section-head button:text-is("Import panel…")')]);
  await fc.setFiles(FIX('cytek_style_panel.csv'));
  const dlg = page.locator('dialog[open]');
  await expect(dlg).toContainText('Imaginary Dye 999');
  await dlg.locator('.dlg-foot button:text-is("Import")').click();
  const fluors = await page.$$eval('#panel-body .m-fluor', e => e.map(x => x.value));
  expect(fluors).toEqual(expect.arrayContaining(['FITC', 'NovaFluor Blue 610/30S', 'MitoSpy Red CMXRos']));
  expect(problems).toEqual([]);
});

test('imports a Honeychrome experiment (.kit): references and autofluorescence', async ({ page }) => {
  const problems = await openApp(page);
  await loadExample(page);
  await tab(page, 'library');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#tab-library button:has-text("Import Honeychrome")')]);
  await fc.setFiles(FIX('synthetic_experiment.kit'));
  const dlg = page.locator('dialog[open]');
  await expect(dlg).toContainText('BV421');
  await expect(dlg).toContainText('Synthetic AF');
  await dlg.locator('.dlg-foot button:text-is("Import")').click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('#tab-library')).toContainText('BV421');
  expect(problems).toEqual([]);
});

test('save and reopen preserves the panel', async ({ page }, info) => {
  const problems = await openApp(page);
  await loadExample(page);
  const before = await page.$$eval('#panel-body tr', t => t.map(r => r.querySelector('.m-marker').value + '|' + r.querySelector('.m-fluor').value));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
  const file = info.outputPath('panel.panelyzer.json');
  await dl.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved.app).toBe('panelyzer');
  await page.click('#btn-new');
  await expect(rows(page)).toHaveCount(0);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btn-open')]);
  await fc.setFiles(file);
  await expect(rows(page)).toHaveCount(before.length);
  const after = await page.$$eval('#panel-body tr', t => t.map(r => r.querySelector('.m-marker').value + '|' + r.querySelector('.m-fluor').value));
  expect(after).toEqual(before);
  expect(problems).toEqual([]);
});

test('switching instrument to the ID7000 recomputes the panel', async ({ page }) => {
  const problems = await openApp(page);
  await loadExample(page);
  const ci = () => page.locator('#panel-tiles .tile').first().innerText();
  const aurora = await ci();
  await tab(page, 'instrument');
  const options = await page.$$eval('#instrument option', o => o.map(x => x.value));
  await page.selectOption('#instrument', options.find(v => v.startsWith('id7000')));
  await tab(page, 'panel');
  await expect.poll(ci).not.toBe(aurora);
  expect(problems).toEqual([]);
});

test('phone width: no horizontal page scroll', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const problems = await openApp(page);
  await loadExample(page);
  for (const id of ['panel', 'analysis', 'optimize', 'library', 'instrument']) {
    await tab(page, id);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `tab ${id}`).toBeLessThanOrEqual(1);
  }
  expect(problems).toEqual([]);
});
