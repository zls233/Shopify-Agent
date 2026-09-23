import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, shouldRun } from '../src/steps.mjs';
import { sourceUrl, storeDomain } from '../src/util.mjs';

test('fixed customization and conditional specialists are ordered correctly', () => {
  const ids = STEPS.map(step => step.id);
  assert.ok(ids.indexOf('catalog_import') < ids.indexOf('theme'));
  assert.ok(ids.indexOf('qa') < ids.indexOf('publish'));
  assert.deepEqual(ids.filter(id => ['discount', 'remove_features', 'cookie'].includes(id)), ['discount', 'remove_features', 'cookie']);
  assert.ok(!ids.includes('logo'));
  assert.equal(shouldRun(STEPS.find(step => step.id === 'sticky'), {}), false);
  assert.equal(shouldRun(STEPS.find(step => step.id === 'sticky'), { needsStickyHeader: true }), true);
  assert.equal(shouldRun(STEPS.find(step => step.id === 'content'), { contentPaths: [] }), false);
});

test('source and store validation reject ambiguous targets', () => {
  assert.equal(sourceUrl('https://theordinary.com/us'), 'https://theordinary.com/us');
  assert.throws(() => sourceUrl('file:///etc/passwd'));
  assert.throws(() => sourceUrl('https://user:pass@example.com'));
  assert.equal(storeDomain('TEST.myshopify.com'), 'test.myshopify.com');
  assert.throws(() => storeDomain('example.com'));
});
