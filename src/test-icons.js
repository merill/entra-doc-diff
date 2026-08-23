const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getConfig } = require('./config');

const { taxonomy } = getConfig();

// This product's icon set is conformance, not shared behaviour: the code only
// ever reads `icon.file`, so what is worth asserting is that every declared
// slug names an SVG that is actually committed, and that the provenance the
// manifest records has not drifted from the drawing it was taken from.
function assertIconsResolve(entries, dir) {
  assert.ok(entries.length, `${dir} should declare at least one entry`);
  for (const entry of entries) {
    assert.equal(path.extname(entry.icon.file), '.svg', `${entry.slug} should name an SVG`);
    const asset = path.resolve(__dirname, '..', 'assets', 'site', dir, entry.icon.file);
    assert.ok(fs.existsSync(asset), `${entry.slug} should have an asset at ${asset}`);
    // Some drawings carry an XML prolog and some do not; both are valid SVG.
    assert.match(fs.readFileSync(asset, 'utf8'), /^(<\?xml[^>]*\?>\s*)?<svg\b/);
  }
}

test('every topic renders a committed SVG', () => {
  assertIconsResolve(taxonomy.topics, 'topics');
});

test('every product renders a committed SVG', () => {
  assertIconsResolve(taxonomy.products, 'products');
});

test('each topic has a drawing of its own', () => {
  const files = taxonomy.topics.map(topic => topic.icon.file);
  assert.equal(new Set(files).size, files.length);
  const sources = taxonomy.topics.map(topic => topic.icon.sourcePath);
  assert.equal(new Set(sources).size, sources.length);
});

test('authentication uses the requested 03344 Multifactor Authentication icon', () => {
  const topic = taxonomy.topics.find(entry => entry.slug === 'authentication');
  assert.deepEqual({ ...topic.icon }, {
    file: 'authentication.svg',
    sourceName: 'Multifactor Authentication',
    sourcePath: 'security/03344-icon-service-Multifactor-Authentication.svg',
    match: 'exact'
  });
});
