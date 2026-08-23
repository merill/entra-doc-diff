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

test('the monitor has no Microsoft Graph email-sending capability', async () => {
  const root = path.join(__dirname, '..');
  const [monitorSource, monitorWorkflow, kitWorkflow, packageJson, lockfile] = await Promise.all([
    fs.readFile(path.join(__dirname, 'monitor-docs.js'), 'utf8'),
    fs.readFile(path.join(root, '.github', 'workflows', 'daily-docs-monitor.yml'), 'utf8'),
    fs.readFile(path.join(root, '.github', 'workflows', 'daily-kit-broadcast.yml'), 'utf8'),
    fs.readFile(path.join(root, 'package.json'), 'utf8'),
    fs.readFile(path.join(root, 'package-lock.json'), 'utf8')
  ]);
  // The lockfile is checked too: once shared code moves behind a dependency,
  // package.json alone stops naming what actually gets installed.
  const graphEmailPattern = /@azure\/msal-node|@microsoft\/microsoft-graph-client|graph\.microsoft\.com|sendMail|AZURE_CLIENT_ID|Mail\.Send|send-workflow-failure-email|notify-failure|FAILURE_RECIPIENT_EMAIL/;

  assert.doesNotMatch(monitorSource, graphEmailPattern);
  assert.doesNotMatch(monitorWorkflow, graphEmailPattern);
  assert.doesNotMatch(kitWorkflow, graphEmailPattern);
  assert.doesNotMatch(packageJson, graphEmailPattern);
  assert.doesNotMatch(lockfile, graphEmailPattern);
});

test('only Learn articles are tracked, not fragments or assets', () => {
  const monitor = new EntraDocsMonitor();
  assert.equal(monitor.isTrackedDocPath('docs/identity/example.md'), true);
  // Fragments, breadcrumbs and media have no page of their own on Learn, so
  // tracking them produced changes with no reachable URL.
  assert.equal(monitor.isTrackedDocPath('docs/identity/includes/snippet.md'), false);
  assert.equal(monitor.isTrackedDocPath('docs/identity/media/diagram.md'), false);
  assert.equal(monitor.isTrackedDocPath('docs/breadcrumb/toc.md'), false);
  assert.equal(monitor.isTrackedDocPath('docs/identity/example.png'), false);
  assert.equal(monitor.isTrackedDocPath('README.md'), false);

  // The public URL and the tracking predicate must agree; they previously did
  // not, so some tracked changes carried a null URL.
  assert.equal(monitor.generatePublicDocsUrl('docs/identity/example.md'),
    'https://learn.microsoft.com/en-us/entra/identity/example');
  assert.equal(monitor.generatePublicDocsUrl('docs/identity/includes/snippet.md'), null);
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
            category: 'Public preview',
            actionRequired: true,
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
  assert.equal(requests[0].reasoning.effort, 'xhigh');
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].text.format.name, 'entra_diff_summary');
  assert.match(requests[0].input, /new-preview\.md/);
  assert.equal(analysis.newFiles[0].englishSummary.generatedBy, 'openai');
  assert.equal(analysis.newFiles[0].englishSummary.category, 'Public preview');
  assert.equal(analysis.newFiles[0].englishSummary.actionRequired, true);
  assert.match(requests[0].instructions, /The category carries the classification/);
});

test('an unsupported category falls back to Doc update and action defaults to false', async () => {
  const monitor = new EntraDocsMonitor();
  const analysis = createAnalysis();

  monitor.openAIClient = {
    responses: {
      create: async () => ({
        status: 'completed',
        model: 'gpt-5.6-luna-2026-07-01',
        output_text: JSON.stringify({
          category: 'Documentation change',
          headline: 'Wording clarified',
          summary: 'A sentence was reworded.',
          adminImpact: 'No administrator action follows from this edit.'
        })
      })
    }
  };

  await monitor.generateDiffEnglishSummaries(analysis);

  assert.equal(analysis.newFiles[0].englishSummary.category, 'Doc update');
  assert.equal(analysis.newFiles[0].englishSummary.actionRequired, false);
});

test('per-diff summaries fall back without an OpenAI client', async () => {
  const monitor = new EntraDocsMonitor();
  const analysis = createAnalysis();
  monitor.openAIClient = null;

  await monitor.generateDiffEnglishSummaries(analysis);
  const summary = monitor.createFallbackEnglishSummary(analysis);

  assert.equal(analysis.newFiles[0].englishSummary.generatedBy, 'fallback');
  assert.equal(summary.generatedBy, 'fallback');
  assert.equal(summary.groups.length, 1);
});

test('daily HTML and JSON contain the per-diff and fallback day summaries', async () => {
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
      now: () => new Date(timestamp)
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
  assert.deepEqual(state.pendingEmailEventIds, []);
  const status = JSON.parse(await fs.readFile(path.join(websiteDir, 'refresh-status.json'), 'utf8'));
  assert.deepEqual(status.sourceChanges, { documentation: 0, messageCenter: 0 });
  assert.equal(status.lastContentChangedAt, '2026-08-06T04:15:00.000Z');
});
