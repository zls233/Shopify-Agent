import { spawn } from 'node:child_process';

function redact(text) {
  let safe = text;
  for (const [key, secret] of Object.entries(process.env)) {
    if (/(TOKEN|SECRET|PASSWORD|API_KEY)/i.test(key) && secret?.length >= 8) safe = safe.split(secret).join('[REDACTED]');
  }
  return safe;
}

export async function command(bin, args, { cwd, stdin = '' } = {}) {
  const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  child.stdin.end(stdin);
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', value => resolve(value ?? 1));
  });
  if (code !== 0) throw new Error(`${bin} ${args.slice(0, 2).join(' ')} failed (${code}): ${redact(stderr).slice(-800)}`);
  return stdout;
}

function findObject(value, predicate) {
  if (!value || typeof value !== 'object') return null;
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const match = findObject(child, predicate);
    if (match) return match;
  }
  return null;
}

export function parseThemes(output) {
  const parsed = JSON.parse(output);
  const themes = Array.isArray(parsed) ? parsed : parsed.themes || parsed.data?.themes;
  if (!Array.isArray(themes)) throw new Error('Shopify theme list returned an unknown JSON shape.');
  return themes.map(theme => ({ id: String(theme.id), role: String(theme.role).toLowerCase(), name: theme.name || '' }));
}

export async function listThemes(store, { bin = 'shopify', cwd } = {}) {
  if (!process.env.SHOPIFY_CLI_THEME_TOKEN) throw new Error('SHOPIFY_CLI_THEME_TOKEN is missing; Theme Access is required.');
  return parseThemes(await command(bin, ['theme', 'list', '--store', store, '--json'], { cwd }));
}

const REQUIRED_SCOPES = [
  'write_products', 'write_publications', 'write_online_store_navigation',
  'write_content', 'write_metaobjects', 'write_metaobject_definitions',
  'write_files', 'write_inventory', 'read_locations',
];
const STORE_QUERY = 'query AgentStoreCheck { shop { myshopifyDomain shopAddress { address1 city countryCodeV2 } } currentAppInstallation { app { apiKey title } accessScopes { handle } } productsCount { count } onlineStore { passwordProtection { enabled } } }';

export function parseStore(output, expectedStore) {
  const parsed = JSON.parse(output);
  const data = findObject(parsed, value => value.shop?.myshopifyDomain && value.currentAppInstallation);
  if (!data) throw new Error('Shopify store query returned no store or app identity.');
  const store = String(data.shop.myshopifyDomain).toLowerCase();
  if (store !== expectedStore) throw new Error(`Shopify store mismatch: expected ${expectedStore}, received ${store}.`);
  const scopes = (data.currentAppInstallation.accessScopes || []).map(item => item.handle);
  const missingScopes = REQUIRED_SCOPES.filter(scope => !scopes.includes(scope));
  if (!data.currentAppInstallation.app?.apiKey || missingScopes.length) throw new Error(`Admin app identity or scopes missing: ${missingScopes.join(', ')}`);
  const count = Number(data.productsCount?.count);
  if (!Number.isFinite(count)) throw new Error('Shopify did not return product count.');
  if (typeof data.onlineStore?.passwordProtection?.enabled !== 'boolean') throw new Error('Shopify did not return password protection state.');
  const address = data.shop.shopAddress;
  return { store, appClientId: data.currentAppInstallation.app.apiKey, productCount: count, passwordProtected: Boolean(data.onlineStore?.passwordProtection?.enabled), hasBusinessAddress: Boolean(address?.address1 && address?.city && address?.countryCodeV2) };
}

export async function readStore(store, { bin = 'shopify', cwd } = {}) {
  const output = await command(bin, ['store', 'execute', '--store', store, '--version', process.env.SHOPIFY_API_VERSION || '2026-07', '--query', STORE_QUERY, '--json'], { cwd });
  return parseStore(output, store);
}

export async function hasCollection(store, { bin = 'shopify', cwd } = {}) {
  const query = 'query AgentCollectionCheck { shop { myshopifyDomain } collections(first: 1) { nodes { id handle } } }';
  const output = await command(bin, ['store', 'execute', '--store', store, '--query', query, '--json'], { cwd });
  const data = findObject(JSON.parse(output), value => value.shop?.myshopifyDomain && value.collections);
  if (!data || String(data.shop.myshopifyDomain).toLowerCase() !== store) throw new Error('Collection query store mismatch.');
  return Array.isArray(data.collections.nodes) && data.collections.nodes.length > 0;
}

export async function publishTheme(store, themeId, themePath, { bin = 'shopify', cwd } = {}) {
  await command(bin, ['theme', 'publish', '--store', store, '--path', themePath, '--theme', String(themeId), '--force'], { cwd });
  const themes = await listThemes(store, { bin, cwd });
  if (!themes.some(theme => theme.id === String(themeId) && theme.role === 'live')) throw new Error('Theme publish returned but the target is not live.');
  return themes;
}

export async function publicProbe(store, paths = ['/'], fetcher = fetch) {
  const tested = [];
  const queue = [...new Set(['/', '/cart', ...paths])];
  for (let index = 0; index < queue.length && index < 12; index += 1) {
    const path = queue[index];
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`Invalid public path: ${path}`);
    const response = await fetcher(`https://${store}${path}`, { redirect: 'follow', headers: { 'User-Agent': 'ShopifyAgentPublicQA/1.0' } });
    const html = await response.text();
    if (!response.ok || /\/password(?:[/?#]|$)/i.test(response.url) || /<form[^>]+(?:password|storefront_password)/i.test(html)) {
      throw new Error(`Public storefront check failed for ${path}: HTTP ${response.status}, final URL ${response.url}`);
    }
    tested.push(path);
    if (path === '/') {
      const links = [...html.matchAll(/href=["'](\/\b(?:products|collections)\/[^"'#?]+)["']/gi)].map(match => match[1]);
      for (const link of links) if (!queue.includes(link) && queue.length < 12) queue.push(link);
    }
  }
  for (const type of ['products', 'collections']) {
    if (!tested.some(path => path.startsWith(`/${type}/`))) throw new Error(`Public storefront check found no ${type} route to verify.`);
  }
  return tested;
}
