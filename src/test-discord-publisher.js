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

test('Discord publishes one daily summary without per-diff sections or a footer', () => {
  const publisher = new DiscordPublisher({
    webhookUrl: 'https://discord.com/api/webhooks/123/token',
    enabled: true
  });
  const events = publisher.createEvents(createAnalysis(), '2026-08-03');

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'daily');
  assert.equal(events[0].url, 'https://daily.entra.news/2026-08-03');

  const payload = publisher.buildPayload(events[0]);
  const embed = payload.embeds[0];
  assert.equal(payload.username, 'Entra Scout');
  assert.equal(Object.hasOwn(payload, 'avatar_url'), false);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(Object.hasOwn(embed, 'footer'), false);
  assert.equal(Object.hasOwn(embed, 'timestamp'), false);
  assert.equal(embed.fields.some(field => field.name === 'Why Entra administrators should care'), false);
  assert.equal(embed.fields.some(field => field.name === 'Documentation change'), false);
  assert.match(embed.fields.at(-1).value, /daily\.entra\.news/);
  assert.doesNotMatch(JSON.stringify(embed), /docs\/identity\/authentication\/first\.md/);
});

test('a single documentation diff still produces one daily summary', () => {
  const publisher = new DiscordPublisher({ enabled: true });
  const analysis = createAnalysis();
  analysis.modifiedFiles = analysis.modifiedFiles.slice(0, 1);
  delete analysis.englishSummary;

  const events = publisher.createEvents(analysis, '2026-08-03');
  const payload = publisher.buildPayload(events[0]);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'daily');
  assert.match(payload.embeds[0].fields[0].value, /updated product behavior/i);
});

test('Discord payload accepts an explicit public avatar URL override', () => {
  const publisher = new DiscordPublisher({
    enabled: true,
    avatarUrl: 'https://cdn.example.com/entra-scout.png'
  });
  const events = publisher.createEvents(createAnalysis(), '2026-08-03');

  assert.equal(
    publisher.buildPayload(events[0]).avatar_url,
    'https://cdn.example.com/entra-scout.png'
  );
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
    await fs.writeFile(statePath, JSON.stringify({
      version: 1,
      published: {},
      pending: {
        'entra-docs:legacy': { type: 'diff', title: 'Legacy per-diff notification' }
      }
    }));

    const first = await publisher.publish(analysis, '2026-08-03');
    const second = await publisher.publish(analysis, '2026-08-03');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));

    assert.equal(first.published, 1);
    assert.equal(second.published, 0);
    assert.equal(requests.length, 2);
    assert.equal(sleeps[0], 1);
    assert.equal(Object.keys(state.published).length, 1);
    assert.equal(Object.keys(state.pending).length, 0);
    assert.equal(Object.hasOwn(state.published, 'entra-docs:legacy'), false);
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
  assert.equal(result.pending, 1);
});
