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

test('historical generator writes weekly and monthly Luna max summaries with usage cost', async () => {
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
        keyChanges: [{ title: 'Migration opt-out documented', detail: 'A new setting gives administrators explicit migration control.', product: 'Entra ID' }]
      }),
      usage: { input_tokens: 1000, output_tokens: 500 }
    };
  } } };
  const generator = new PeriodSummaryGenerator({ websiteDir, mcDataPath, client, reasoningEffort: 'max', budgetUsd: 1.25, now: '2026-08-04T00:00:00Z' });
  const result = await generator.run({ all: true });
  const stored = JSON.parse(await fs.readFile(path.join(websiteDir, 'period-summaries.json'), 'utf8'));
  assert.equal(result.generated, 2);
  assert.equal(requests.every(request => request.model === 'gpt-5.6-luna' && request.reasoning.effort === 'max'), true);
  assert.equal(stored.weeks['2026-07-27'].headline, 'Passkey migration controls become clearer');
  assert.equal(stored.months['2026-08'].reasoningEffort, 'max');
  assert.equal(stored.lastRun.requests, 2);
  assert.equal(stored.lastRun.costUsd, 0.0016);
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
