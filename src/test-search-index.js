const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPatch, buildUpdateRecord, buildBriefRecord } = require('./search-index');

const product = { name: 'Microsoft Entra ID', short: 'Entra ID', slug: 'entra-id', icon: 'entra-id.svg' };
const topic = { name: 'Conditional Access', slug: 'conditional-access', icon: '/assets/topics/conditional-access.svg' };

test('search update records include readable evidence and exact archive filters', () => {
  const record = buildUpdateRecord({
    url: '/changes/2026-08-05/example/',
    title: 'Conditional Access adds a new control',
    summary: 'A plain-English explanation.',
    adminImpact: 'Review affected policies.',
    date: '2026-08-05',
    source: 'docs',
    sourceLabel: 'Microsoft Learn',
    changeType: 'Updated',
    product,
    topic,
    filename: 'docs/identity/conditional-access.md',
    patch: 'diff --git a/file b/file\n@@ -1 +1 @@\n-old setting\n+optOutSettings.passkeyDynamicMigration'
  });
  assert.equal(record.url, '/changes/2026-08-05/example/');
  assert.deepEqual(record.filters.product, ['entra-id']);
  assert.deepEqual(record.filters.topic, ['conditional-access']);
  assert.deepEqual(record.filters.recordType, ['update']);
  assert.equal(record.sort.date, '2026-08-05');
  assert.match(record.content, /optOutSettings\.passkeyDynamicMigration/);
  assert.doesNotMatch(record.content, /diff --git|@@ -1/);
});

test('patch cleanup removes Git metadata and Microsoft Learn front matter', () => {
  const cleaned = cleanPatch('diff --git a/a b/a\nindex 123..456 100644\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n+title: Hidden\n+ms.topic: concept-article\n+Searchable setting');
  assert.equal(cleaned, 'Searchable setting');
});

test('editorial records link to their static period and stay separately filterable', () => {
  const record = buildBriefRecord('week', '2026-08-03', {
    headline: 'Passkey rollout guidance changes',
    overview: 'The week focused on migration deadlines.',
    adminImpact: 'Review passkey configuration.',
    keyChanges: [{ title: 'Migration', detail: 'A date was clarified.', product: 'Entra ID' }]
  });
  assert.equal(record.url, '/week/2026-08-03/');
  assert.deepEqual(record.filters.recordType, ['brief']);
  assert.deepEqual(record.filters.periodType, ['week']);
  assert.match(record.content, /migration deadlines/i);
});
