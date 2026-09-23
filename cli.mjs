#!/usr/bin/env node
import { plan, run, resume, setup, status } from './src/runner.mjs';

function setupOptions(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--adopt-existing') { parsed.adoptExisting = true; continue; }
    if (!['--mode', '--store', '--project', '--prompts', '--template'].includes(key) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${key}`);
    parsed[key.slice(2)] = argv[++index];
  }
  return parsed;
}

function runOptions(argv) {
  const parsed = { url: null, from: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--from' && argv[index + 1] && !argv[index + 1].startsWith('--')) parsed.from = argv[++index];
    else if (!argv[index].startsWith('--') && !parsed.url) parsed.url = argv[index];
    else throw new Error(`Unknown or incomplete run argument: ${argv[index]}`);
  }
  if (!parsed.url) throw new Error('Usage: npm run run -- [--from STEP] https://source.example');
  return parsed;
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'setup') console.log(JSON.stringify(await setup(setupOptions(args)), null, 2));
  else if (action === 'run') {
    const input = runOptions(args);
    const result = await run(input.url, {}, { from: input.from });
    console.log(JSON.stringify({ status: result.status, mode: result.mode || 'full-store', store: result.store, sourceUrl: result.sourceUrl }, null, 2));
  } else if (action === 'resume') {
    const result = await resume();
    console.log(JSON.stringify({ status: result.status, mode: result.mode || 'full-store', store: result.store, sourceUrl: result.sourceUrl }, null, 2));
  } else if (action === 'status') {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--verbose')) throw new Error('Usage: npm run status -- [--verbose]');
    console.log(JSON.stringify(status({ verbose: args[0] === '--verbose' }), null, 2));
  } else if (action === 'plan') {
    if (args.length) throw new Error('Usage: npm run plan');
    console.log(JSON.stringify(plan(), null, 2));
  } else console.log('Usage:\n  npm run setup -- --mode theme-only --project DIR [--adopt-existing]\n  npm run setup -- --store <store>.myshopify.com [--project DIR] [--prompts DIR] [--template DIR]\n  npm run plan\n  npm run run -- [--from STEP] https://source.example\n  npm run resume\n  npm run status -- [--verbose]');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
