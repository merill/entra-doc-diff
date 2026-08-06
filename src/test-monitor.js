const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const EntraDocsMonitor = require('./monitor-docs');

function createFile(overrides = {}) {
  return {
    filename: 'docs/id-governance/new-preview.md',
    status: 'added',
    additions: 30,
    deletions: 0,
    changes: 30,
    patch: '+++ b/docs/id-governance/new-preview.md\n+title: New preview\n+# New preview capability\n+Admins can test this feature in preview.',
    commitSha: 'abc123',
    commitMessage: 'Add preview documentation',
    commitAuthor: 'Test Author',
    commitDate: '2026-08-03T00:00:00Z',
    githubUrl: 'https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/id-governance/new-preview.md',
    publicDocsUrl: 'https://learn.microsoft.com/en-us/entra/id-governance/new-preview',
    ...overrides
  };
}

function createAnalysis(files = [createFile()]) {
  return {
    newFiles: files.filter(file => file.status === 'added'),
    modifiedFiles: files.filter(file => file.status === 'modified'),
    deletedFiles: files.filter(file => file.status === 'removed'),
    summary: {
      totalCommits: new Set(files.map(file => file.commitSha)).size,
      totalFiles: files.length,
      authors: new Set(['Test Author'])
    }
  };
}

test('email messages omit sensitivity and carry the mail-flow marker', () => {
  const previousRecipient = process.env.RECIPIENT_EMAIL;
  const previousSender = process.env.SENDER_EMAIL;

  process.env.RECIPIENT_EMAIL = 'recipient@example.com';
  process.env.SENDER_EMAIL = 'sender@example.com';

  try {
    const monitor = new EntraDocsMonitor();
    const message = monitor.buildEmailMessage('Daily update', '<p>Report</p>');

    assert.equal(Object.hasOwn(message, 'sensitivity'), false);
    assert.equal(message.importance, 'normal');
    assert.deepEqual(message.internetMessageHeaders, [
      { name: 'x-entra-docs-monitor', value: 'daily-report' },
      { name: 'x-entra-docs-encryption', value: 'none' }
    ]);
    assert.equal(message.toRecipients[0].emailAddress.address, 'recipient@example.com');
    assert.equal(message.from.emailAddress.address, 'sender@example.com');
  } finally {
    if (previousRecipient === undefined) delete process.env.RECIPIENT_EMAIL;
    else process.env.RECIPIENT_EMAIL = previousRecipient;

    if (previousSender === undefined) delete process.env.SENDER_EMAIL;
    else process.env.SENDER_EMAIL = previousSender;
  }
});

test('email online report link uses the static daily route', async () => {
  const monitor = new EntraDocsMonitor();
  const analysis = createAnalysis();
  let sentPayload;
  monitor.initializeGraphClient = async () => ({
    api: () => ({ post: async payload => { sentPayload = payload; } })
  });

  await monitor.sendEmail('', analysis, { dateForUrl: '2026-08-04' });

  assert.match(sentPayload.message.body.content, /https:\/\/daily\.entra\.news\/day\/2026-08-04\//);
  assert.doesNotMatch(sentPayload.message.body.content, /entradiff\.merill\.net|2026-08-04\.html/);
});

test('commit parsing and analysis retain the first parent for exact documentation diffs', async () => {
  const monitor = new EntraDocsMonitor();
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const parsed = monitor.parseCommitDetails(`${base} ${'c'.repeat(40)}\n\nM\tdocs/identity/example.md\n`, head);
  assert.equal(parsed.baseCommitSha, base);
  assert.equal(parsed.files[0].filename, 'docs/identity/example.md');

  monitor.getCommitDetails = async () => parsed;
  monitor.getFileDiff = async () => '@@ -1 +1 @@\n-old\n+new';
  const analysis = await monitor.analyzeChanges([{
    hash: head,
    parents: `${base} ${'c'.repeat(40)}`,
    message: 'Update example',
    author_name: 'Test Author',
    date: '2026-08-05T00:00:00Z'
  }]);
  assert.equal(analysis.modifiedFiles[0].baseCommitSha, base);
  assert.equal(analysis.modifiedFiles[0].commitSha, head);
});

test('each diff receives its own Luna English summary', async () => {
  const monitor = new EntraDocsMonitor();
  const analysis = createAnalysis();
  const requests = [];

  monitor.openAIClient = {
    responses: {
      create: async request => {
        requests.push(request);
        return {
          status: 'completed',
          model: 'gpt-5.6-luna-2026-07-01',
          output_text: JSON.stringify({
            category: 'Preview',
            headline: 'Identity Governance preview documentation added',
            summary: 'Microsoft added documentation for an Identity Governance preview capability.',
            adminImpact: 'Administrators can review the documented prerequisites before testing the preview.'
          })
        };
      }
    }
  };

  await monitor.generateDiffEnglishSummaries(analysis);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'gpt-5.6-luna');
  assert.equal(requests[0].reasoning.effort, 'medium');
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].text.format.name, 'entra_diff_summary');
  assert.match(requests[0].input, /new-preview\.md/);
  assert.equal(analysis.newFiles[0].englishSummary.generatedBy, 'openai');
  assert.equal(analysis.newFiles[0].englishSummary.category, 'Preview');
});

test('multiple diffs receive one additional Luna grouping call', async () => {
  const first = createFile({
    englishSummary: {
      category: 'Preview',
      headline: 'Governance preview added',
      summary: 'A governance preview was documented.',
      adminImpact: 'Review before testing.',
      generatedBy: 'openai'
    }
  });
  const second = createFile({
    filename: 'docs/id-governance/updated-workflow.md',
    status: 'modified',
    commitSha: 'def456',
    publicDocsUrl: 'https://learn.microsoft.com/en-us/entra/id-governance/updated-workflow',
    englishSummary: {
      category: 'Feature update',
      headline: 'Workflow guidance updated',
      summary: 'Workflow configuration guidance changed.',
      adminImpact: 'Check existing workflow configuration.',
      generatedBy: 'openai'
    }
  });
  const analysis = createAnalysis([first, second]);
  const requests = [];
  const monitor = new EntraDocsMonitor();
  monitor.openAIClient = {
    responses: {
      create: async request => {
        requests.push(request);
        return {
          status: 'completed',
          model: 'gpt-5.6-luna-2026-07-01',
          output_text: JSON.stringify({
            overview: 'Two related Identity Governance documentation changes were published.',
            groups: [{
              category: 'Preview',
              title: 'Identity Governance capabilities and workflows',
              summary: 'The changes document a preview and update related workflow guidance.',
              sourceFiles: [first.filename, second.filename]
            }]
          })
        };
      }
    }
  };

  analysis.englishSummary = await monitor.generateEnglishSummary(analysis);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].text.format.name, 'entra_grouped_summary');
  assert.match(requests[0].input, /updated-workflow\.md/);
  assert.equal(analysis.englishSummary.generatedBy, 'openai');
  assert.deepEqual(analysis.englishSummary.groups[0].sourceFiles, [first.filename, second.filename]);
  assert.equal(analysis.englishSummary.highlights.length, 1);
});

test('per-diff and grouped summaries fall back without an OpenAI client', async () => {
  const monitor = new EntraDocsMonitor();
  const analysis = createAnalysis();
  monitor.openAIClient = null;

  await monitor.generateDiffEnglishSummaries(analysis);
  const summary = await monitor.generateEnglishSummary(analysis);

  assert.equal(analysis.newFiles[0].englishSummary.generatedBy, 'fallback');
  assert.equal(summary.generatedBy, 'fallback');
  assert.equal(summary.groups.length, 1);
});

test('daily HTML and JSON contain the per-diff and grouped English summaries', async () => {
  const monitor = new EntraDocsMonitor();
  const analysis = createAnalysis();
  analysis.newFiles[0].englishSummary = {
    category: 'Preview',
    headline: 'Preview documentation added',
    summary: 'The page documents a preview capability.',
    adminImpact: 'Review prerequisites before enabling it.',
    generatedBy: 'openai'
  };
  analysis.englishSummary = monitor.createFallbackEnglishSummary(analysis);

  const html = monitor.generateHtmlReport(analysis);
  const json = JSON.parse(JSON.stringify(analysis));

  assert.match(html, /Preview documentation added/);
  assert.match(html, /Why admins should care/);
  assert.match(html, /id="change-[a-f0-9]{12}"/);
  assert.equal(json.newFiles[0].englishSummary.headline, 'Preview documentation added');
  assert.equal(json.englishSummary.groups.length, 1);
});

test('rendered summaries escape model-provided HTML', () => {
  const monitor = new EntraDocsMonitor();
  const html = monitor.renderDiffEnglishSummaryHtml({
    englishSummary: {
      category: 'Preview',
      headline: '<b>Unsafe headline</b>',
      summary: '<script>alert(1)</script>',
      adminImpact: 'Safe & useful'
    }
  }, true);

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>Unsafe/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Safe &amp; useful/);
});

test('pending email events are collected across UTC day files without duplicates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-email-queue-'));
  const websiteDir = path.join(root, 'website');
  await fs.mkdir(websiteDir, { recursive: true });
  const first = createFile({ commitSha: 'first', eventId: 'entra-docs:first:added:docs/id-governance/new-preview.md' });
  const second = createFile({ commitSha: 'second', eventId: 'entra-docs:second:added:docs/id-governance/new-preview.md' });
  await fs.writeFile(path.join(websiteDir, '2026-08-05.json'), JSON.stringify(createAnalysis([first])));
  await fs.writeFile(path.join(websiteDir, '2026-08-06.json'), JSON.stringify(createAnalysis([second])));
  const monitor = new EntraDocsMonitor({ websiteDir, reportsDir: path.join(root, 'reports') });
  const queued = await monitor.loadQueuedEmailAnalysis([first.eventId, second.eventId, second.eventId]);
  assert.deepEqual(queued.newFiles.map(file => file.commitSha), ['first', 'second']);
  assert.equal(queued.summary.totalCommits, 2);
});

test('successive monitor runs accumulate same-file commits and suppress cursor replay', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-monitor-runs-'));
  const websiteDir = path.join(root, 'website');
  const reportsDir = path.join(root, 'reports');
  const mcDataPath = path.join(root, 'mc');
  await fs.mkdir(mcDataPath, { recursive: true });
  await fs.writeFile(path.join(mcDataPath, 'messages.json'), '[]');
  const discordPublisher = {
    publish: async () => ({ published: 1, pending: 0, skipped: 0 }),
    getDiffAnchor: file => `change-${file.commitSha}`
  };

  const runWith = async (file, timestamp) => {
    const monitor = new EntraDocsMonitor({
      websiteDir, reportsDir, mcDataPath, discordPublisher,
      now: () => new Date(timestamp), emailEnabled: false
    });
    monitor.openAISummaryEnabled = false;
    monitor.setupRepository = async () => {};
    monitor.getDocumentationCursor = async () => ({ head: file.commitSha, commits: [{ hash: file.commitSha }], fallback: false });
    monitor.analyzeChanges = async () => createAnalysis([file]);
    await monitor.ensureReportsDir();
    return monitor.run();
  };

  const first = createFile({ status: 'modified', commitSha: 'first' });
  const second = createFile({ status: 'modified', commitSha: 'second' });
  assert.equal((await runWith(first, '2026-08-06T00:15:00Z')).contentChanged, true);
  assert.equal((await runWith(second, '2026-08-06T04:15:00Z')).contentChanged, true);
  assert.equal((await runWith(second, '2026-08-06T08:15:00Z')).contentChanged, false);

  const daily = JSON.parse(await fs.readFile(path.join(websiteDir, '2026-08-06.json'), 'utf8'));
  assert.deepEqual(daily.modifiedFiles.map(file => file.commitSha), ['first', 'second']);
  const state = JSON.parse(await fs.readFile(path.join(websiteDir, 'monitor-state.json'), 'utf8'));
  assert.equal(state.docsHead, 'second');
  assert.equal(state.migrated, true);
  assert.equal(state.pendingEmailEventIds.length, 2);
  const status = JSON.parse(await fs.readFile(path.join(websiteDir, 'refresh-status.json'), 'utf8'));
  assert.deepEqual(status.sourceChanges, { documentation: 0, messageCenter: 0 });
  assert.equal(status.lastContentChangedAt, '2026-08-06T04:15:00.000Z');
});
