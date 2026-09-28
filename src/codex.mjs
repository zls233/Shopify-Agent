import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const REQUEST_TIMEOUT_MS = 30_000;

function redact(value) {
  let text = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (/(TOKEN|SECRET|PASSWORD|API_KEY)/i.test(key) && secret && secret.length >= 8) text = text.split(secret).join('[REDACTED]');
  }
  return text;
}

export async function runCodex({ bin = 'codex', cwd, prompt, schemaPath, outputPath, eventsPath, threadId, readOnly = false, env = process.env, signal }) {
  mkdirSync(dirname(outputPath), { recursive: true });
  mkdirSync(dirname(eventsPath), { recursive: true });
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const events = createWriteStream(eventsPath, { flags: 'a', mode: 0o600 });
  const child = spawn(bin, ['app-server', '--listen', 'stdio://'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env, signal });
  const pending = new Map();
  let sequence = 0;
  let buffer = '';
  let stderr = '';
  let id = threadId || '';
  let finalText = '';
  let turnId = '';
  const completedTurns = new Map();
  let finishTurn;
  let failTurn;
  const completed = new Promise((resolve, reject) => { finishTurn = resolve; failTurn = reject; });
  // A turn can fail before its waiter is attached (for example, if the server exits on startup).
  completed.catch(() => {});
  const closed = new Promise(resolve => child.once('close', resolve));

  function settleTurn(turn) {
    if (turn.status !== 'completed') fail(new Error(`Codex turn ${turn.status}: ${redact(turn.error?.message || 'no details')}`));
    else finishTurn(turn);
  }

  function fail(error) {
    const failure = Object.assign(error, { threadId: id });
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
    failTurn(failure);
  }

  function send(message) {
    if (child.stdin.destroyed) throw new Error('Codex app-server input closed.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  child.stdin.on('error', fail);

  function request(method, params) {
    const requestId = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Codex app-server ${method} timed out.`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      try { send({ id: requestId, method, params }); }
      catch (error) { pending.get(requestId)?.reject(error); pending.delete(requestId); }
    });
  }

  function receive(line) {
    events.write(`${redact(line)}\n`);
    let message;
    try { message = JSON.parse(line); }
    catch { return; }
    if (message.id !== undefined && message.method) {
      fail(new Error(`Codex app-server requested unsupported interaction: ${message.method}.`));
      child.kill();
      return;
    }
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`Codex app-server error: ${redact(message.error.message || JSON.stringify(message.error))}`));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === 'thread/started' && !id && message.params?.thread?.id) id = message.params.thread.id;
    if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage' && message.params.item.phase === 'final_answer') finalText = message.params.item.text;
    if (message.method === 'turn/completed' && message.params?.threadId === id && message.params.turn?.id) {
      const turn = message.params.turn;
      if (turnId === turn.id) settleTurn(turn);
      else if (!turnId) completedTurns.set(turn.id, turn);
    }
  }

  child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) receive(line);
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
  child.on('error', fail);
  child.on('close', code => {
    if (buffer.trim()) receive(buffer);
    fail(new Error(`Codex app-server exited (${code}): ${redact(stderr).slice(-1200)}`));
  });

  try {
    await request('initialize', { clientInfo: { name: 'shopify-agent', title: 'Shopify Agent', version: '1.0.0' }, capabilities: null });
    send({ method: 'initialized' });
    const options = { cwd, approvalPolicy: 'never', sandbox: readOnly ? 'read-only' : 'workspace-write' };
    const session = await request(threadId ? 'thread/resume' : 'thread/start', threadId ? { ...options, threadId } : options);
    id = session.thread.id;
    const started = await request('turn/start', {
      threadId: id,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      sandboxPolicy: readOnly
        ? { type: 'readOnly', networkAccess: true }
        : { type: 'workspaceWrite', writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      outputSchema: schema,
    });
    turnId = started.turn.id;
    if (completedTurns.has(turnId)) settleTurn(completedTurns.get(turnId));
    const turn = await completed;
    const answer = turn.items.findLast(item => item.type === 'agentMessage' && item.phase === 'final_answer')?.text || finalText;
    if (!answer) throw new Error('Codex app-server completed without a structured final answer.');
    let result;
    try { result = JSON.parse(answer); }
    catch { throw new Error('Codex app-server did not return a valid JSON result.'); }
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    return { threadId: id, result };
  } catch (error) {
    throw Object.assign(error, { threadId: id });
  } finally {
    child.stdin.end();
    const termination = setTimeout(() => child.kill(), 2_000);
    await closed;
    clearTimeout(termination);
    await new Promise(resolve => events.end(resolve));
  }
}
