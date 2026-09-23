import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

function redact(value) {
  let text = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (/(TOKEN|SECRET|PASSWORD|API_KEY)/i.test(key) && secret && secret.length >= 8) text = text.split(secret).join('[REDACTED]');
  }
  return text;
}

export async function runCodex({ bin = 'codex', cwd, prompt, schemaPath, outputPath, eventsPath, threadId, readOnly = false }) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const args = threadId
    ? ['exec', 'resume', '-c', 'approval_policy="never"', '-c', 'sandbox_workspace_write.network_access=true', '--json', '--output-schema', schemaPath, '-o', outputPath, threadId, '-']
    : ['exec', '-c', 'approval_policy="never"', '-c', 'sandbox_workspace_write.network_access=true', '--json', '--output-schema', schemaPath, '-o', outputPath, '--sandbox', readOnly ? 'read-only' : 'workspace-write', '-'];
  const events = createWriteStream(eventsPath, { flags: 'a', mode: 0o600 });
  let id = threadId || '';
  let turnComplete = false;
  let streamBuffer = '';
  let stderr = '';
  const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  child.stdin.end(prompt);
  child.stdout.on('data', chunk => {
    streamBuffer += chunk.toString('utf8');
    const lines = streamBuffer.split('\n');
    streamBuffer = lines.pop();
    for (const line of lines) {
      events.write(`${redact(line)}\n`);
      try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started' && event.thread_id) id = event.thread_id;
        if (event.type === 'turn.completed') turnComplete = true;
      } catch { /* retained in local event log */ }
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
  if (streamBuffer) events.write(`${redact(streamBuffer)}\n`);
  await new Promise(resolve => events.end(resolve));
  if (exitCode !== 0 || !turnComplete) throw Object.assign(new Error(`Codex turn failed (exit ${exitCode}): ${redact(stderr).slice(-1200)}`), { threadId: id });
  let result;
  try { result = JSON.parse(readFileSync(outputPath, 'utf8')); }
  catch { throw Object.assign(new Error('Codex did not write a valid structured result.'), { threadId: id }); }
  return { threadId: id, result };
}
