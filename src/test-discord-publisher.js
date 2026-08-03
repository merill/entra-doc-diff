const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const test = require('node:test');

const DiscordPublisher = require('./discord-publisher');

function createAnalysis() {
  const makeFile = (filename, commitSha) => ({
    filename,
    status: 'modified',
    additions: 8,
    deletions: 2,
    commitSha,
    commitDate: '2026-08-03T00:00:00Z',
    githubUrl: `https://github.com/MicrosoftDocs/entra-docs/blob/main/${filename}`,
    publicDocsUrl: `https://learn.microsoft.com/en-us/entra/${filename.replace(/^docs\//, '').replace(/\.md$/, '')}`,
    englishSummary: {
      category: 'Feature update',
      headline: `Updated ${filename.split('/').pop()}`,
      summary: 'The documentation explains updated product behavior.',
      adminImpact: 'Administrators should compare the guidance with their existing configuration.'
    }
  });

  const files = [
    makeFile('docs/identity/authentication/first.md', 'abc123'),
    makeFile('docs/identity/authentication/second.md', 'def456')
  ];
  return {
    newFiles: [],
    modifiedFiles: files,
    deletedFiles: [],
    summary: { totalCommits: 2, totalFiles: 2, authors: new Set(['Test']) },
    englishSummary: {
      overview: 'Two related authentication documentation changes were published.',
      groups: [{
        category: 'Feature update',
        title: 'Authentication guidance',
        summary: 'Two authentication pages describe related product behavior changes.',
        sourceFiles: files.map(file => file.filename)
      }]
    }
  };
}

test('Discord events include one bulk digest followed by every diff', () => {
  const publisher = new DiscordPublisher({
    webhookUrl: 'https://discord.com/api/webhooks/123/token',
    enabled: true
  });
  const events = publisher.createEvents(createAnalysis(), '2026-08-03');

  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'bulk');
  assert.equal(events[1].type, 'diff');
  assert.match(events[1].reportUrl, /2026-08-03\.html#change-/);

  const payload = publisher.buildPayload(events[1]);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.match(payload.embeds[0].fields[2].value, /Microsoft Learn/);
});

test('Discord publisher retries rate limits and does not republish delivered event IDs', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-discord-test-'));
  const statePath = path.join(temporaryDirectory, 'discord-state.json');
  const requests = [];
  const sleeps = [];
  let responseNumber = 0;
  const fetchImpl = async (url, request) => {
    requests.push({ url: String(url), body: JSON.parse(request.body) });
    responseNumber++;
    if (responseNumber === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => '0.001' },
        json: async () => ({ retry_after: 0.001 })
      };
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'message' }) };
  };

  try {
    const publisher = new DiscordPublisher({
      webhookUrl: 'https://discord.com/api/webhooks/123/token',
      enabled: true,
      statePath,
      fetchImpl,
      sleep: async milliseconds => sleeps.push(milliseconds)
    });
    const analysis = createAnalysis();

    const first = await publisher.publish(analysis, '2026-08-03');
    const second = await publisher.publish(analysis, '2026-08-03');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));

    assert.equal(first.published, 3);
    assert.equal(second.published, 0);
    assert.equal(requests.length, 4);
    assert.equal(sleeps[0], 1);
    assert.equal(Object.keys(state.published).length, 3);
    assert.equal(Object.keys(state.pending).length, 0);
    assert.match(requests[0].url, /wait=true/);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Discord dry run does not send or mark messages as delivered', async () => {
  let called = false;
  const publisher = new DiscordPublisher({
    webhookUrl: 'https://discord.com/api/webhooks/123/token',
    enabled: true,
    dryRun: true,
    fetchImpl: async () => {
      called = true;
      throw new Error('should not send');
    }
  });

  const result = await publisher.publish(createAnalysis(), '2026-08-03');
  assert.equal(called, false);
  assert.equal(result.pending, 3);
});
