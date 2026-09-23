import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectCsv } from '../src/verify.mjs';
import { parseStore, parseThemes, publicProbe } from '../src/shopify.mjs';

test('CSV validator handles multiline fields and counts unique product handles', () => {
  const root = mkdtempSync(join(tmpdir(), 'shopify-agent-csv-'));
  try {
    writeFileSync(join(root, 'products.csv'), 'Handle,Title,Variant Price\r\na,"Line one\nLine two",9.99\r\na,"Line one\nLine two",10.99\r\nb,Other,4.50\r\n');
    assert.deepEqual(inspectCsv(root, 'products.csv'), { rowCount: 3, productCount: 2 });
    assert.throws(() => inspectCsv(root, '../escape.csv'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Shopify readback requires exact store, scopes, product count and password state', () => {
  const payload = { data: { shop: { myshopifyDomain: 'test.myshopify.com', shopAddress: { address1: 'A', city: 'B', countryCodeV2: 'US' } },
    currentAppInstallation: { app: { apiKey: 'app-id' }, accessScopes: [
      'write_products', 'write_publications', 'write_online_store_navigation', 'write_content',
      'write_metaobjects', 'write_metaobject_definitions', 'write_files', 'write_inventory', 'read_locations',
    ].map(handle => ({ handle })) }, productsCount: { count: 0 }, onlineStore: { passwordProtection: { enabled: true } } } };
  assert.equal(parseStore(JSON.stringify(payload), 'test.myshopify.com').passwordProtected, true);
  assert.throws(() => parseStore(JSON.stringify(payload), 'other.myshopify.com'));
  delete payload.data.onlineStore;
  assert.throws(() => parseStore(JSON.stringify(payload), 'test.myshopify.com'));
  assert.deepEqual(parseThemes(JSON.stringify({ themes: [{ id: 2, role: 'unpublished' }] })), [{ id: '2', role: 'unpublished', name: '' }]);
});

test('public probe rejects password pages and checks discovered key links', async () => {
  const seen = [];
  const fetcher = async url => {
    seen.push(url);
    return { ok: true, status: 200, url, text: async () => url.endsWith('/') ? '<a href="/products/one">P</a><a href="/collections/all">C</a>' : '<main>ok</main>' };
  };
  assert.deepEqual(await publicProbe('test.myshopify.com', [], fetcher), ['/', '/cart', '/products/one', '/collections/all']);
  assert.equal(seen.length, 4);
  await assert.rejects(() => publicProbe('test.myshopify.com', [], async url => ({ ok: true, status: 200, url, text: async () => '<main>ok</main>' })), /no products route/);
  await assert.rejects(() => publicProbe('test.myshopify.com', [], async url => ({ ok: true, status: 200, url: `${url}password`, text: async () => '' })));
});
