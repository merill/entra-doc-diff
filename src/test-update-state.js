const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectMessageCenterChanges,
  documentationEventId,
  mergeDailyAnalysis,
  nextScheduledRefresh,
  serializeAnalysis
} = require('./update-state');

function analysis(files = []) {
  return {
    newFiles: [],
    modifiedFiles: files,
    deletedFiles: [],
    messageCenterItems: [],
    summary: { totalCommits: files.length, totalFiles: files.length, authors: new Set(['Merill']) }
  };
}

test('four-hour schedule advances through every UTC slot and midnight', () => {
  assert.equal(nextScheduledRefresh('2026-08-06T00:15:00.000Z'), '2026-08-06T04:15:00.000Z');
  assert.equal(nextScheduledRefresh('2026-08-06T08:14:59.000Z'), '2026-08-06T08:15:00.000Z');
  assert.equal(nextScheduledRefresh('2026-08-06T20:15:00.000Z'), '2026-08-07T00:15:00.000Z');
});

test('daily merge preserves separate commits to one file and suppresses exact events', () => {
  const first = { filename: 'docs/passkeys.md', status: 'modified', commitSha: 'aaa', firstSeenAt: '2026-08-06T00:15:00Z' };
  const second = { filename: 'docs/passkeys.md', status: 'modified', commitSha: 'bbb', firstSeenAt: '2026-08-06T04:15:00Z' };
  first.eventId = documentationEventId(first);
  second.eventId = documentationEventId(second);
  const merged = mergeDailyAnalysis(analysis([first]), analysis([first, second]));
  assert.deepEqual(merged.modifiedFiles.map(file => file.commitSha), ['aaa', 'bbb']);
  assert.equal(merged.summary.totalCommits, 2);
  assert.deepEqual(serializeAnalysis(merged).summary.authors, ['Merill']);
});

test('Message Center migration seeds versions and later emits only new versions', () => {
  const item = { id: 'MC123', date: '2026-08-06', lastModifiedDateTime: '2026-08-06T00:00:00Z' };
  const seeded = detectMessageCenterChanges([item], {}, { migrated: false, now: '2026-08-06T00:15:00Z' });
  assert.equal(seeded.changed.length, 0);
  const unchanged = detectMessageCenterChanges([item], seeded.versions, { migrated: true, now: '2026-08-06T04:15:00Z' });
  assert.equal(unchanged.changed.length, 0);
  const updated = detectMessageCenterChanges([{ ...item, lastModifiedDateTime: '2026-08-06T05:00:00Z' }], seeded.versions, { migrated: true, now: '2026-08-06T08:15:00Z' });
  assert.equal(updated.changed.length, 1);
  assert.equal(updated.changed[0].eventId, 'message-center:MC123:2026-08-06T05:00:00Z');
});
