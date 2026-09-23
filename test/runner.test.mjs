import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FACT_FIELDS, STEPS } from '../src/steps.mjs';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'shopify-agent-flow-'));
  const prompts = join(root, 'prompts');
  const template = join(root, 'template');
  const project = join(root, 'project');
  mkdirSync(prompts); mkdirSync(template);
  writeFileSync(join(prompts, 'README.md'), '# Prompts\n');
  for (const step of STEPS.filter(item => item.prompt)) {
    const file = join(prompts, step.prompt);
    mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    writeFileSync(file, `# ${step.id}\n`);
  }
  mkdirSync(join(template, 'theme/layout'), { recursive: true });
  writeFileSync(join(template, 'AGENTS.md'), '# Agent\n');
  writeFileSync(join(template, '.gitignore'), '.env.local\n');
  writeFileSync(join(template, 'package.json'), '{"name":"fixture"}\n');
  writeFileSync(join(template, 'theme/layout/theme.liquid'), '<html></html>\n');
  process.env.SHOPIFY_AGENT_HOME = join(root, 'private');
  const runner = await import(`../src/runner.mjs?fixture=${Date.now()}-${Math.random()}`);
  let liveId = '1', draftExists = false, protectedStore = false, failAt = '', failOnce = false, qaFails = false, publicFails = false;
  const called = [], published = [];
  const deps = {
    readStore: async () => ({ store: 'test.myshopify.com', appClientId: 'app-id', productCount: 0, hasBusinessAddress: true, passwordProtected: protectedStore }),
    listThemes: async () => [{ id: liveId, role: 'live' }, ...(draftExists && liveId !== '2' ? [{ id: '2', role: 'unpublished' }] : liveId === '2' ? [{ id: '1', role: 'unpublished' }] : [])],
    runCodex: async ({ prompt }) => {
      const match = /STEP ([a-z_]+)/.exec(prompt);
      const id = match?.[1] || 'setup-or-repair';
      called.push(id);
      const facts = structuredClone(FACT_FIELDS);
      if (id === 'reference') facts.sourceBrand = 'The Ordinary';
      if (id === 'catalog_extract' || id === 'catalog_clean') facts.csvPath = 'outputs/products.csv';
      if (id === 'theme') { facts.draftThemeId = '2'; draftExists = true; }
      if (id === 'qa' && qaFails) facts.blockingIssues = ['visual mismatch'];
      if (id === failAt && failOnce) { failOnce = false; return { threadId: `thread-${id}`, result: { status: 'blocked', summary: 'scope missing', blockers: ['scope missing'], artifacts: [], facts } }; }
      return { threadId: `thread-${id}`, result: { status: 'completed', summary: id, blockers: [], artifacts: ['agent-evidence/report.md'], facts } };
    },
    verifyStep: async (_step, result) => {
      if (result.status !== 'completed') throw new Error(result.blockers.join('; '));
      if (result.facts.blockingIssues.length) throw new Error(`QA blockers: ${result.facts.blockingIssues.join('; ')}`);
    },
    publishTheme: async (_store, id) => { published.push(id); liveId = id; return []; },
    publicProbe: async () => {
      if (publicFails) throw new Error('Public product path failed.');
      return ['/', '/cart', '/products/one', '/collections/all'];
    },
  };
  await runner.setup({ store: 'test.myshopify.com', project, prompts, template }, deps);
  return { root, runner, deps, called, published, setFail: id => { failAt = id; failOnce = true; }, setQaFails: value => { qaFails = value; }, setPublicFails: value => { publicFails = value; } };
}

test('runs every required step, skips optional steps and avoids repeating a complete run', async () => {
  const f = await fixture();
  try {
    const first = await f.runner.run('https://theordinary.com/us', f.deps);
    assert.equal(first.status, 'completed');
    assert.deepEqual(f.published, ['2']);
    for (const id of ['content', 'home', 'product', 'footer', 'sticky']) assert.equal(first.steps[id].status, 'skipped');
    for (const id of ['discount', 'remove_features', 'cookie']) assert.equal(first.steps[id].status, 'completed');
    const calls = f.called.length;
    await f.runner.run('https://theordinary.com/us', f.deps);
    assert.equal(f.called.length, calls);
    await assert.rejects(() => f.runner.run('https://different.example', f.deps), /bound to/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('resumes a blocked import without replaying completed stages', async () => {
  const f = await fixture();
  try {
    f.setFail('catalog_import');
    await assert.rejects(() => f.runner.run('https://theordinary.com/us', f.deps), /catalog_import paused/);
    const referenceCalls = f.called.filter(id => id === 'reference').length;
    const result = await f.runner.resume(f.deps);
    assert.equal(result.status, 'completed');
    assert.equal(f.called.filter(id => id === 'reference').length, referenceCalls);
    assert.equal(f.called.filter(id => id === 'catalog_import').length, 2);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('unresolved QA blockers prevent theme publication', async () => {
  const f = await fixture();
  try {
    f.setQaFails(true);
    await assert.rejects(() => f.runner.run('https://theordinary.com/us', f.deps), /qa paused/);
    assert.deepEqual(f.published, []);
    assert.equal(f.runner.status().steps.find(item => item.id === 'qa').status, 'paused');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('failed public QA restores prior Live Theme and resumes without repeating import', async () => {
  const f = await fixture();
  try {
    f.setPublicFails(true);
    await assert.rejects(() => f.runner.run('https://theordinary.com/us', f.deps), /Public product path failed/);
    assert.deepEqual(f.published, ['2', '1']);
    assert.equal(f.runner.status().rollback.ok, true);
    const imports = f.called.filter(id => id === 'catalog_import').length;
    f.setPublicFails(false);
    const state = await f.runner.resume(f.deps);
    assert.equal(state.status, 'completed');
    assert.deepEqual(f.published, ['2', '1', '2']);
    assert.equal(f.called.filter(id => id === 'catalog_import').length, imports);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
