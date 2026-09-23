import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodex } from '../src/codex.mjs';

test('Codex adapter consumes JSONL, captures thread ID, and parses structured result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shopify-agent-codex-'));
  const bin = join(root, 'codex-mock');
  try {
    writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const output = args[args.indexOf('-o') + 1];
fs.writeFileSync(output, JSON.stringify({ status: 'completed', summary: 'done', artifacts: [], blockers: [], facts: {} }));
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'test-thread' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');
`);
    chmodSync(bin, 0o755);
    const outputPath = join(root, 'out.json');
    const eventsPath = join(root, 'events.jsonl');
    const result = await runCodex({ bin, cwd: root, prompt: 'test', schemaPath: join(root, 'schema.json'), outputPath, eventsPath });
    assert.equal(result.threadId, 'test-thread');
    assert.equal(result.result.status, 'completed');
    assert.match(readFileSync(eventsPath, 'utf8'), /turn.completed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
