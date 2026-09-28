import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodex } from '../src/codex.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'shopify-agent-app-server-'));
  const bin = join(root, 'codex-mock');
  const schemaPath = join(root, 'schema.json');
  writeFileSync(schemaPath, JSON.stringify({ type: 'object' }));
  writeFileSync(bin, `#!/usr/bin/env node
const readline = require('node:readline');
if (process.argv[2] !== 'app-server' || process.argv[3] !== '--listen' || process.argv[4] !== 'stdio://') process.exit(2);
const reply = message => process.stdout.write(JSON.stringify(message) + '\\n');
const result = { status: 'completed', summary: 'done', artifacts: [], blockers: [], facts: {} };
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') reply({ id: message.id, result: { serverInfo: {} } });
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    if (process.env.FAIL_TURN && message.method !== 'thread/resume') process.exit(4);
    reply({ id: message.id, result: { thread: { id: message.params.threadId || 'test-thread' } } });
  }
  if (message.method === 'turn/start') {
    if (!message.params.outputSchema || message.params.approvalPolicy !== 'never') process.exit(3);
    reply({ id: message.id, result: { turn: { id: 'test-turn' } } });
    const turn = { id: 'test-turn', status: process.env.FAIL_TURN ? 'failed' : 'completed', error: process.env.FAIL_TURN ? { message: 'model unavailable' } : null, items: [{ type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(result) }] };
    reply({ method: 'turn/completed', params: { threadId: message.params.threadId, turn } });
  }
});
`);
  chmodSync(bin, 0o755);
  return { root, bin, schemaPath, outputPath: join(root, 'result.json'), eventsPath: join(root, 'events.jsonl') };
}

test('app-server adapter starts a thread and persists its structured final answer', async () => {
  const f = fixture();
  try {
    const result = await runCodex({ bin: f.bin, cwd: f.root, prompt: 'test', schemaPath: f.schemaPath, outputPath: f.outputPath, eventsPath: f.eventsPath });
    assert.equal(result.threadId, 'test-thread');
    assert.equal(result.result.status, 'completed');
    assert.equal(JSON.parse(readFileSync(f.outputPath, 'utf8')).summary, 'done');
    assert.match(readFileSync(f.eventsPath, 'utf8'), /turn\/completed/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('app-server adapter resumes a saved thread and preserves it on failure', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      () => runCodex({ bin: f.bin, cwd: f.root, prompt: 'resume', schemaPath: f.schemaPath, outputPath: f.outputPath, eventsPath: f.eventsPath, threadId: 'old-thread', env: { ...process.env, FAIL_TURN: '1' } }),
      error => error.threadId === 'old-thread' && /model unavailable/.test(error.message),
    );
    assert.match(readFileSync(f.eventsPath, 'utf8'), /model unavailable/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
