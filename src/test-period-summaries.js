const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { PeriodSummaryGenerator, PERIOD_SUMMARY_PROMPT, selectPeriodEvidence } = require('./period-summaries');

test('period prompt requires specific content changes instead of count-only prose', () => {
  assert.match(PERIOD_SUMMARY_PROMPT, /most consequential, specific content changes/i);
  assert.match(PERIOD_SUMMARY_PROMPT, /Avoid generic statements based mainly on counts/i);
  assert.match(PERIOD_SUMMARY_PROMPT, /preview.*general availability.*retirements/i);
  assert.match(PERIOD_SUMMARY_PROMPT, /copy the id.*sourceId/i);
});

test('period evidence preserves product breadth and Message Center signals', () => {
  const product = slug => ({ slug, short: slug });
  const topic = { name: 'Security' };
  const items = [
    { id: 'one', date: '2026-08-01', source: 'docs', changeType: 'Updated', product: product('entra-id'), topic, title: 'Security migration deadline', summary: 'Action required' },
    { id: 'two', date: '2026-08-01', source: 'docs', changeType: 'Updated', product: product('governance'), topic, title: 'Governance guide', summary: 'Configuration guidance' },
    { id: 'three', date: '2026-08-01', source: 'mc', changeType: 'Major update', product: product('entra-id'), topic, title: 'Message Center rollout', summary: 'New preview rollout' }
  ];
  const selected = selectPeriodEvidence(items, 3);
  assert.equal(new Set(selected.map(item => item.product.slug)).size, 2);
  assert.equal(selected.some(item => item.source === 'mc'), true);
});

test('historical generator writes daily, weekly, and monthly Luna max summaries with usage cost', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-periods-'));
  const websiteDir = path.join(root, 'website');
  const mcDataPath = path.join(root, 'mc');
  await fs.mkdir(path.join(mcDataPath, 'archive'), { recursive: true });
  await fs.mkdir(websiteDir, { recursive: true });
  await fs.writeFile(path.join(mcDataPath, 'messages.json'), '[]');
  await fs.writeFile(path.join(websiteDir, '2026-08-01.json'), JSON.stringify({
    newFiles: [],
    deletedFiles: [],
    modifiedFiles: [{
      filename: 'docs/identity/authentication/passkeys.md',
      patch: '+title: Passkey migration\n+description: New migration settings and administrator guidance.',
      additions: 10,
      deletions: 2,
      englishSummary: { summary: 'The passkey migration settings now include an explicit opt-out.', adminImpact: 'Review the migration configuration before rollout.' }
    }]
  }));
  const requests = [];
  const client = { responses: { create: async request => {
    requests.push(request);
    return {
      status: 'completed',
      model: 'gpt-5.6-luna-2026-07-30',
      output_text: JSON.stringify({
        headline: 'Passkey migration controls become clearer',
        overview: 'The documentation added specific passkey migration controls and rollout guidance.',
        adminImpact: 'Identity administrators should review the opt-out before enabling migration.',
        keyChanges: [{ title: 'Migration opt-out documented', detail: 'A new setting gives administrators explicit migration control.', product: 'Entra ID', sourceId: 'doc-source' }]
      }),
      usage: { input_tokens: 1000, output_tokens: 500 }
    };
  } } };
  const generator = new PeriodSummaryGenerator({ websiteDir, mcDataPath, client, reasoningEffort: 'max', budgetUsd: 1.25, now: '2026-08-04T00:00:00Z' });
  const result = await generator.run({ all: true });
  const stored = JSON.parse(await fs.readFile(path.join(websiteDir, 'period-summaries.json'), 'utf8'));
  assert.equal(result.generated, 3);
  assert.equal(requests.every(request => request.model === 'gpt-5.6-luna' && request.reasoning.effort === 'max'), true);
  assert.equal(stored.version, 3);
  assert.equal(stored.days['2026-08-01'].headline, 'Passkey migration controls become clearer');
  assert.equal(stored.weeks['2026-07-27'].headline, 'Passkey migration controls become clearer');
  assert.equal(stored.weeks['2026-07-27'].keyChanges[0].sourceId, 'doc-source');
  assert.equal(stored.months['2026-08'].reasoningEffort, 'max');
  assert.equal(stored.lastRun.requests, 3);
  assert.equal(stored.lastRun.costUsd, 0.0024);
  assert.equal(stored.usageByDay['2026-08-04'].requests, 3);
  assert.equal(JSON.parse(requests[0].input).representativeChanges[0].id.startsWith('doc-'), true);
  assert.equal(JSON.parse(requests[0].input).period.label, '1 August 2026');
  assert.equal('weeklyBriefs' in JSON.parse(requests[0].input), false);
  assert.equal(requests[0].text.format.schema.properties.keyChanges.items.required.includes('sourceId'), true);
  assert.match(requests[0].instructions, /Every key change must be supported by representativeChanges/);
  assert.match(requests[0].instructions, /weeklyBriefs as context only/);
});

test('current generation includes the latest day by default', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-current-day-'));
  const requests = [];
  const generator = new PeriodSummaryGenerator({
    outputPath: path.join(root, 'period-summaries.json'),
    client: { responses: { create: async request => {
      requests.push(JSON.parse(request.input).period);
      return {
        status: 'completed', model: 'gpt-5.6-luna',
        output_text: JSON.stringify({
          headline: 'Current summary', overview: 'The latest changes are summarized.',
          adminImpact: 'Review the current briefing.',
          keyChanges: [{ title: 'Current change', detail: 'The latest change is included.', product: 'Entra ID', sourceId: 'doc-latest' }]
        }),
        usage: { input_tokens: 100, output_tokens: 100 }
      };
    } } },
    logger: { log() {}, warn() {} }
  });
  generator.loadItems = async () => [
    {
      id: 'doc-latest', date: '2026-08-02', source: 'docs', changeType: 'Updated', additions: 2,
      product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'Authentication' },
      title: 'Latest', summary: 'The latest change.', adminImpact: 'Review it.'
    },
    {
      id: 'doc-older', date: '2026-07-20', source: 'docs', changeType: 'Updated', additions: 1,
      product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'Authentication' },
      title: 'Older', summary: 'An older change.', adminImpact: 'None.'
    }
  ];
  const result = await generator.run({ force: true });
  const stored = JSON.parse(await fs.readFile(generator.outputPath, 'utf8'));
  assert.deepEqual(requests.map(period => period.type), ['day', 'week', 'month']);
  assert.deepEqual(Object.keys(stored.days), ['2026-08-02']);
  assert.equal(result.days, 1);
});

test('daily backfill checkpoints completed dates and resumes after a failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-daily-resume-'));
  const outputPath = path.join(root, 'period-summaries.json');
  const items = [
    {
      id: 'doc-two', date: '2026-08-02', source: 'docs', changeType: 'Updated', additions: 2,
      product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'Authentication' },
      title: 'Second day', summary: 'The second daily change.', adminImpact: 'Review it.'
    },
    {
      id: 'doc-one', date: '2026-08-01', source: 'docs', changeType: 'Updated', additions: 1,
      product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'Authentication' },
      title: 'First day', summary: 'The first daily change.', adminImpact: 'Review it.'
    }
  ];
  const responseFor = headline => ({
    status: 'completed', model: 'gpt-5.6-luna',
    output_text: JSON.stringify({
      headline, overview: `${headline} overview`, adminImpact: `${headline} impact`,
      keyChanges: [{ title: headline, detail: `${headline} detail`, product: 'Entra ID', sourceId: 'doc-one' }]
    }),
    usage: { input_tokens: 100, output_tokens: 100 }
  });

  let firstRunRequests = 0;
  const interrupted = new PeriodSummaryGenerator({
    outputPath,
    client: { responses: { create: async () => {
      firstRunRequests += 1;
      if (firstRunRequests === 2) throw new Error('Permanent test failure');
      return responseFor('First day complete');
    } } },
    logger: { log() {}, warn() {} }
  });
  interrupted.loadItems = async () => items;
  await assert.rejects(interrupted.run({ all: true, kinds: ['day'] }), /Permanent test failure/);
  const checkpoint = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.deepEqual(Object.keys(checkpoint.days), ['2026-08-02']);

  let resumedRequests = 0;
  const resumed = new PeriodSummaryGenerator({
    outputPath,
    client: { responses: { create: async () => {
      resumedRequests += 1;
      return responseFor('Second day complete');
    } } },
    logger: { log() {}, warn() {} }
  });
  resumed.loadItems = async () => items;
  const result = await resumed.run({ all: true, kinds: ['day'] });
  const completed = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.equal(resumedRequests, 1);
  assert.equal(result.days, 2);
  assert.deepEqual(Object.keys(completed.days), ['2026-08-02', '2026-08-01']);
  assert.equal(completed.totalUsage.requests, 2);
});

test('backfill budget applies per run so an existing checkpoint can continue', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-daily-budget-'));
  const outputPath = path.join(root, 'period-summaries.json');
  await fs.writeFile(outputPath, JSON.stringify({
    version: 2,
    days: {}, weeks: {}, months: {},
    totalUsage: { inputTokens: 1000, outputTokens: 1000, requests: 1, costUsd: 99 }
  }));
  let requests = 0;
  const generator = new PeriodSummaryGenerator({
    outputPath,
    budgetUsd: 0.01,
    client: { responses: { create: async () => {
      requests += 1;
      return {
        status: 'completed', model: 'gpt-5.6-luna',
        output_text: JSON.stringify({
          headline: 'Backfill resumed', overview: 'A prior run does not consume the current run budget.',
          adminImpact: 'No action is needed.',
          keyChanges: [{ title: 'Resume works', detail: 'The next missing date can be generated.', product: 'Entra ID', sourceId: 'doc-one' }]
        }),
        usage: { input_tokens: 100, output_tokens: 100 }
      };
    } } },
    logger: { log() {}, warn() {} }
  });
  generator.loadItems = async () => [{
    id: 'doc-one', date: '2026-08-01', source: 'docs', changeType: 'Updated', additions: 1,
    product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'Authentication' },
    title: 'Resume', summary: 'Resume the daily backfill.', adminImpact: 'None.'
  }];
  const result = await generator.run({ all: true, kinds: ['day'] });
  assert.equal(requests, 1);
  assert.equal(result.days, 1);
});

test('UTC-day usage ledger prevents a later scheduled run from starting another request', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-daily-ledger-'));
  const outputPath = path.join(root, 'period-summaries.json');
  const item = {
    id: 'doc-one', date: '2026-08-06', source: 'docs', changeType: 'Updated', additions: 1,
    product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'Authentication' },
    title: 'Daily guardrail', summary: 'A source changed.', adminImpact: 'Review it.'
  };
  const response = {
    status: 'completed', model: 'gpt-5.6-luna',
    output_text: JSON.stringify({
      headline: 'Guardrail update', overview: 'The source changed during this refresh.', adminImpact: 'Review the update.',
      keyChanges: [{ title: 'Source changed', detail: 'The changed source is summarized.', product: 'Entra ID', sourceId: 'doc-one' }]
    }),
    usage: { input_tokens: 1000, output_tokens: 1000 }
  };
  const first = new PeriodSummaryGenerator({
    outputPath, now: '2026-08-06T00:15:00Z', dailyBudgetUsd: 0.001,
    client: { responses: { create: async () => response } }, logger: { log() {}, warn() {} }
  });
  first.loadItems = async () => [item];
  await first.run({ force: true, kinds: ['day'] });
  const second = new PeriodSummaryGenerator({
    outputPath, now: '2026-08-06T04:15:00Z', dailyBudgetUsd: 0.001,
    client: { responses: { create: async () => { throw new Error('should not call OpenAI'); } } }, logger: { log() {}, warn() {} }
  });
  second.loadItems = async () => [item];
  await assert.rejects(second.run({ force: true, kinds: ['day'] }), /UTC-day period-summary budget/);
  const stored = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.equal(stored.usageByDay['2026-08-06'].requests, 1);
});

test('max reasoning retries an incomplete response with a larger token allowance and counts both attempts', async () => {
  const requests = [];
  const completed = {
    status: 'completed',
    model: 'gpt-5.6-luna',
    output_text: JSON.stringify({
      headline: 'A specific weekly change',
      overview: 'The documentation added a concrete administrator control.',
      adminImpact: 'Review the control before rollout.',
      keyChanges: [{ title: 'Control added', detail: 'The new control changes rollout configuration.', product: 'Entra ID' }]
    }),
    usage: { input_tokens: 500, output_tokens: 600 }
  };
  const client = { responses: { create: async request => {
    requests.push(request);
    return requests.length === 1
      ? { status: 'incomplete', usage: { input_tokens: 500, output_tokens: 12000 } }
      : completed;
  } } };
  const generator = new PeriodSummaryGenerator({ client, maxOutputTokens: 12000, budgetUsd: 1.25, logger: { log() {}, warn() {} } });
  const item = {
    id: 'doc-one', date: '2026-08-01', source: 'docs', changeType: 'Updated', additions: 4,
    product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'Authentication' },
    title: 'Administrator control', summary: 'A concrete control was added.', adminImpact: 'Review before rollout.'
  };
  const summary = await generator.generateOne('week', '2026-07-27', [item], { weeks: {}, months: {} });
  assert.equal(summary.headline, 'A specific weekly change');
  assert.deepEqual(requests.map(request => request.max_output_tokens), [12000, 25000]);
  assert.equal(generator.runUsage.requests, 2);
  assert.equal(generator.runUsage.outputTokens, 12600);
});

test('an incomplete 25000-token response retries with a doubled allowance', async () => {
  const requests = [];
  const client = { responses: { create: async request => {
    requests.push(request);
    return requests.length === 1
      ? { status: 'incomplete', usage: { input_tokens: 500, output_tokens: 25000 } }
      : {
          status: 'completed', model: 'gpt-5.6-luna',
          output_text: JSON.stringify({
            headline: 'Large summary completed', overview: 'The summary completed with a larger token allowance.',
            adminImpact: 'Review the completed period briefing.',
            keyChanges: [{ title: 'Larger allowance used', detail: 'The retry doubled the configured output allowance.', product: 'Entra ID' }]
          }),
          usage: { input_tokens: 500, output_tokens: 600 }
        };
  } } };
  const generator = new PeriodSummaryGenerator({ client, maxOutputTokens: 25000, budgetUsd: 5, logger: { log() {}, warn() {} } });
  const item = {
    id: 'doc-large', date: '2026-08-01', source: 'docs', changeType: 'Updated', additions: 4,
    product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'Authentication' },
    title: 'Large period', summary: 'A large period needs more reasoning tokens.', adminImpact: 'Review the briefing.'
  };
  const summary = await generator.generateOne('week', '2026-07-27', [item], { weeks: {}, months: {} });
  assert.equal(summary.headline, 'Large summary completed');
  assert.deepEqual(requests.map(request => request.max_output_tokens), [25000, 50000]);
});

test('transient API overloads are retried without discarding the period', async () => {
  let attempts = 0;
  const warnings = [];
  const client = { responses: { create: async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('Overloaded'), { status: 503 });
    return {
      status: 'completed', model: 'gpt-5.6-luna',
      output_text: JSON.stringify({
        headline: 'Service recovered', overview: 'The period summary completed after a transient overload.',
        adminImpact: 'No administrator action is needed for the retry.',
        keyChanges: [{ title: 'Summary completed', detail: 'The temporary API failure did not discard progress.', product: 'Entra ID' }]
      }),
      usage: { input_tokens: 300, output_tokens: 400 }
    };
  } } };
  const generator = new PeriodSummaryGenerator({
    client, transientRetries: 3, sleep: async () => {},
    logger: { log() {}, warn(message) { warnings.push(message); } }
  });
  const item = {
    id: 'doc-retry', date: '2026-08-01', source: 'docs', changeType: 'Updated', additions: 1,
    product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'General' },
    title: 'Retry example', summary: 'A summary used to test retries.', adminImpact: 'None.'
  };
  const summary = await generator.generateOne('week', '2026-07-27', [item], { weeks: {}, months: {} });
  assert.equal(summary.headline, 'Service recovered');
  assert.equal(attempts, 3);
  assert.equal(warnings.length, 2);
});

test('connection timeouts are retried without discarding the period', async () => {
  let attempts = 0;
  const warnings = [];
  const client = { responses: { create: async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
    return {
      status: 'completed', model: 'gpt-5.6-luna',
      output_text: JSON.stringify({
        headline: 'Timeout recovered', overview: 'The period summary completed after a connection timeout.',
        adminImpact: 'No administrator action is needed for the retry.',
        keyChanges: [{ title: 'Summary completed', detail: 'The timed-out request was retried without discarding progress.', product: 'Entra ID' }]
      }),
      usage: { input_tokens: 300, output_tokens: 400 }
    };
  } } };
  const generator = new PeriodSummaryGenerator({
    client, transientRetries: 3, sleep: async () => {},
    logger: { log() {}, warn(message) { warnings.push(message); } }
  });
  const item = {
    id: 'doc-timeout', date: '2026-08-01', source: 'docs', changeType: 'Updated', additions: 1,
    product: { slug: 'entra-id', short: 'Entra ID' }, topic: { name: 'General' },
    title: 'Timeout example', summary: 'A summary used to test timeout recovery.', adminImpact: 'None.'
  };
  const summary = await generator.generateOne('week', '2026-07-27', [item], { weeks: {}, months: {} });
  assert.equal(summary.headline, 'Timeout recovered');
  assert.equal(attempts, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /timed out/);
});
