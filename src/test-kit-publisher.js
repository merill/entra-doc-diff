const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { KitPublisher } = require('./kit-publisher');
const { loadDailyInput, requestedDate } = require('../scripts/publish-kit-broadcast');

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: name => headers[name.toLowerCase()] },
    text: async () => body === undefined ? '' : JSON.stringify(body)
  };
}

function fixture(overrides = {}) {
  return {
    date: '2026-08-06',
    analysis: {
      newFiles: [{}],
      modifiedFiles: [],
      deletedFiles: [],
      summary: { totalFiles: 1 }
    },
    summary: {
      headline: 'Conditional Access <policy> guidance changed',
      overview: 'Review & validate the new "policy" behavior.',
      adminImpact: 'Check sign-in policies before rollout.',
      keyChanges: [{
        title: 'Policy <setting> updated',
        detail: 'The guidance now covers safer & clearer defaults.',
        product: 'Entra ID',
        sourceId: 'doc-policy'
      }]
    },
    ...overrides
  };
}

test('Kit broadcast payload is concise, escaped, linked, and scheduled as email-only', () => {
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    senderEmail: 'updates@daily.entra.news',
    now: () => new Date('2026-08-06T08:20:00Z'),
    scheduleDelayMinutes: 5
  });
  const payload = publisher.buildBroadcast(fixture());

  assert.equal(payload.description, 'daily-entra-news:2026-08-06');
  assert.equal(payload.subject, 'Conditional Access <policy> guidance changed — 6 August 2026');
  assert.equal(payload.preview_text, 'Review & validate the new "policy" behavior.');
  assert.equal(payload.email_address, 'updates@daily.entra.news');
  assert.equal(payload.public, false);
  assert.equal(payload.published_at, null);
  assert.equal(payload.send_at, '2026-08-06T08:25:00.000Z');
  assert.deepEqual(payload.subscriber_filter, [{ all: [{ type: 'all_subscribers' }] }]);
  assert.match(payload.content, /Conditional Access &lt;policy&gt; guidance changed/);
  assert.match(payload.content, /Review &amp; validate the new &quot;policy&quot; behavior/);
  assert.match(payload.content, /href="https:\/\/daily\.entra\.news\/day\/2026-08-06\/#doc-policy"/);
  assert.doesNotMatch(payload.content, /<policy>|<setting>/);
});

test('Kit publisher skips a day without meaningful updates', async () => {
  let calls = 0;
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    fetch: async () => { calls += 1; return response(200); }
  });
  const result = await publisher.publishDaily({
    date: '2026-08-06',
    analysis: { newFiles: [], modifiedFiles: [], deletedFiles: [], summary: { totalFiles: 0 } },
    summary: {}
  });
  assert.deepEqual(result, { status: 'skipped', reason: 'no-changes' });
  assert.equal(calls, 0);
});

test('Kit publisher uses the date marker to avoid duplicate broadcasts', async () => {
  const requests = [];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return response(200, { broadcasts: [{ id: 42, description: 'daily-entra-news:2026-08-06' }] });
    }
  });
  const result = await publisher.publishDaily(fixture());
  assert.deepEqual(result, { status: 'duplicate', broadcastId: 42 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'GET');
});

test('Kit publisher reconciles a transient create failure before retrying POST', async () => {
  const requests = [];
  const delays = [];
  const responses = [
    response(429, { errors: ['slow down'] }, { 'retry-after': '2' }),
    response(200, { broadcasts: [] }),
    response(500, { errors: ['temporary'] }),
    response(200, { broadcasts: [{ id: 99, description: 'daily-entra-news:2026-08-06' }] })
  ];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    now: () => new Date('2026-08-06T08:20:00Z'),
    fetch: async (url, options) => {
      requests.push({ url, options });
      return responses.shift();
    },
    sleep: async delay => delays.push(delay)
  });
  const result = await publisher.publishDaily(fixture());

  assert.deepEqual(result, { status: 'duplicate', broadcastId: 99 });
  assert.equal(requests.length, 4);
  assert.deepEqual(delays, [2000, 1000]);
  const post = requests.at(-2);
  assert.equal(post.options.method, 'POST');
  assert.equal(post.options.headers['X-Kit-Api-Key'], 'test-key');
  const payload = JSON.parse(post.options.body);
  assert.equal(payload.public, false);
  assert.equal(payload.description, 'daily-entra-news:2026-08-06');
  assert.equal(requests.at(-1).options.method, 'GET');
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 1);
});

test('Kit publisher retries POST only after confirming the marker is still absent', async () => {
  const methods = [];
  const responses = [
    response(200, { broadcasts: [] }),
    response(500, { errors: ['temporary'] }),
    response(200, { broadcasts: [] }),
    response(201, { broadcast: { id: 101 } })
  ];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    now: () => new Date('2026-08-06T08:20:00Z'),
    fetch: async (_url, options) => {
      methods.push(options.method);
      return responses.shift();
    },
    sleep: async () => {}
  });

  const result = await publisher.publishDaily(fixture());
  assert.deepEqual(result, { status: 'scheduled', broadcastId: 101, sendAt: '2026-08-06T08:25:00.000Z' });
  assert.deepEqual(methods, ['GET', 'POST', 'GET', 'POST']);
});

test('Kit publisher does not retry validation errors', async () => {
  let calls = 0;
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? response(200, { broadcasts: [] })
        : response(422, { errors: ['invalid sender'] });
    }
  });
  await assert.rejects(() => publisher.publishDaily(fixture()), /HTTP 422: invalid sender/);
  assert.equal(calls, 2);
});

test('Kit publish script loads the latest report and prefers its combined day summary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-kit-'));
  await fs.writeFile(path.join(root, '2026-08-05.json'), JSON.stringify({ summary: { totalFiles: 1 } }));
  await fs.writeFile(path.join(root, '2026-08-06.json'), JSON.stringify({
    summary: { totalFiles: 2 },
    englishSummary: { overview: 'Documentation-only fallback.' }
  }));
  await fs.writeFile(path.join(root, 'period-summaries.json'), JSON.stringify({
    days: { '2026-08-06': { headline: 'Combined daily brief', overview: 'Documentation and Message Center.' } }
  }));

  const input = await loadDailyInput({ websiteDir: root });
  assert.equal(input.date, '2026-08-06');
  assert.equal(input.analysis.summary.totalFiles, 2);
  assert.equal(input.summary.headline, 'Combined daily brief');
  assert.equal(requestedDate(['--date', '2026-08-01']), '2026-08-01');
  assert.throws(() => requestedDate(['--date']), /YYYY-MM-DD/);
  assert.throws(() => requestedDate(['--date', 'not-a-date']), /YYYY-MM-DD/);
});
