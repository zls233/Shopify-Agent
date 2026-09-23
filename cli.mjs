#!/usr/bin/env node
import { run, resume, setup, status } from './src/runner.mjs';

function options(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--store', '--project', '--prompts', '--template'].includes(key) || !argv[index + 1]) throw new Error(`Unknown or incomplete option: ${key}`);
    parsed[key.slice(2)] = argv[++index];
  }
  return parsed;
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'setup') console.log(JSON.stringify(await setup(options(args)), null, 2));
  else if (action === 'run') {
    if (args.length !== 1) throw new Error('Usage: npm run run -- https://source.example');
    const result = await run(args[0]);
    console.log(JSON.stringify({ status: result.status, store: result.store, sourceUrl: result.sourceUrl }, null, 2));
  } else if (action === 'resume') {
    const result = await resume();
    console.log(JSON.stringify({ status: result.status, store: result.store, sourceUrl: result.sourceUrl }, null, 2));
  } else if (action === 'status') console.log(JSON.stringify(status(), null, 2));
  else console.log('Usage:\n  npm run setup -- --store <store>.myshopify.com [--project DIR] [--prompts DIR] [--template DIR]\n  npm run run -- https://source.example\n  npm run resume\n  npm run status');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
