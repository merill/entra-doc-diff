const assert = require('node:assert/strict');
const test = require('node:test');

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
