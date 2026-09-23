import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { inside, readJson } from './util.mjs';
import { command, hasCollection, listThemes, readStore } from './shopify.mjs';

function requireFile(root, path) {
  const full = inside(root, path);
  if (!existsSync(full) || !statSync(full).isFile() || statSync(full).size === 0) throw new Error(`Required artifact missing or empty: ${path}`);
  return full;
}

function csvRows(path) {
  const text = readFileSync(path, 'utf8');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (quoted) throw new Error('CSV contains an unclosed quote.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function inspectCsv(root, path) {
  const rows = csvRows(requireFile(root, path));
  const headers = rows.shift() || [];
  for (const name of ['Handle', 'Title', 'Variant Price']) if (!headers.includes(name)) throw new Error(`CSV missing ${name}.`);
  const handleColumn = headers.indexOf('Handle');
  const handles = new Set(rows.map(row => row[handleColumn]).filter(Boolean));
  if (!handles.size) throw new Error('CSV has no product handles.');
  return { rowCount: rows.length, productCount: handles.size };
}

function referenceCheck(project, source) {
  const manifest = readJson(requireFile(project, 'manifest.json'));
  const expectedHost = new URL(source).hostname;
  if (new URL(manifest.site).hostname !== expectedHost) throw new Error('Reference manifest targets another source website.');
  const pages = manifest.pages || [];
  const captured = pages.filter(page => page.archiveStatus === 'success' && page.desktopScreenshot && page.mobileScreenshot && page.archive);
  if (captured.length < 3 || new Set(captured.map(page => page.type)).size < 2) throw new Error('Reference capture needs at least three complete pages from two page types.');
  for (const type of ['home', 'product', 'collection']) {
    if (!captured.some(page => page.type.toLowerCase().includes(type))) throw new Error(`Reference capture has no complete ${type} page.`);
  }
  for (const page of captured) {
    for (const path of [page.archive, page.desktopScreenshot, page.mobileScreenshot]) requireFile(project, path);
  }
  requireFile(project, 'site-reference-summary.md');
}

function visualCheck(project, result) {
  const screenshots = result.artifacts.filter(path => /\.(png|jpe?g|webp)$/i.test(path));
  if (screenshots.length < 2) throw new Error('Visual step requires desktop and mobile screenshots.');
  screenshots.forEach(path => requireFile(project, path));
}

function auditCheck(project, path, expectedStore, fields) {
  const audit = readJson(requireFile(project, path));
  if (audit.store !== expectedStore) throw new Error(`Audit store mismatch: ${path}`);
  for (const field of fields) if (audit[field] !== true) throw new Error(`Audit check ${field} failed in ${path}`);
  if ((audit.blockingIssues || []).length || (audit.mismatches || []).length) throw new Error(`Audit still has blockers: ${path}`);
  return audit;
}

export async function verifyStep(step, result, context, deps = {}) {
  const { projectDir, sourceUrl, store, facts, config } = context;
  if (result.status !== 'completed' || result.blockers.length) throw new Error(`Step blocked: ${result.blockers.join('; ') || result.summary}`);
  if (!result.artifacts.length) throw new Error('Codex returned no inspectable artifacts.');
  result.artifacts.forEach(path => requireFile(projectDir, path));
  const shopifyBin = deps.shopifyBin || 'shopify';
  const run = deps.command || command;
  const read = deps.readStore || readStore;
  const themes = deps.listThemes || listThemes;
  if (step.kind === 'project') {
    requireFile(projectDir, 'package.json');
    requireFile(projectDir, 'theme/layout/theme.liquid');
    await run('npm', ['run', 'check'], { cwd: projectDir });
    await run(shopifyBin, ['theme', 'check', '--path', 'theme'], { cwd: projectDir });
  }
  if (step.kind === 'authorization') {
    const remote = await read(store, { bin: shopifyBin, cwd: projectDir });
    if (remote.appClientId !== config.appClientId) throw new Error('Admin App identity changed since setup.');
  }
  if (step.kind === 'reference') referenceCheck(projectDir, sourceUrl);
  if (step.kind === 'catalog_extract') {
    inspectCsv(projectDir, result.facts.csvPath);
    if (result.artifacts.filter(path => path.endsWith('.json')).length < 2) throw new Error('Catalog extraction needs raw and normalized JSON artifacts.');
  }
  if (step.kind === 'catalog_clean') {
    inspectCsv(projectDir, result.facts.csvPath);
    if (result.facts.csvPath === facts.csvPath) throw new Error('Cleaned CSV must use a new path; do not overwrite the extracted CSV.');
  }
  if (step.kind === 'catalog_import') {
    const csv = inspectCsv(projectDir, facts.csvPath);
    const remote = await read(store, { bin: shopifyBin, cwd: projectDir });
    if (remote.productCount < csv.productCount) throw new Error(`Remote products ${remote.productCount} below CSV handles ${csv.productCount}.`);
    auditCheck(projectDir, 'agent-evidence/catalog_import.json', store, ['verified']);
  }
  if (step.kind === 'collections' && !(await (deps.hasCollection || hasCollection)(store, { bin: shopifyBin, cwd: projectDir }))) throw new Error('No Shopify collection was found after the collection step.');
  if (step.kind === 'theme') {
    const id = result.facts.draftThemeId;
    if (!id) throw new Error('Theme step returned no Draft Theme ID.');
    const available = await themes(store, { bin: shopifyBin, cwd: projectDir });
    if (!available.some(theme => theme.id === id && theme.role === 'unpublished')) throw new Error('Draft Theme is not an unpublished theme in the bound store.');
    await run(shopifyBin, ['theme', 'check', '--path', 'theme'], { cwd: projectDir });
  }
  if (step.kind === 'visual') visualCheck(projectDir, result);
  if (step.kind === 'discount') {
    const audit = auditCheck(projectDir, 'agent-evidence/discount.json', store, ['allVariantsChecked', 'pricesVerified']);
    if (!Number.isInteger(audit.totalVariants) || audit.totalVariants < 1 || audit.checkedVariants !== audit.totalVariants) throw new Error('Discount audit does not cover all variants.');
  }
  if (step.kind === 'qa') {
    if (result.facts.blockingIssues.length) throw new Error(`QA blockers: ${result.facts.blockingIssues.join('; ')}`);
    auditCheck(projectDir, 'agent-evidence/qa.json', store, ['desktop', 'mobile', 'cart', 'checkout', 'routes', 'prices', 'publications', 'visual', 'themeCheck']);
    await run('npm', ['run', 'check'], { cwd: projectDir });
    await run(shopifyBin, ['theme', 'check', '--path', 'theme'], { cwd: projectDir });
  }
  if (step.kind === 'launch_preflight') {
    const audit = auditCheck(projectDir, 'agent-evidence/launch_preflight.json', store, ['productsPublished', 'pricesVerified', 'themeSynced']);
    if (audit.unpublishedCount !== 0 || String(audit.draftThemeId) !== facts.draftThemeId) throw new Error('Launch preflight publication or theme check failed.');
    const remote = await read(store, { bin: shopifyBin, cwd: projectDir });
    if (remote.appClientId !== config.appClientId) throw new Error('Admin App identity changed before launch.');
  }
  if (step.kind === 'open_store') {
    const remote = await read(store, { bin: shopifyBin, cwd: projectDir });
    if (remote.passwordProtected) throw new Error('Store remains password protected.');
  }
  return result.artifacts.map(path => relative(projectDir, inside(projectDir, path)));
}
