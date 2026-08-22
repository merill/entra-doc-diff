const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { KitPublisher } = require('./kit-publisher');
const {
  automaticMode,
  isAtOrAfterAutomaticCutoff,
  loadDailyInput,
  requestedDate,
  runAutomatic
} = require('../scripts/publish-kit-broadcast');

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
        title: 'Conditional Access policy <setting> updated',
        detail: 'The guidance now covers safer & clearer defaults.',
        product: 'Entra ID',
        sourceId: 'doc-policy'
      }]
    },
    ...overrides
  };
}

async function writeDailyReport(root, date, totalFiles = 1) {
  await fs.writeFile(path.join(root, `${date}.json`), JSON.stringify({
    newFiles: totalFiles ? [{}] : [],
    modifiedFiles: [],
    deletedFiles: [],
    summary: { totalFiles },
    englishSummary: totalFiles ? { headline: `${date} changes`, overview: 'A meaningful daily change.' } : {}
  }));
}

test('Kit broadcast payload is concise, escaped, linked, and scheduled as email-only', () => {
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    now: () => new Date('2026-08-06T08:20:00Z'),
    scheduleDelayMinutes: 5
  });
  const payload = publisher.buildBroadcast(fixture());

  assert.equal(payload.description, 'daily-entra-news:2026-08-06');
  assert.equal(payload.subject, 'Conditional Access <policy> guidance changed — 6 August 2026');
  assert.equal(payload.preview_text, 'Review & validate the new "policy" behavior.');
  assert.equal('email_address' in payload, false);
  assert.equal(payload.public, false);
  assert.equal(payload.published_at, null);
  assert.equal(payload.send_at, '2026-08-06T08:25:00.000Z');
  assert.equal('subscriber_filter' in payload, false);
  assert.match(payload.content, /Conditional Access &lt;policy&gt; guidance changed/);
  assert.match(payload.content, /Review &amp; validate the new &quot;policy&quot; behavior/);
  assert.match(payload.content, /href="https:\/\/daily\.entra\.news\/day\/2026-08-06\/#doc-policy"/);
  assert.match(payload.content, /src="https:\/\/daily\.entra\.news\/assets\/products\/entra-id\.svg"/);
  assert.match(payload.content, /src="https:\/\/daily\.entra\.news\/assets\/topics\/conditional-access\.svg"/);
  assert.match(payload.content, /Entra ID · Conditional Access/);
  assert.doesNotMatch(payload.content, /What Entra admins need to know|Check sign-in policies before rollout/);
  assert.doesNotMatch(payload.content, /<policy>|<setting>/);
});

test('Kit broadcast includes an explicitly configured verified sender', () => {
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    senderEmail: 'updates@daily.entra.news'
  });

  assert.equal(publisher.buildBroadcast(fixture()).email_address, 'updates@daily.entra.news');
});

test('Kit draft mode creates an unscheduled draft with a separate marker', () => {
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    draftMode: true,
    now: () => new Date('2026-08-06T08:20:00Z')
  });
  const payload = publisher.buildBroadcast(fixture());

  assert.equal(payload.description, 'daily-entra-news:2026-08-06:draft');
  assert.equal(payload.public, false);
  assert.equal(payload.send_at, null);
  assert.equal(publisher.marker('2026-08-06', false), 'daily-entra-news:2026-08-06');
});

test('an existing test draft does not prevent the real daily broadcast', async () => {
  const requests = [];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    now: () => new Date('2026-08-06T08:20:00Z'),
    fetch: async (_url, options) => {
      requests.push(options);
      return options.method === 'GET'
        ? response(200, { broadcasts: [{ id: 40, description: 'daily-entra-news:2026-08-06:draft' }] })
        : response(201, { broadcast: { id: 41 } });
    }
  });

  const result = await publisher.publishDaily(fixture());
  assert.deepEqual(result, { status: 'scheduled', broadcastId: 41, sendAt: '2026-08-06T08:25:00.000Z' });
  assert.deepEqual(requests.map(request => request.method), ['GET', 'POST']);
});

test('Kit draft mode creates a draft instead of scheduling a send', async () => {
  const requests = [];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    draftMode: true,
    fetch: async (_url, options) => {
      requests.push(options);
      return options.method === 'GET'
        ? response(200, { broadcasts: [] })
        : response(201, { broadcast: { id: 43, status: 'draft' } });
    }
  });

  const result = await publisher.publishDaily(fixture());
  assert.deepEqual(result, { status: 'draft', broadcastId: 43 });
  const payload = JSON.parse(requests.at(-1).body);
  assert.equal(payload.description, 'daily-entra-news:2026-08-06:draft');
  assert.equal(payload.send_at, null);
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

test('Kit publisher follows cursor pagination to find an existing marker', async () => {
  const requests = [];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1
        ? response(200, {
          broadcasts: [{ id: 1, description: 'older-broadcast' }],
          pagination: { has_next_page: true, end_cursor: 'next/page' }
        })
        : response(200, {
          broadcasts: [{ id: 42, description: 'daily-entra-news:2026-08-06' }],
          pagination: { has_next_page: false }
        });
    }
  });

  const result = await publisher.publishDaily(fixture());
  assert.deepEqual(result, { status: 'duplicate', broadcastId: 42 });
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /after=next%2Fpage/);
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 0);
});

test('Kit publisher verifies a completed broadcast', async () => {
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    fetch: async (url) => url.endsWith('/stats')
      ? response(200, { broadcast: { id: 42, stats: { status: 'completed' } } })
      : response(200, {
        broadcasts: [{
          id: 42,
          description: 'daily-entra-news:2026-08-06',
          send_at: '2026-08-06T08:25:00Z'
        }]
      })
  });

  assert.deepEqual(await publisher.verifyDaily('2026-08-06'), {
    status: 'verified',
    lifecycleStatus: 'completed',
    broadcastId: 42
  });
});

test('Kit publisher accepts scheduled and sending states only within the verification grace period', async t => {
  for (const lifecycleStatus of ['scheduled', 'sending']) {
    await t.test(lifecycleStatus, async () => {
      const publisher = new KitPublisher({
        apiKey: 'test-key',
        now: () => new Date('2026-08-06T08:54:00Z'),
        verificationGraceMinutes: 30,
        fetch: async (url) => url.endsWith('/stats')
          ? response(200, { broadcast: { id: 42, stats: { status: lifecycleStatus } } })
          : response(200, {
            broadcasts: [{
              id: 42,
              description: 'daily-entra-news:2026-08-06',
              send_at: '2026-08-06T08:25:00Z'
            }]
          })
      });

      const result = await publisher.verifyDaily('2026-08-06');
      assert.equal(result.status, 'pending');
      assert.equal(result.lifecycleStatus, lifecycleStatus);
    });
  }
});

test('Kit publisher rejects overdue and unexpected delivery states', async t => {
  for (const lifecycleStatus of ['scheduled', 'sending', 'aborted', 'draft', 'mystery', '']) {
    await t.test(lifecycleStatus || 'unknown', async () => {
      const publisher = new KitPublisher({
        apiKey: 'test-key',
        now: () => new Date('2026-08-06T09:00:01Z'),
        verificationGraceMinutes: 30,
        fetch: async (url) => url.endsWith('/stats')
          ? response(200, { broadcast: { id: 42, stats: { status: lifecycleStatus } } })
          : response(200, {
            broadcasts: [{
              id: 42,
              description: 'daily-entra-news:2026-08-06',
              send_at: '2026-08-06T08:25:00Z'
            }]
          })
      });

      const expected = lifecycleStatus === 'scheduled' || lifecycleStatus === 'sending'
        ? /remained .* more than 30 minutes/
        : /unexpected delivery status/;
      await assert.rejects(() => publisher.verifyDaily('2026-08-06'), expected);
    });
  }
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

test('automatic Kit mode uses the 08:15 UTC cutoff', () => {
  assert.equal(automaticMode(['--auto']), true);
  assert.equal(automaticMode(['--date', '2026-08-06']), false);
  assert.equal(isAtOrAfterAutomaticCutoff('2026-08-06T08:14:59Z'), false);
  assert.equal(isAtOrAfterAutomaticCutoff('2026-08-06T08:15:00Z'), true);
});

test('automatic reconciliation verifies but does not publish before 08:15 UTC', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-kit-auto-before-'));
  await writeDailyReport(root, '2026-08-06');
  const requests = [];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    now: () => new Date('2026-08-06T08:14:00Z'),
    fetch: async (_url, options) => {
      requests.push(options.method);
      return response(200, { broadcasts: [] });
    }
  });

  const result = await runAutomatic({
    now: new Date('2026-08-06T08:14:00Z'),
    websiteDir: root,
    publisher,
    logger: { log() {} }
  });

  assert.deepEqual(result.current, { status: 'skipped', reason: 'before-cutoff', date: '2026-08-06' });
  assert.deepEqual(requests, ['GET']);
});

test('automatic reconciliation creates the current-day broadcast on a later same-day run', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-kit-auto-late-'));
  await writeDailyReport(root, '2026-08-06');
  const methods = [];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    now: () => new Date('2026-08-06T12:15:00Z'),
    fetch: async (_url, options) => {
      methods.push(options.method);
      return options.method === 'POST'
        ? response(201, { broadcast: { id: 501 } })
        : response(200, { broadcasts: [] });
    }
  });

  const result = await runAutomatic({
    now: new Date('2026-08-06T12:15:00Z'),
    websiteDir: root,
    publisher,
    logger: { log() {} }
  });

  assert.equal(result.current.status, 'scheduled');
  assert.equal(result.current.broadcastId, 501);
  assert.deepEqual(methods, ['GET', 'GET', 'POST']);
});

test('automatic reconciliation treats absent and no-change current reports as healthy no-ops', async t => {
  await t.test('absent report', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-kit-auto-absent-'));
    const publisher = new KitPublisher({
      apiKey: 'test-key',
      fetch: async () => { throw new Error('Kit should not be called'); }
    });
    const result = await runAutomatic({
      now: new Date('2026-08-06T12:15:00Z'),
      websiteDir: root,
      publisher,
      logger: { log() {} }
    });
    assert.equal(result.current.reason, 'no-report');
  });

  await t.test('no-change report', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-kit-auto-empty-'));
    await writeDailyReport(root, '2026-08-06', 0);
    const publisher = new KitPublisher({
      apiKey: 'test-key',
      fetch: async () => { throw new Error('Kit should not be called'); }
    });
    const result = await runAutomatic({
      now: new Date('2026-08-06T12:15:00Z'),
      websiteDir: root,
      publisher,
      logger: { log() {} }
    });
    assert.equal(result.current.reason, 'no-changes');
  });
});

test('automatic reconciliation verifies the previous day without creating it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-kit-auto-previous-'));
  await writeDailyReport(root, '2026-08-05');
  const methods = [];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    now: () => new Date('2026-08-06T00:15:00Z'),
    fetch: async (url, options) => {
      methods.push(options.method);
      return url.endsWith('/stats')
        ? response(200, { broadcast: { id: 77, stats: { status: 'completed' } } })
        : response(200, {
          broadcasts: [{
            id: 77,
            description: 'daily-entra-news:2026-08-05',
            send_at: '2026-08-05T08:20:00Z'
          }]
        });
    }
  });

  const result = await runAutomatic({
    now: new Date('2026-08-06T00:15:00Z'),
    websiteDir: root,
    publisher,
    logger: { log() {} }
  });
  assert.equal(result.previous.status, 'verified');
  assert.deepEqual(methods, ['GET', 'GET']);
});

test('automatic reconciliation reports a missed previous day but still schedules today', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-kit-auto-missed-'));
  await writeDailyReport(root, '2026-08-05');
  await writeDailyReport(root, '2026-08-06');
  const methods = [];
  const publisher = new KitPublisher({
    apiKey: 'test-key',
    now: () => new Date('2026-08-06T12:15:00Z'),
    fetch: async (_url, options) => {
      methods.push(options.method);
      return options.method === 'POST'
        ? response(201, { broadcast: { id: 88 } })
        : response(200, { broadcasts: [] });
    }
  });

  await assert.rejects(() => runAutomatic({
    now: new Date('2026-08-06T12:15:00Z'),
    websiteDir: root,
    publisher,
    logger: { log() {} }
  }), /2026-08-05.*no Kit broadcast/);
  assert.equal(methods.filter(method => method === 'POST').length, 1);
});

test('Kit workflow exposes and passes through the manual draft-mode toggle', async () => {
  const workflow = await fs.readFile(path.join(__dirname, '..', '.github', 'workflows', 'daily-kit-broadcast.yml'), 'utf8');
  assert.equal((workflow.match(/draft_mode:/g) || []).length, 2);
  assert.equal((workflow.match(/auto_mode:/g) || []).length, 1);
  assert.match(workflow, /description: Create a Kit draft without scheduling or sending it/);
  assert.match(workflow, /KIT_DRAFT_MODE: \$\{\{ inputs\.draft_mode \}\}/);
  assert.match(workflow, /node scripts\/publish-kit-broadcast\.js --auto/);
  assert.match(workflow, /KIT_SEND_VERIFICATION_GRACE_MINUTES: "30"/);
  assert.match(workflow, /Signal manual production start[\s\S]*github\.event_name == 'workflow_dispatch' && inputs\.draft_mode != true[\s\S]*\/start/);
  assert.match(workflow, /report-health:[\s\S]*needs: publish[\s\S]*github\.event_name == 'workflow_dispatch' && inputs\.draft_mode != true[\s\S]*PING_URL="\$PING_URL\/fail"/);
});
