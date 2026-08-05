const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { TOPIC_ICONS, topicIcon, topicIconPath } = require('./topic-icons');

const CURRENT_TOPIC_SLUGS = [
  'architecture',
  'standards',
  'identity-platform',
  'fundamentals',
  'troubleshooting',
  'authentication',
  'conditional-access',
  'security',
  'governance',
  'provisioning',
  'branding',
  'monitoring',
  'developer',
  'general'
];

test('every current topic has a locally stored SVG mapping', () => {
  assert.deepEqual(Object.keys(TOPIC_ICONS), CURRENT_TOPIC_SLUGS);
  for (const slug of CURRENT_TOPIC_SLUGS) {
    const mapping = topicIcon(slug);
    const asset = path.resolve(__dirname, '..', 'assets', 'site', 'topics', mapping.file);
    assert.equal(path.extname(mapping.file), '.svg');
    assert.ok(fs.existsSync(asset), `${slug} asset should exist`);
    assert.match(fs.readFileSync(asset, 'utf8'), /^<svg\b/);
  }
});

test('unknown topic slugs use the general icon', () => {
  assert.equal(topicIcon('not-yet-classified'), TOPIC_ICONS.general);
  assert.equal(topicIconPath('not-yet-classified'), '/assets/topics/general.svg');
});

test('authentication uses the requested 03344 Multifactor Authentication icon', () => {
  const mapping = topicIcon('authentication');
  assert.equal(mapping.file, 'authentication.svg');
  assert.equal(mapping.sourceName, 'Multifactor Authentication');
  assert.equal(mapping.sourcePath, 'security/03344-icon-service-Multifactor-Authentication.svg');
  assert.equal(mapping.match, 'exact');
});
