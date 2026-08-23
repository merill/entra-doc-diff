const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { normalize, runRules } = require('./config');

const productConfig = require(path.join(__dirname, '..', 'dailynews.config.js'));

function valid(overrides = {}) {
  return { ...productConfig, ...overrides };
}

test('the product configuration is valid', () => {
  const config = normalize(productConfig);
  assert.equal(config.site.host, 'daily.entra.news');
  assert.equal(config.site.url, 'https://daily.entra.news');
  assert.equal(config.brand.wordmark, 'Daily.Entra.News');
  assert.ok(config.taxonomy.products.length >= 1);
  assert.ok(config.taxonomy.topics.length >= 1);
});

test('every classification rule names a declared slug', () => {
  const config = normalize(productConfig);
  const products = new Set(config.taxonomy.products.map(entry => entry.slug));
  const topics = new Set(config.taxonomy.topics.map(entry => entry.slug));
  for (const rule of config.classify.products) assert.ok(products.has(rule.slug), rule.slug);
  for (const rule of config.classify.topics) assert.ok(topics.has(rule.slug), rule.slug);
  assert.ok(products.has(config.taxonomy.defaultProduct));
  assert.ok(topics.has(config.taxonomy.defaultTopic));
});

test('validation rejects the mistakes a new product would actually make', () => {
  assert.throws(() => normalize({}), /site\.name/);
  assert.throws(() => normalize(valid({ site: { ...productConfig.site, url: 'https://x.example/' } })), /must not end with a slash/);

  const dupe = { ...productConfig.taxonomy, products: [productConfig.taxonomy.products[0], productConfig.taxonomy.products[0]] };
  assert.throws(() => normalize(valid({ taxonomy: dupe })), /duplicated/);

  const badDefault = { ...productConfig.taxonomy, defaultProduct: 'not-a-product' };
  assert.throws(() => normalize(valid({ taxonomy: badDefault })), /not a declared product/);

  const badRule = { ...productConfig.classify, products: [{ slug: 'nope', match: /x/ }] };
  assert.throws(() => normalize(valid({ classify: badRule })), /not a declared slug/);

  const stringPattern = { ...productConfig.classify, products: [{ slug: 'entra-id', match: 'not-a-regexp' }] };
  assert.throws(() => normalize(valid({ classify: stringPattern })), /must be a RegExp/);
});

test('rule scope and guards behave as the classifiers rely on', () => {
  const entries = [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }];

  // A title-scoped rule must ignore the body entirely.
  const titleScoped = [{ slug: 'a', scope: 'title', match: /widget/, unless: undefined }];
  assert.equal(runRules(titleScoped, entries, 'b', 'file.md', 'Widget release', '').slug, 'a');
  assert.equal(runRules(titleScoped, entries, 'b', 'file.md', 'Other', 'widget widget').slug, 'b');

  // `unless` suppresses a match that a narrower rule should own.
  const guarded = [{ slug: 'a', scope: 'title', match: /widget/, unless: /legacy/ }];
  assert.equal(runRules(guarded, entries, 'b', '', 'Legacy widget', '').slug, 'b');

  // First match wins, and an unmatched subject falls back to the default.
  const ordered = [{ slug: 'a', scope: 'text', match: /x/ }, { slug: 'b', scope: 'text', match: /x/ }];
  assert.equal(runRules(ordered, entries, 'b', 'x', '', '').slug, 'a');
  assert.equal(runRules(ordered, entries, 'b', 'nothing', '', '').slug, 'b');
});
