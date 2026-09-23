import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
export function inside(root, path) {
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes project: ${path}`);
  if (existsSync(target)) {
    const actual = realpathSync(target);
    const realRoot = realpathSync(root);
    const actualRel = relative(realRoot, actual);
    if (actualRel === '..' || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) throw new Error(`Symlink escapes project: ${path}`);
  }
  return target;
}
export function sourceUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Source URL must be an HTTP(S) URL without embedded credentials.');
  url.hash = '';
  return url.toString();
}
export function storeDomain(value) {
  const store = String(value || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store)) throw new Error('Use the exact <store>.myshopify.com domain.');
  return store;
}
export function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
