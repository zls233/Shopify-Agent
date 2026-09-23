import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FACT_FIELDS, STEPS } from '../src/steps.mjs';

function fixture(adoptExisting = false) {
  const root = mkdtempSync(join(tmpdir(), 'shopify-agent-theme-'));
  const project = join(root, 'project');
  const prompts = join(root, 'prompts');
  const template = join(root, 'template');
  const privateDir = join(root, 'private');
  mkdirSync(prompts);
  mkdirSync(template);
  writeFileSync(join(prompts, 'README.md'), '# Prompts\n');
  for (const step of STEPS.filter(item => item.prompt)) {
    const path = join(prompts, step.prompt);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `# ${step.id}\nCapture {{TARGET_SITE_URL}}.\n`);
  }
  writeFileSync(join(template, 'AGENTS.md'), '# Template\n');
  writeFileSync(join(template, '.gitignore'), '.env.local\n');
  writeFileSync(join(template, 'package.json'), '{}\n');
  mkdirSync(join(template, 'theme/layout'), { recursive: true });
  mkdirSync(join(template, 'theme/templates'), { recursive: true });
  writeFileSync(join(template, 'theme/layout/theme.liquid'), '<html>{{ content_for_layout }}</html>\n');
  writeFileSync(join(template, 'theme/templates/index.json'), '{}\n');
  if (adoptExisting) {
    mkdirSync(join(project, 'theme/layout'), { recursive: true });
    mkdirSync(join(project, 'theme/templates'), { recursive: true });
    writeFileSync(join(project, 'theme/layout/theme.liquid'), '<html>existing theme</html>\n');
    writeFileSync(join(project, 'theme/templates/index.json'), '{}\n');
    writeFileSync(join(project, 'site-reference-summary.md'), 'Source: https://example.com/\n');
  }
  return { root, project, prompts, template, privateDir };
}

function captureReference(project) {
  mkdirSync(join(project, 'references'), { recursive: true });
  const pages = ['home', 'product', 'collection'].map(type => {
    for (const file of [`${type}.html`, `${type}-desktop.png`, `${type}-mobile.png`]) writeFileSync(join(project, 'references', file), 'artifact\n');
    return { type, archiveStatus: 'success', archive: `references/${type}.html`, desktopScreenshot: `references/${type}-desktop.png`, mobileScreenshot: `references/${type}-mobile.png` };
  });
  writeFileSync(join(project, 'manifest.json'), JSON.stringify({ site: 'https://example.com/', pages }));
  writeFileSync(join(project, 'site-reference-summary.md'), 'Source: https://example.com/\n');
}

async function runnerFixture(f) {
  process.env.SHOPIFY_AGENT_HOME = f.privateDir;
  return import(`../src/runner.mjs?theme=${Date.now()}-${Math.random()}`);
}

test('theme-only runs prompts in order without store access and records provenance', async () => {
  const f = fixture();
  const previousToken = process.env.SHOPIFY_CLI_THEME_TOKEN;
  process.env.SHOPIFY_CLI_THEME_TOKEN = 'test-secret-value';
  try {
    const runner = await runnerFixture(f);
    const calls = [], checks = [];
    const deps = {
      readStore: () => { throw new Error('remote store was accessed'); },
      listThemes: () => { throw new Error('remote themes were accessed'); },
      publishTheme: () => { throw new Error('a theme was published'); },
      command: async (bin, args) => { checks.push(`${bin} ${args.join(' ')}`); },
      runCodex: async ({ prompt, cwd, outputPath, eventsPath, env }) => {
        const id = /STEP ([a-z_]+)/.exec(prompt)?.[1];
        calls.push(id);
        assert.equal(cwd, f.project);
        assert.equal(env.SHOPIFY_CLI_THEME_TOKEN, undefined);
        mkdirSync(join(cwd, 'agent-evidence'), { recursive: true });
        if (id === 'reference') captureReference(cwd);
        if (id === 'local_qa') writeFileSync(join(cwd, 'agent-evidence/local_qa.md'), 'Static checks passed. 待验证: Shopify preview and checkout.\n');
        else writeFileSync(join(cwd, `agent-evidence/${id}.md`), `${id} evidence\n`);
        const result = { status: 'completed', summary: id, artifacts: [`agent-evidence/${id}.md`], blockers: [], facts: structuredClone(FACT_FIELDS) };
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, JSON.stringify(result));
        writeFileSync(eventsPath, '{"type":"turn.completed"}\n');
        return { threadId: `thread-${id}`, result };
      },
    };
    const setupResult = await runner.setup({ mode: 'theme-only', project: f.project, prompts: f.prompts, template: f.template }, deps);
    assert.equal(setupResult.store, undefined);
    assert.deepEqual(runner.plan().steps.map(step => step.id), ['reference', 'theme_local', 'local_qa']);
    const result = await runner.run('https://example.com/', deps);
    assert.equal(result.status, 'completed_local');
    assert.deepEqual(calls, ['reference', 'theme_local', 'local_qa']);
    assert.ok(checks.some(item => item.includes('shopify theme check --path theme')));
    const verbose = runner.status({ verbose: true });
    assert.equal(verbose.mode, 'theme-only');
    assert.equal(verbose.steps[1].threadId, 'thread-theme_local');
    assert.equal(verbose.steps[1].promptPath, 'prompts/theme-only/theme.md');
    assert.match(verbose.steps[1].promptHash, /^[a-f0-9]{64}$/);
    assert.ok(existsSync(verbose.steps[1].resultPath));
    await runner.run('https://example.com/', deps);
    assert.equal(calls.length, 3);
  } finally {
    if (previousToken === undefined) delete process.env.SHOPIFY_CLI_THEME_TOKEN;
    else process.env.SHOPIFY_CLI_THEME_TOKEN = previousToken;
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('adopted theme can start at local QA while earlier prompts remain external', async () => {
  const f = fixture(true);
  try {
    const runner = await runnerFixture(f);
    const original = readFileSync(join(f.project, 'theme/layout/theme.liquid'), 'utf8');
    const calls = [];
    const deps = {
      command: async () => {},
      runCodex: async ({ prompt, cwd }) => {
        calls.push(/STEP ([a-z_]+)/.exec(prompt)?.[1]);
        mkdirSync(join(cwd, 'agent-evidence'), { recursive: true });
        writeFileSync(join(cwd, 'agent-evidence/local_qa.md'), '待验证: storefront preview, product data and checkout.\n');
        return { threadId: 'thread-local-qa', result: { status: 'completed', summary: 'local QA', artifacts: ['agent-evidence/local_qa.md'], blockers: [], facts: structuredClone(FACT_FIELDS) } };
      },
    };
    await runner.setup({ mode: 'theme-only', project: f.project, prompts: f.prompts, template: f.template, adoptExisting: true }, deps);
    const result = await runner.run('https://example.com/', deps, { from: 'local_qa' });
    assert.equal(result.status, 'completed_local');
    assert.deepEqual(calls, ['local_qa']);
    assert.equal(result.steps.reference.status, 'external');
    assert.equal(result.steps.theme_local.status, 'external');
    assert.equal(readFileSync(join(f.project, 'theme/layout/theme.liquid'), 'utf8'), original);
    await assert.rejects(runner.run('https://example.com/', deps, { from: 'reference' }), /already settled/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('starting at theme implementation rejects missing external reference screenshots', async () => {
  const f = fixture(true);
  try {
    const runner = await runnerFixture(f);
    await runner.setup({ mode: 'theme-only', project: f.project, prompts: f.prompts, template: f.template, adoptExisting: true });
    await assert.rejects(() => runner.run('https://example.com/', {}, { from: 'theme_local' }), /product and collection pages/);
    assert.equal(runner.loadState(), null);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('adopted theme can start at implementation with documented source screenshots', async () => {
  const f = fixture(true);
  try {
    mkdirSync(join(f.project, 'screenshots'));
    writeFileSync(join(f.project, 'screenshots/home-desktop.png'), 'desktop image');
    writeFileSync(join(f.project, 'screenshots/home-mobile.png'), 'mobile image');
    writeFileSync(join(f.project, 'site-reference-summary.md'), 'Source: https://example.com/\nProduct route: /products/one\nCollection route: /collections/all\nDesktop: [capture](screenshots/home-desktop.png)\nMobile: [capture](screenshots/home-mobile.png)\n');
    const runner = await runnerFixture(f);
    const calls = [];
    const deps = {
      command: async () => {},
      runCodex: async ({ prompt, cwd }) => {
        const id = /STEP ([a-z_]+)/.exec(prompt)?.[1];
        calls.push(id);
        mkdirSync(join(cwd, 'agent-evidence'), { recursive: true });
        writeFileSync(join(cwd, `agent-evidence/${id}.md`), id === 'local_qa' ? '待验证: real storefront preview.\n' : 'Theme implementation evidence.\n');
        return { threadId: `thread-${id}`, result: { status: 'completed', summary: id, artifacts: [`agent-evidence/${id}.md`], blockers: [], facts: structuredClone(FACT_FIELDS) } };
      },
    };
    await runner.setup({ mode: 'theme-only', project: f.project, prompts: f.prompts, template: f.template, adoptExisting: true });
    const result = await runner.run('https://example.com/', deps, { from: 'theme_local' });
    assert.equal(result.status, 'completed_local');
    assert.equal(result.steps.reference.status, 'external');
    assert.deepEqual(calls, ['theme_local', 'local_qa']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('theme-only resumes a blocked step without rerunning reference capture', async () => {
  const f = fixture();
  try {
    const runner = await runnerFixture(f);
    const calls = [];
    let blocked = true;
    const deps = {
      command: async () => {},
      runCodex: async ({ prompt, cwd }) => {
        const id = /STEP ([a-z_]+)/.exec(prompt)?.[1];
        calls.push(id);
        const facts = structuredClone(FACT_FIELDS);
        if (id === 'theme_local' && blocked) {
          blocked = false;
          return { threadId: 'retry-theme', result: { status: 'blocked', summary: 'Source 429', artifacts: [], blockers: ['Source 429'], facts } };
        }
        mkdirSync(join(cwd, 'agent-evidence'), { recursive: true });
        if (id === 'reference') captureReference(cwd);
        writeFileSync(join(cwd, `agent-evidence/${id}.md`), id === 'local_qa' ? '待验证: storefront preview.\n' : `${id} evidence\n`);
        return { threadId: `thread-${id}`, result: { status: 'completed', summary: id, artifacts: [`agent-evidence/${id}.md`], blockers: [], facts } };
      },
    };
    await runner.setup({ mode: 'theme-only', project: f.project, prompts: f.prompts, template: f.template }, deps);
    await assert.rejects(() => runner.run('https://example.com/', deps), /theme_local paused/);
    assert.equal(runner.status().steps.find(step => step.id === 'reference').status, 'completed');
    const done = await runner.resume(deps);
    assert.equal(done.status, 'completed_local');
    assert.deepEqual(calls, ['reference', 'theme_local', 'theme_local', 'local_qa']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('full-store cannot start in the middle without prior verified state', async () => {
  const f = fixture();
  try {
    const runner = await runnerFixture(f);
    const deps = {
      readStore: async () => ({ store: 'test.myshopify.com', appClientId: 'app-id', productCount: 0, hasBusinessAddress: true, passwordProtected: true }),
      listThemes: async () => [{ id: 'live-1', role: 'live' }],
      runCodex: async () => ({ threadId: 'setup-thread', result: { status: 'completed', summary: 'browser ready', artifacts: [], blockers: [], facts: structuredClone(FACT_FIELDS) } }),
    };
    await runner.setup({ store: 'test.myshopify.com', project: f.project, prompts: f.prompts, template: f.template }, deps);
    await assert.rejects(() => runner.run('https://example.com/', deps, { from: 'theme' }), /prior verified state/);
    assert.equal(runner.loadState(), null);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('CLI invokes Codex for a selected local step and persists the result', () => {
  const f = fixture(true);
  try {
    const codexBin = join(f.root, 'fake-codex.mjs');
    const shopifyBin = join(f.root, 'fake-shopify.sh');
    writeFileSync(codexBin, `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const output = args[args.indexOf('-o') + 1];
const prompt = readFileSync(0, 'utf8');
if (!prompt.includes('STEP local_qa')) process.exit(2);
mkdirSync(join(process.cwd(), 'agent-evidence'), { recursive: true });
writeFileSync(join(process.cwd(), 'agent-evidence/local_qa.md'), 'Static checks passed. Pending Shopify preview and checkout.\\n');
const facts = { sourceBrand: '', draftThemeId: '', csvPath: '', contentPaths: [], needsHomeFix: false, needsProductFix: false, needsFooterFix: false, needsStickyHeader: false, blockingIssues: [], publicPaths: [] };
writeFileSync(output, JSON.stringify({ status: 'completed', summary: 'local QA', artifacts: ['agent-evidence/local_qa.md'], blockers: [], facts }));
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'cli-smoke-thread' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');
`);
    writeFileSync(shopifyBin, '#!/bin/sh\nexit 0\n');
    chmodSync(codexBin, 0o755);
    chmodSync(shopifyBin, 0o755);
    const env = { ...process.env, SHOPIFY_AGENT_HOME: f.privateDir, SHOPIFY_AGENT_CODEX_BIN: codexBin, SHOPIFY_AGENT_SHOPIFY_BIN: shopifyBin };
    const cli = join(process.cwd(), 'cli.mjs');
    const setupResult = spawnSync(process.execPath, [cli, 'setup', '--mode', 'theme-only', '--project', f.project, '--prompts', f.prompts, '--template', f.template, '--adopt-existing'], { cwd: process.cwd(), env, encoding: 'utf8' });
    assert.equal(setupResult.status, 0, setupResult.stderr);
    const runResult = spawnSync(process.execPath, [cli, 'run', '--from', 'local_qa', 'https://example.com/'], { cwd: process.cwd(), env, encoding: 'utf8' });
    assert.equal(runResult.status, 0, runResult.stderr);
    const state = JSON.parse(readFileSync(join(f.privateDir, 'state.json'), 'utf8'));
    assert.equal(state.status, 'completed_local');
    assert.equal(state.steps.local_qa.threadId, 'cli-smoke-thread');
    assert.equal(state.steps.reference.status, 'external');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
