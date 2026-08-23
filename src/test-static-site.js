const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const {
  StaticSiteGenerator,
  isEntraMessage,
  classifyProduct,
  classifyTopic,
  extractMarkdownMetadata,
  selectRelatedItems,
  sanitizeMcHtml,
  formattedDiff,
  renderMarkdownDiff,
  renderDailyRss
} = require('./static-site');

test('Message Center filter matches standalone Entra in service or title', () => {
  assert.equal(isEntraMessage({ Services: ['Microsoft Entra'], Title: 'A change' }), true);
  assert.equal(isEntraMessage({ Services: ['Microsoft Purview'], Title: 'Purview integrates with Entra GSA' }), true);
  assert.equal(isEntraMessage({ Services: ['Microsoft 365'], Title: 'Entranced by a new feature' }), false);
});

test('product classification recognizes governance and workload identity', () => {
  assert.equal(classifyProduct('docs/id-governance/tenant-governance/monitor.md').slug, 'id-governance');
  assert.equal(classifyProduct('', 'Harden federated credentials for workload identities').slug, 'workload-id');
});

test('MicrosoftX diff URLs preserve Learn state and exact revisions', () => {
  const generator = new StaticSiteGenerator({ websiteDir: path.join(os.tmpdir(), 'unused-entra-site') });
  const result = new URL(generator.microsoftXDiffUrl({
    publicUrl: 'https://learn.microsoft.com/en-us/entra/identity/example?tabs=portal#step-1',
    baseCommitSha: 'a'.repeat(40),
    commitSha: 'b'.repeat(40)
  }));
  assert.equal(result.origin, 'https://mx.merill.net');
  assert.equal(result.pathname, '/en-us/entra/identity/example');
  assert.equal(result.searchParams.get('tabs'), 'portal');
  assert.equal(result.searchParams.get('_mx_base'), 'a'.repeat(40));
  assert.equal(result.searchParams.get('_mx_head'), 'b'.repeat(40));
  assert.equal(result.hash, '#step-1');
});

test('historical documentation links prefer the full-page diff and fall back to the day anchor', () => {
  const generator = new StaticSiteGenerator({ websiteDir: path.join(os.tmpdir(), 'unused-entra-site') });

  // Items older than the detail window get no page of their own, so the link has
  // to go somewhere useful rather than into a day page anchor.
  assert.equal(generator.historicalDocUrl({
    date: '2026-01-15',
    id: 'abc123',
    publicUrl: 'https://learn.microsoft.com/en-us/entra/identity/example',
    commitSha: 'b'.repeat(40)
  }), 'https://mx.merill.net/en-us/entra/identity/example?_mx_head=' + 'b'.repeat(40));

  // Without a Learn URL there is nothing to diff, so the day anchor still applies.
  assert.equal(generator.historicalDocUrl({ date: '2026-01-15', id: 'abc123' }),
    '/day/2026-01-15/#abc123');
  assert.equal(generator.historicalDocUrl({ date: '2026-01-15', id: 'abc123', publicUrl: 'https://example.com/x' }),
    '/day/2026-01-15/#abc123');
});

test('topic icon logic prioritizes Conditional Access titles and authentication references', () => {
  assert.equal(classifyTopic('docs/identity/security.md', 'Conditional Access authentication strength', 'Authentication controls and sign-in requirements.').slug, 'conditional-access');
  assert.equal(classifyTopic('docs/architecture/overview.md', 'Identity architecture', 'This authentication reference explains passwordless sign-in.').slug, 'authentication');
  assert.equal(classifyTopic('docs/identity/security.md', 'Policy controls', 'Conditional Access policy behavior.').slug, 'conditional-access');
});

test('Markdown metadata prefers frontmatter and produces readable description', () => {
  const longDescription = `Evaluate a tenant against a known-good configuration baseline ${'without losing meaningful detail '.repeat(12)}`.trim();
  const metadata = extractMarkdownMetadata(`diff --git a/a b/a\n+title: Create a configuration monitor\n+description: ${longDescription}\n+# Create a configuration monitor`, 'docs/test.md');
  assert.equal(metadata.title, 'Create a configuration monitor');
  assert.equal(metadata.description, longDescription);
  assert.doesNotMatch(metadata.description, /…$/);
});

test('Message Center HTML sanitizer removes active content and event handlers', () => {
  const result = sanitizeMcHtml('<p onclick="alert(1)">Hello <a href="https://example.com">world</a></p><script>alert(2)</script><img src="x">');
  assert.doesNotMatch(result, /script|onclick|<img/i);
  assert.match(result, /rel="noopener noreferrer"/);
});

test('formatted diff renders added and removed document content', () => {
  const result = formattedDiff('@@ -1 +1 @@\n-# Old heading\n+# New heading\n+[Learn more](/entra/identity/example)');
  assert.match(result, /class="rich-diff"/);
  assert.match(result, /<h1><del[^>]*>Old<\/del><ins[^>]*>New<\/ins> heading<\/h1>/);
  assert.match(result, /https:\/\/learn\.microsoft\.com\/entra\/identity\/example/);
});

test('formatted diff hides front matter and preserves complete Markdown tables', () => {
  const result = formattedDiff([
    '@@ -1,10 +1,11 @@',
    ' ---',
    '-title: Old title',
    '+title: New title',
    ' ms.topic: concept-article',
    ' ---',
    ' ',
    ' | Capability | Reference |',
    ' | --- | --- |',
    '-| Old capability | Old reference |',
    '+| Web content filtering | [Configure](/entra/global-secure-access/) |'
  ].join('\n'));
  assert.doesNotMatch(result, /Old title|New title|ms\.topic/);
  assert.match(result, /<table>/);
  assert.match(result, /<th>Capability<\/th>/);
  assert.match(result, /<del[^>]*>Old capability<\/del><ins[^>]*>Web content filtering<\/ins>/);
  assert.match(result, /<del[^>]*>Old reference<\/del><ins[^>]*><a [^>]*>Configure<\/a><\/ins>/);
});

test('formatted diff hides a front matter fragment when the hunk starts after its opening delimiter', () => {
  const result = formattedDiff([
    '@@ -2,7 +2,7 @@',
    ' title: How to manage the Internet Access profile',
    ' description: Learn how to manage the profile.',
    '-ms.date: 03/25/2026',
    '+ms.date: 08/02/2026',
    ' ms.subservice: entra-internet-access',
    ' ',
    ' ## Overview',
    '-The old explanation.',
    '+The new explanation.'
  ].join('\n'));
  assert.doesNotMatch(result, /title:|description:|ms\.date|ms\.subservice/);
  assert.match(result, /<h2>Overview<\/h2>/);
  assert.match(result, /<del[^>]*>old<\/del><ins[^>]*>new<\/ins>/);
  assert.doesNotMatch(result, /<p><\/p>/);
});

test('formatted diff repairs paragraph-to-heading changes into valid block markup', () => {
  const result = formattedDiff([
    '@@ -1 +1 @@',
    '-Example of adding a custom bypass policy:',
    '+## How to add a custom bypass policy'
  ].join('\n'));
  assert.doesNotMatch(result, /<p[^>]*>[\s\S]*<h2[^>]*>[\s\S]*<\/p>/);
  assert.match(result, /<p><del[^>]*>Example of adding<\/del><\/p><h2>/);
  assert.match(result, /<ins[^>]*>policy<\/ins><\/h2>/);
});

test('formatted diff renders every Microsoft Learn alert type', () => {
  for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'CAUTION', 'WARNING']) {
    const result = formattedDiff(`@@ -1 +1 @@\n+> [!${type}]\n+> Alert content`);
    assert.match(result, new RegExp(`class="learn-alert learn-alert-${type.toLowerCase()}"`));
    assert.match(result, new RegExp(`<span>${type.charAt(0)}${type.slice(1).toLowerCase()}<\\/span>`));
    assert.doesNotMatch(result, new RegExp(`\\[!${type}\\]`));
  }
});

test('Markdown diff uses Git-style line semantics', () => {
  const result = renderMarkdownDiff('diff --git a/file.md b/file.md\nindex 1234567..89abcde 100644\n--- a/file.md\n+++ b/file.md\n@@ -1 +1 @@\n-old value\n+new value\n context');
  assert.match(result, /aria-label="Markdown Git diff"/);
  assert.doesNotMatch(result, /diff --git|index 1234567|--- a\/file\.md|\+\+\+ b\/file\.md/);
  assert.match(result, /markdown-diff-line hunk[^>]*>@@ -1 \+1 @@/);
  assert.match(result, /markdown-diff-line removed[^>]*>-old value/);
  assert.match(result, /markdown-diff-line added[^>]*>\+new value/);
});

test('related items preserve a relevant cross-source result', () => {
  const product = { slug: 'entra-id' };
  const topic = { slug: 'branding' };
  const item = { id: 'doc-main', source: 'docs', date: '2026-08-01', title: 'Company branding CSS retirement', product, topic };
  const docs = Array.from({ length: 6 }, (_, index) => ({ id: `doc-${index}`, source: 'docs', date: '2026-08-01', title: `Company branding CSS retirement guide ${index}`, product, topic }));
  const message = { id: 'MC100', source: 'mc', date: '2026-08-01', title: 'Microsoft Entra ID company branding CSS retirement', product, topic };
  const related = selectRelatedItems(item, [...docs, message], 5);
  assert.equal(related.length, 5);
  assert.equal(related.some(candidate => candidate.id === 'MC100'), true);
});

test('RSS contains newest-first richly formatted daily briefs linked to daily pages', () => {
  const rss = renderDailyRss([
    {
      date: '2026-08-01',
      data: { englishSummary: { overview: 'Older identity summary.' } }
    },
    {
      date: '2026-08-03',
      data: {
        englishSummary: {
          headline: 'Identity & access <review>',
          overview: 'Review & apply today\'s guidance.',
          keyChanges: [{ title: 'Conditional Access', detail: 'A policy <setting> changed.' }],
          adminImpact: 'Check sign-in policies.'
        }
      }
    },
    {
      date: '2026-08-02',
      data: { modifiedFiles: [{ englishSummary: { summary: 'A per-change summary must not become an RSS item.' } }] }
    }
  ], {
    '2026-08-04': {
      headline: 'Message Center-only Entra update',
      overview: 'A daily brief can exist even when no documentation report exists.'
    },
    '2026-08-03': {
      headline: 'Identity & access <review>',
      overview: 'Review & apply today\'s regenerated guidance.',
      keyChanges: [{ title: 'Conditional Access', detail: 'A policy <setting> changed.', product: 'Entra ID', sourceId: 'change-ca' }],
      adminImpact: 'Check sign-in policies.'
    }
  }, 50, [{
    id: 'change-ca',
    product: { slug: 'entra-id' },
    topic: { slug: 'conditional-access' }
  }]);
  assert.match(rss, /<title>Entra\.News Daily summaries<\/title>/);
  assert.match(rss, /<description>Plain-English daily summaries of Microsoft Entra documentation and Message Center changes\.<\/description>/);
  assert.match(rss, /xmlns:content="http:\/\/purl\.org\/rss\/1\.0\/modules\/content\/"/);
  assert.match(rss, /<language>en<\/language>/);
  assert.equal((rss.match(/<item>/g) || []).length, 3);
  assert.equal(rss.indexOf('/day/2026-08-04/') < rss.indexOf('/day/2026-08-03/'), true);
  assert.match(rss, /<link>https:\/\/daily\.entra\.news\/day\/2026-08-04\/<\/link>/);
  assert.equal(rss.indexOf('/day/2026-08-03/') < rss.indexOf('/day/2026-08-01/'), true);
  assert.match(rss, /<link>https:\/\/daily\.entra\.news\/day\/2026-08-03\/<\/link>/);
  assert.match(rss, /<guid isPermaLink="true">https:\/\/daily\.entra\.news\/day\/2026-08-03\/<\/guid>/);
  assert.match(rss, /Identity &amp; access &lt;review&gt; — 3 August 2026/);
  assert.match(rss, /<description><!\[CDATA\[<div/);
  assert.match(rss, /<content:encoded><!\[CDATA\[<div/);
  assert.match(rss, /Day in brief · 3 August 2026/);
  assert.match(rss, /Review &amp; apply today&#0*39;s regenerated guidance\./);
  assert.match(rss, /https:\/\/daily\.entra\.news\/assets\/products\/entra-id\.svg/);
  assert.match(rss, /https:\/\/daily\.entra\.news\/assets\/topics\/conditional-access\.svg/);
  assert.match(rss, /<table role="presentation" width="100%"/);
  assert.match(rss, /<td width="46"[^>]*>[\s\S]*width:20px!important;max-width:20px!important;height:20px!important/);
  assert.match(rss, /width:16px!important;max-width:16px!important;height:16px!important/);
  assert.match(rss, /href="https:\/\/daily\.entra\.news\/day\/2026-08-03\/#change-ca"[^>]*>Conditional Access<\/a>/);
  assert.match(rss, /margin:0 0 20px;padding:0 0 18px/);
  assert.match(rss, /View all updates for 3 August 2026/);
  assert.doesNotMatch(rss, /today&apos;s guidance\./);
  assert.doesNotMatch(rss, /For Entra administrators|per-change summary|\/changes\//);
});

test('daily email form falls back safely when Kit public configuration is missing or untrusted', () => {
  const missing = new StaticSiteGenerator();
  assert.match(missing.dailyEmailForm(), /daily RSS feed/);
  const untrusted = new StaticSiteGenerator({
    kitDailyFormUid: 'daily-form-123',
    kitDailyFormEmbedSrc: 'https://example.com/form.js'
  });
  assert.match(untrusted.dailyEmailForm(), /daily RSS feed/);
  assert.doesNotMatch(untrusted.dailyEmailForm(), /example\.com/);
  const trusted = new StaticSiteGenerator({
    kitDailyFormUid: 'daily-form-123',
    kitDailyFormEmbedSrc: 'https://daily-entra-news.kit.com/daily-form-123/index.js'
  });
  assert.match(trusted.dailyEmailForm(), /data-kit-form-uid="daily-form-123"/);
  assert.match(trusted.dailyEmailForm(), /data-kit-form-src="https:\/\/daily-entra-news\.kit\.com\/daily-form-123\/index\.js"/);
  assert.match(trusted.dailyEmailForm(), /Loading the secure signup form/);
  assert.doesNotMatch(trusted.dailyEmailForm(), /<script/);
});

test('the generated-site workflow runs only for build inputs and cannot retrigger itself', async () => {
  const workflow = await fs.readFile(path.join(__dirname, '..', '.github', 'workflows', 'build-static-website.yml'), 'utf8');
  assert.match(workflow, /push:\n\s+branches:\n\s+- main\n\s+paths:/);
  assert.match(workflow, /'\.github\/workflows\/build-static-website\.yml'/);
  assert.match(workflow, /'assets\/site\/\*\*'/);
  assert.match(workflow, /'src\/static-site\.js'/);
  assert.doesNotMatch(workflow, /'reports\/\*\*'|'website\/\*\*'/);
  assert.match(workflow, /group: entra-docs-monitor/);
  assert.match(workflow, /MC_DATA_PATH: '\.\/mc\/@data'/);
  assert.match(workflow, /run: npm run build:site/);
  assert.match(workflow, /git add website\//);
});

test('static generator writes indexable archive and detail pages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-daily-'));
  const websiteDir = path.join(root, 'website');
  const mcDataPath = path.join(root, 'mc');
  await fs.mkdir(path.join(mcDataPath, 'archive'), { recursive: true });
  await fs.mkdir(websiteDir, { recursive: true });
  await fs.writeFile(path.join(websiteDir, '2026-08-01.json'), JSON.stringify({
    newFiles: [],
    deletedFiles: [],
    modifiedFiles: [{
      filename: 'docs/id-governance/tenant-governance/how-to-create-monitor.md',
      patch: '+title: Create a configuration monitor\n+description: Evaluate configuration drift against a baseline',
      additions: 2,
      deletions: 0,
      baseCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      publicDocsUrl: 'https://learn.microsoft.com/en-us/entra/id-governance/',
      englishSummary: {
        category: 'Public preview',
        actionRequired: true,
        generatedBy: 'openai',
        summary: 'This readable summary explains the configuration baseline change in full so administrators can understand the update before opening the source diff.',
        adminImpact: 'Entra administrators should compare the documented baseline with their tenant configuration and investigate unexpected drift.'
      }
    }],
    englishSummary: {
      overview: 'Daily identity governance summary.',
      groups: [{ title: 'Configuration monitoring', summary: 'Review the documented baseline.' }]
    }
  }));
  for (const date of ['2026-06-15','2026-06-29','2026-07-06','2026-07-13','2026-07-20']) {
    await fs.writeFile(path.join(websiteDir, `${date}.json`), JSON.stringify({
      newFiles: [],
      deletedFiles: [],
      modifiedFiles: [{
        filename: `docs/identity/archive-update-${date}.md`,
        patch: `+title: Archive update ${date}\n+description: Historical archive navigation fixture`,
        additions: 2,
        deletions: 0,
        publicDocsUrl: 'https://learn.microsoft.com/en-us/entra/identity/'
      }]
    }));
  }
  await fs.writeFile(path.join(websiteDir, '2026-07-31.html'), 'legacy daily report');
  await fs.writeFile(path.join(mcDataPath, 'messages.json'), JSON.stringify([]));
  await fs.writeFile(path.join(websiteDir, 'period-summaries.json'), JSON.stringify({
    days: {
      '2026-08-01': {
        headline: 'Configuration monitoring defines a tenant baseline',
        overview: 'Identity Governance guidance now explains how administrators can evaluate configuration drift against a known baseline.',
        adminImpact: 'Review the baseline and investigate unexpected changes.',
        keyChanges: [{ title: 'Configuration monitor guidance added', detail: 'The new guidance documents baseline evaluation for tenant configuration.', product: 'ID Governance', sourceId: 'doc-2026-08-01-create-a-configuration-monitor-01' }]
      }
    },
    weeks: {
      '2026-07-27': {
        headline: 'Passkey migration guidance leads the week',
        overview: 'The week introduced concrete migration controls and configuration guidance for Entra administrators.',
        adminImpact: 'Review the new opt-out behavior before planning migration.',
        keyChanges: [{ title: 'Migration control documented', detail: 'Administrators can assess the new behavior before rollout.', product: 'Entra ID', sourceId: 'doc-2026-08-01-create-a-configuration-monitor-01' }]
      }
    },
    months: {
      '2026-08': {
        headline: 'Identity governance and passkeys shape August',
        overview: 'August documentation focused on configuration baselines and migration controls.',
        adminImpact: 'Compare the new guidance with current tenant configuration.',
        keyChanges: [{ title: 'Configuration baselines expanded', detail: 'New guidance explains how to evaluate configuration drift.', product: 'ID Governance', sourceId: 'doc-2026-08-01-create-a-configuration-monitor-01' }]
      }
    }
  }));
  await fs.writeFile(path.join(mcDataPath, 'archive', 'MC100.json'), JSON.stringify({
    Id: 'MC100',
    Title: 'Microsoft Entra ID: New administrator experience',
    Services: ['Microsoft Entra'],
    Category: 'planForChange',
    StartDateTime: '2026-08-01T10:00:00Z',
    Body: { Content: '<p>Review the new administrator experience.</p>' }
  }));
  const generator = new StaticSiteGenerator({
    websiteDir,
    mcDataPath,
    detailDays: 60,
    generatedAt: '2026-08-04T09:00:00Z',
    kitDailyFormUid: 'daily-form-123',
    kitDailyFormEmbedSrc: 'https://daily-entra-news.kit.com/daily-form-123/index.js'
  });
  const result = await generator.build();
  assert.equal(result.messageCenter, 1);
  const indexHtml = await fs.readFile(path.join(websiteDir, 'index.html'), 'utf8');
  const dayIndexHtml = await fs.readFile(path.join(websiteDir, 'day', 'index.html'), 'utf8');
  const dayHtml = await fs.readFile(path.join(websiteDir, 'day', '2026-08-01', 'index.html'), 'utf8');
  const weekIndexHtml = await fs.readFile(path.join(websiteDir, 'week', 'index.html'), 'utf8');
  const monthHtml = await fs.readFile(path.join(websiteDir, 'month', '2026-08', 'index.html'), 'utf8');
  const docDetailHtml = await fs.readFile(path.join(websiteDir, 'changes', '2026-08-01', 'create-a-configuration-monitor-01', 'index.html'), 'utf8');
  const messageDetailHtml = await fs.readFile(path.join(websiteDir, 'message-center', 'MC100', 'index.html'), 'utf8');
  const aboutHtml = await fs.readFile(path.join(websiteDir, 'about', 'index.html'), 'utf8');
  const compareHtml = await fs.readFile(path.join(websiteDir, 'compare', 'index.html'), 'utf8');
  const searchHtml = await fs.readFile(path.join(websiteDir, 'search', 'index.html'), 'utf8');
  const siteCss = await fs.readFile(path.join(websiteDir, 'assets', 'site.css'), 'utf8');
  const siteJs = await fs.readFile(path.join(websiteDir, 'assets', 'site.js'), 'utf8');
  const searchJs = await fs.readFile(path.join(websiteDir, 'assets', 'search.js'), 'utf8');
  const learnDiffJs = await fs.readFile(path.join(websiteDir, 'assets', 'learn-diff.js'), 'utf8');
  const diffConfigJs = await fs.readFile(path.join(websiteDir, 'assets', 'diff-config.js'), 'utf8');
  const rssXml = await fs.readFile(path.join(websiteDir, 'rss.xml'), 'utf8');
  assert.match(indexHtml, /Entra\.News Daily/);
  assert.match(rssXml, /<link>https:\/\/daily\.entra\.news\/day\/2026-08-01\/<\/link>/);
  assert.match(rssXml, /Identity Governance guidance now explains how administrators can evaluate configuration drift/);
  assert.match(rssXml, /<content:encoded><!\[CDATA\[<div/);
  assert.match(rssXml, /https:\/\/daily\.entra\.news\/assets\/products\/id-governance\.svg/);
  assert.match(rssXml, /https:\/\/daily\.entra\.news\/assets\/topics\/governance\.svg/);
  assert.match(rssXml, /https:\/\/daily\.entra\.news\/day\/2026-08-01\/#doc-2026-08-01-create-a-configuration-monitor-01/);
  assert.doesNotMatch(rssXml, /\/changes\/|New administrator experience/);
  assert.match(indexHtml, /<link rel="icon" href="\/favicon\.ico" sizes="any">/);
  assert.match(indexHtml, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png">/);
  assert.match(indexHtml, /property="og:image" content="https:\/\/daily\.entra\.news\/og-image\.png"/);
  assert.match(indexHtml, /property="og:image:width" content="1200"/);
  assert.match(indexHtml, /property="og:image:height" content="630"/);
  assert.match(indexHtml, /name="twitter:card" content="summary_large_image"/);
  for (const html of [indexHtml, dayHtml, weekIndexHtml, monthHtml, docDetailHtml, messageDetailHtml, aboutHtml]) {
    assert.match(html, /https:\/\/cdn\.userjot\.com\/sdk\/v2\/uj\.js/);
    assert.match(html, /window\.uj\.init\('cmsf6dr5931kz0ipdm14g1qbt',\{widget:true,theme:'auto',position:'right'\}\)/);
    assert.doesNotMatch(html, /uj\.identify/);
  }
  assert.equal((indexHtml.match(/cdn\.userjot\.com\/sdk\/v2\/uj\.js/g) || []).length, 1);
  assert.match(indexHtml, /href="https:\/\/merill\.net"/);
  assert.match(indexHtml, /<script defer data-site="nuj3pzyz" data-domain="daily\.entra\.news" src="https:\/\/piqo\.app\/piqo\.js"><\/script>/);
  assert.equal((indexHtml.match(/https:\/\/piqo\.app\/piqo\.js/g) || []).length, 1);
  assert.match(indexHtml, /href="https:\/\/mx\.merill\.net\/" data-nav="compare" target="_blank" rel="noopener noreferrer" class="nav-icon" aria-label="View full page diff" title="View full page diff"><span class="nav-mobile-icon" aria-hidden="true"><\/span><span class="nav-label">Diff<\/span><\/a>/);
  assert.match(indexHtml, /href="\/search\/" data-nav="search" class="nav-icon" aria-label="Search" title="Search"><span class="nav-mobile-icon" aria-hidden="true"><\/span><span class="nav-label">Search<\/span><\/a>/);
  assert.match(searchHtml, /href="\/search\/" data-nav="search" class="nav-icon" aria-current="page" aria-label="Search" title="Search">/);
  assert.equal((indexHtml.match(/class="nav-mobile-icon"/g) || []).length, 6);
  assert.match(siteCss, /@media\(max-width:760px\)\{\.site-header\{padding-bottom:8px\}\.main-nav\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(siteCss, /data-nav="day"\]\{--nav-icon:url\("\/assets\/ui\/calendar-date\.svg"\)/);
  assert.match(siteCss, /data-nav="week"\]\{--nav-icon:url\("\/assets\/ui\/calendar-planning\.svg"\)/);
  assert.match(siteCss, /data-nav="message-center"\]\{--nav-icon:url\("\/assets\/ui\/square-layout-grid-2\.svg"\)/);
  assert.match(siteCss, /\.main-nav a\{display:flex;align-items:center;justify-content:center;gap:7px\}\.main-nav \.nav-mobile-icon\{display:block/);
  assert.match(siteCss, /@media\(min-width:761px\) and \(max-width:1050px\)\{\.main-nav\{display:flex;justify-content:flex-end;gap:28px\}\}/);
  assert.doesNotMatch(siteCss, /data-nav="compare"\] \.nav-mobile-icon\{background:#a94700\}/);
  assert.match(searchJs, /Searching 25,877 archived updates/);
  assert.match(searchJs, /class="search-progress"/);
  assert.match(searchJs, /Math\.max\(0,360-/);
  assert.match(searchJs, /autoSearchDelay=600/);
  assert.match(searchJs, /defaultControlValues=\{product:'all',topic:'all',source:'all',recordType:'update',sort:'relevance'\}/);
  assert.match(searchJs, /const hasQuery=\(\)=>Boolean\(input\.value\.trim\(\)\)/);
  assert.match(searchJs, /Enter a word or phrase to search the archive\./);
  assert.match(searchJs, /async function runSearch\(\)\{if\(!hasQuery\(\)\)\{resetSearch\(\);return\}/);
  assert.match(searchJs, /pagefind\.search\(expandedQuery\(input\.value\),options\)/);
  assert.doesNotMatch(searchJs, /pagefind\.search\(expandedQuery\(input\.value\)\|\|null/);
  assert.match(searchJs, /if\(!hasQuery\(\)\)\{resetSearch\(\);return\}requestNumber\+=1;setSearchLoading\(false\);timer=setTimeout\(runSearch,autoSearchDelay\)/);
  assert.match(searchJs, /hasQuery\(\)\?runSearch\(\):resetSearch\(\);\s*\n\}/);
  assert.match(searchHtml, /class="search-control search-select" data-search-select/);
  assert.match(searchHtml, /role="listbox" aria-labelledby="search-product-label"/);
  assert.match(searchHtml, /data-search-filter="filter" aria-hidden="true" tabindex="-1"/);
  assert.match(searchHtml, /src="\/assets\/products\/entra-id\.svg"/);
  assert.match(searchHtml, /src="\/assets\/topics\/conditional-access\.svg"/);
  assert.match(searchJs, /function syncCustomSelect\(root\)/);
  assert.match(searchJs, /\['ArrowDown','ArrowUp','Enter',' '\]/);
  assert.match(searchJs, /dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/);
  assert.match(siteCss, /@keyframes search-progress/);
  assert.match(siteCss, /\.search-main\.is-searching \.search-results\{opacity:\.42\}/);
  assert.match(siteCss, /\.search-select-trigger\{/);
  assert.match(siteCss, /\.search-select-content\{/);
  assert.match(siteCss, /\.search-select-option\[aria-selected="true"\] \.search-select-check\{opacity:1\}/);
  assert.match(indexHtml, /class="icon-link" href="\/rss\.xml"[^>]*aria-label="Subscribe to the Daily Entra News RSS feed"><img src="\/assets\/ui\/rss\.svg"/);
  assert.match(indexHtml, /class="footer-rss-link"[^>]*href="\/rss\.xml"><img src="\/assets\/ui\/rss\.svg" alt="">Daily RSS<\/a>/);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'rss.svg'))).size > 0, true);
  assert.doesNotMatch(indexHtml, /class="story-time"|class="source-label"/);
  assert.match(indexHtml, /class="product-update-group"/);
  assert.match(indexHtml, /class="landing-intro"/);
  assert.match(indexHtml, /Keep up with Microsoft Entra/);
  assert.match(indexHtml, /Daily AI-generated highlights from Microsoft Learn and Message Center/);
  assert.match(indexHtml, /About this project →/);
  assert.doesNotMatch(indexHtml, /Microsoft Entra changes every day|Learn more about this project/);
  assert.match(dayIndexHtml, /class="landing-intro"/);
  assert.match(dayIndexHtml, /href="\/about\/">About this project →<\/a>/);
  assert.doesNotMatch(dayHtml, /class="landing-intro"|Keep up with Microsoft Entra/);
  for (const html of [indexHtml, dayIndexHtml, dayHtml]) {
    assert.match(html, /Day in brief/);
    assert.match(html, /Configuration monitoring defines a tenant baseline/);
    assert.doesNotMatch(html, /Plain-English daily brief/);
    assert.doesNotMatch(html, /For Entra administrators|class="period-admin-focus"/);
  }
  assert.match(indexHtml, /class="story-description">This readable summary explains the configuration baseline change in full/);
  assert.match(indexHtml, /class="right-rail month-stats-rail period-product-rail day-rail"/);
  assert.match(indexHtml, /Day by product/);
  assert.match(indexHtml, /class="mini-calendar"/);
  assert.match(indexHtml, /aria-label="August 2026 change calendar"/);
  assert.match(indexHtml, /aria-label="1 August 2026, 2 changes"/);
  assert.match(indexHtml, /aria-label="2 August 2026, no changes; showing 1 August"/);
  assert.match(indexHtml, /class="mini-update-dot"/);
  assert.match(siteCss, /\.mini-day\.selected\{[^}]*border-radius:6px/);
  assert.doesNotMatch(indexHtml, /class="mini-count"/);
  assert.match(indexHtml, /class="mini-day outside"[^>]*><span class="mini-day-number">27<\/span>/);
  assert.match(indexHtml, /href="\/day\/2026-08-01\/"/);
  assert.match(indexHtml, /<link rel="canonical" href="https:\/\/daily\.entra\.news\/day\/2026-08-01\/">/);
  assert.match(indexHtml, /href="#product-id-governance"/);
  assert.match(indexHtml, /id="product-id-governance"/);
  assert.match(indexHtml, /class="topic-update-group"/);
  assert.match(dayHtml, /Message Center/);
  assert.match(dayHtml, /href="https:\/\/mc\.merill\.net\/message\/MC100"/);
  assert.match(dayHtml, /MC100 on mc\.merill\.net/);
  assert.match(dayHtml, /Plan for change/);
  assert.doesNotMatch(dayHtml, /planForChange/);
  assert.match(dayHtml, /class="product-group-header"/);
  assert.match(dayHtml, /Configuration monitor guidance added/);
  assert.doesNotMatch(dayHtml, /What changed today/);
  assert.match(dayHtml, /class="story-description">This readable summary explains the configuration baseline change in full/);
  assert.match(dayHtml, /Day by product/);
  assert.match(siteCss, /\.left-rail \.product-list a[^}]*text-decoration:none/);
  assert.match(siteCss, /\.left-rail \.topic-rail \.plain-list a/);
  assert.match(siteCss, /\.detail-aside \.plain-list a/);
  assert.match(siteCss, /\.period-product-rail \.rail-count-list a:hover[^}]*background:var\(--green-soft\)[^}]*box-shadow:inset 3px 0 0 var\(--green\)/);
  assert.match(dayHtml, /class="mini-calendar-grid"/);
  assert.match(dayHtml, /href="#product-id-governance"/);
  assert.match(dayHtml, /class="change-pill nature public-preview">Public preview/);
  assert.match(dayHtml, /class="change-pill action-required">Action required/);
  const unclassifiedDayHtml = await fs.readFile(path.join(websiteDir, 'day', '2026-06-15', 'index.html'), 'utf8');
  assert.match(unclassifiedDayHtml, /class="change-pill updated">Updated/);
  assert.doesNotMatch(unclassifiedDayHtml, /change-pill nature/);
  assert.match(siteCss, /:root\[data-theme="dark"\] \.change-pill\.nature\.public-preview\{/);
  assert.match(dayHtml, /class="change-pill new">New/);
  assert.match(dayHtml, /<time datetime="2026-08-01T08:15:00Z" data-local-day>/);
  assert.match(dayHtml, /class="theme-picker" role="group" aria-label="Color theme"/);
  assert.match(dayHtml, /data-theme-option="light"[^>]*aria-pressed="false"/);
  assert.match(dayHtml, /data-theme-option="dark"[^>]*aria-pressed="false"/);
  assert.equal(dayHtml.indexOf("localStorage.getItem('entra-news-theme')") < dayHtml.indexOf('/assets/site.css'), true);
  assert.match(weekIndexHtml, /data-period-picker="week"/);
  assert.match(weekIndexHtml, /27 July–2 August 2026/);
  assert.match(weekIndexHtml, /class="period-picker-popover"[^>]*role="dialog"/);
  assert.match(weekIndexHtml, /class="period-picker-day outside selected-week"/);
  assert.match(weekIndexHtml, /class="period-picker-update-dot"/);
  assert.match(weekIndexHtml, /<h2 class="rail-heading">Browse weeks<\/h2>/);
  assert.match(weekIndexHtml, /<h2 class="rail-heading">By product<\/h2>/);
  assert.equal((weekIndexHtml.match(/<li(?: class="selected")?><a href="\/week\//g) || []).length, 6);
  assert.match(weekIndexHtml, /<li class="selected"><a href="\/week\/2026-07-27\/" aria-current="page">/);
  assert.equal(weekIndexHtml.indexOf('Browse weeks') < weekIndexHtml.indexOf('By product'), true);
  assert.doesNotMatch(weekIndexHtml, /Week by product/);
  assert.match(weekIndexHtml, /class="period-nav-previous" href="\/week\/2026-07-20\/">← Previous week<\/a>/);
  assert.match(weekIndexHtml, /<span class="period-nav-next"><\/span>/);
  assert.match(weekIndexHtml, /Passkey migration guidance leads the week/);
  assert.match(weekIndexHtml, /For Entra administrators/);
  assert.match(weekIndexHtml, /class="period-key-changes"/);
  assert.match(weekIndexHtml, /class="period-change-taxonomy"><img src="\/assets\/products\/id-governance\.svg" alt=""><img class="topic-icon" src="\/assets\/topics\/governance\.svg" alt=""><span title="ID Governance · Governance">ID Governance · Governance<\/span><\/div><strong><a href="#doc-2026-08-01-create-a-configuration-monitor-01">Migration control documented<\/a><\/strong>/);
  assert.match(weekIndexHtml, /id="doc-2026-08-01-create-a-configuration-monitor-01"/);
  assert.match(siteCss, /\.period-change-heading\{display:block;min-width:0\}/);
  assert.match(siteCss, /\.period-change-taxonomy span\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  assert.match(siteCss, /\.period-change-heading strong a\{[^}]*text-decoration:none/);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'topics', 'conditional-access.svg'))).size > 0, true);
  assert.match(dayHtml, /class="topic-group-title"><img src="\/assets\/topics\/governance\.svg"/);
  assert.match(docDetailHtml, /class="topic-kicker" href="\/topics\/governance\/"><img src="\/assets\/topics\/governance\.svg"/);
  assert.equal((await fs.stat(path.join(websiteDir, 'week', '2026-06-22', 'index.html'))).size > 0, true);
  const emptyWeekHtml = await fs.readFile(path.join(websiteDir, 'week', '2026-06-22', 'index.html'), 'utf8');
  assert.match(emptyWeekHtml, /No tracked updates/);
  assert.match(generator.periodPicker([{ date: '2026-01-02' }], 'week', '2025-12-29'), /29 December 2025–4 January 2026/);
  const matchedPeriodItem = generator.periodChangeTarget(
    { title: 'Passkey migration controls documented', detail: 'Administrators can review the migration opt-out.', product: 'Entra ID' },
    [
      { id: 'unrelated', date: '2026-08-01', title: 'Branding reference', summary: 'CSS examples.', adminImpact: '', product: { slug: 'entra-id', short: 'Entra ID', name: 'Microsoft Entra ID' }, topic: { name: 'Branding' } },
      { id: 'passkey-target', date: '2026-08-01', title: 'Passkey migration opt-out', summary: 'New migration control for administrators.', adminImpact: 'Review the opt-out.', product: { slug: 'entra-id', short: 'Entra ID', name: 'Microsoft Entra ID' }, topic: { name: 'Authentication' } }
    ]
  );
  assert.equal(matchedPeriodItem.id, 'passkey-target');
  const crossPeriodItem = generator.periodChangeTarget(
    { title: 'New Partner Tier1 and Tier2 Support assignments will be blocked', detail: 'New role assignments are being blocked.', product: 'Entra ID' },
    [{ id: 'unrelated', date: '2026-07-01', title: 'Passkey migration', summary: 'Passkey rollout.', adminImpact: '', product: { slug: 'entra-id', short: 'Entra ID', name: 'Microsoft Entra ID' }, topic: { name: 'Authentication' } }],
    [
      { id: 'unrelated', date: '2026-07-01', title: 'Passkey migration', summary: 'Passkey rollout.', adminImpact: '', product: { slug: 'entra-id', short: 'Entra ID', name: 'Microsoft Entra ID' }, topic: { name: 'Authentication' } },
      { id: 'MC-partner', date: '2026-06-30', title: 'Blocking new assignments to Partner Tier1 and Tier2 Support roles', summary: 'New Partner Tier support role assignments will be blocked.', adminImpact: 'Review partner access.', url: '/message-center/MC-partner/', product: { slug: 'entra-id', short: 'Entra ID', name: 'Microsoft Entra ID' }, topic: { name: 'Governance' } }
    ]
  );
  assert.equal(crossPeriodItem.id, 'MC-partner');
  const crossPeriodHtml = generator.renderPeriodBrief({
    headline: 'Partner access changes', overview: 'A role assignment policy is changing.', adminImpact: 'Review partner access.',
    keyChanges: [{ title: 'Partner Tier1 and Tier2 assignments blocked', detail: 'The policy affects new partner assignments.', product: 'Entra ID', sourceId: 'MC-partner' }]
  }, 'Month in brief', [], [{ id: 'MC-partner', url: '/message-center/MC-partner/' }]);
  assert.match(crossPeriodHtml, /<strong><a href="\/message-center\/MC-partner\/">Partner Tier1 and Tier2 assignments blocked<\/a><\/strong>/);
  const weekStepLinks = generator.periodStepLinks([{ date: '2026-01-12' }, { date: '2025-12-29' }], 'week', '2026-01-05');
  assert.match(weekStepLinks.previous, /href="\/week\/2025-12-29\/"/);
  assert.match(weekStepLinks.next, /href="\/week\/2026-01-12\/"/);
  assert.match(monthHtml, /Identity governance and passkeys shape August/);
  assert.match(monthHtml, /For Entra administrators/);
  assert.match(monthHtml, /data-period-picker="month"/);
  assert.match(monthHtml, /<strong><a href="#doc-2026-08-01-create-a-configuration-monitor-01">Configuration baselines expanded<\/a><\/strong>/);
  assert.match(monthHtml, /class="period-picker-month selected" href="\/month\/2026-08\/"/);
  assert.match(monthHtml, /<h2 class="rail-heading">Browse months<\/h2>/);
  assert.equal(monthHtml.indexOf('Browse months') < monthHtml.indexOf('By product'), true);
  assert.doesNotMatch(monthHtml, /<h2 class="rail-heading">By topic<\/h2>/);
  assert.match(monthHtml, /class="period-nav-previous" href="\/month\/2026-07\/">← Previous month<\/a>/);
  assert.match(monthHtml, /<span class="period-nav-next"><\/span>/);
  assert.equal(generator.resolveDayDate([{ date: '2026-08-01' }], '2026-08-04'), '2026-08-01');
  const calendarHtml = generator.miniMonthCalendar([
    { date: '2026-07-31' },
    { date: '2026-08-01' },
    { date: '2026-09-02' }
  ], '2026-08-01');
  assert.match(calendarHtml, /href="\/day\/2026-07-31\/" aria-label="Previous month, July 2026"/);
  assert.match(calendarHtml, /href="\/day\/2026-09-02\/" aria-label="Next month, September 2026"/);
  assert.match(calendarHtml, /class="mini-update-dot"/);
  assert.doesNotMatch(calendarHtml, /class="mini-count"/);
  assert.match(messageDetailHtml, /Related changes/);
  assert.doesNotMatch(docDetailHtml, /For administrators|Source: Microsoft Learn|View daily source report/);
  assert.doesNotMatch(docDetailHtml, /The comparison below keeps the source evidence visible/);
  assert.match(docDetailHtml, /class="summary-grid editorial-summary"/);
  assert.match(docDetailHtml, /<h2 class="section-title">In brief<\/h2><p>This readable summary explains the configuration baseline change in full/);
  assert.match(docDetailHtml, /<h2 class="section-title">What Entra admins need to know<\/h2><p>Entra administrators should compare/);
  assert.match(docDetailHtml, /editorial summary was generated by AI/);
  assert.match(siteCss, /\.editorial-panel p\{[^}]*overflow-wrap:anywhere/);
  assert.match(siteCss, /\.editorial-summary\{[^}]*border-radius:6px;overflow:hidden/);
  assert.match(siteCss, /\.doc-source-intro p\{width:100%;max-width:none/);
  assert.match(siteCss, /@media\(max-width:760px\)\{\.editorial-summary\{display:block;width:100%\}/);
  assert.match(siteCss, /\.theme-option\[aria-pressed="true"\]/);
  assert.match(siteCss, /:root\[data-theme="dark"\]\{color-scheme:dark/);
  assert.match(siteCss, /\.doc-action-link\{font-size:14px\}/);
  assert.match(siteCss, /\.diff-link-icon\{[^}]*background:#a94700[^}]*mask:url\("\/assets\/ui\/compare-items\.svg"\)/);
  assert.match(siteCss, /:root\[data-theme="dark"\] \.diff-link-icon\{background:#ff9b4a\}/);
  assert.doesNotMatch(siteCss, /\.diff-link\{color:#a94700\}/);
  assert.equal((docDetailHtml.match(/doc-action-link/g) || []).length, 4);
  assert.match(docDetailHtml, /class="doc-source-intro"/);
  assert.match(docDetailHtml, /The comparison below shows only the changed extract/);
  assert.doesNotMatch(docDetailHtml, /extract of the Microsoft Learn article showing only the changed content|Open the full article/);
  assert.match(docDetailHtml, /Use the full-page view for complete context/);
  assert.equal((docDetailHtml.match(/View full page diff<\/a>/g) || []).length, 2);
  assert.equal((docDetailHtml.match(/href="https:\/\/mx\.merill\.net\/en-us\/entra\/id-governance\/\?_mx_base=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&amp;_mx_head=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" target="_blank" rel="noopener noreferrer"><span class="diff-link-icon" aria-hidden="true"><\/span>View full page diff<\/a>/g) || []).length, 2);
  assert.equal((docDetailHtml.match(/View on Microsoft Learn<\/a>/g) || []).length, 2);
  assert.doesNotMatch(docDetailHtml, /(?:View full page diff|View on Microsoft Learn) ↗/);
  assert.equal((docDetailHtml.match(/href="https:\/\/learn\.microsoft\.com\/en-us\/entra\/id-governance\/" target="_blank" rel="noopener noreferrer"><img src="\/assets\/ui\/microsoft\.svg" alt="">View on Microsoft Learn<\/a>/g) || []).length, 2);
  assert.doesNotMatch(docDetailHtml, /\/compare\/\?url=/);
  assert.match(docDetailHtml, /data-diff-tab="markdown">Markdown<\/button>/);
  assert.doesNotMatch(docDetailHtml, /Raw Markdown/);
  assert.match(docDetailHtml, /aria-label="Markdown Git diff"/);
  assert.doesNotMatch(messageDetailHtml, /For administrators/);
  assert.match(monthHtml, /August 2026/);
  assert.match(monthHtml, /class="feature period-brief"/);
  assert.match(monthHtml, /class="calendar-count"/);
  assert.match(monthHtml, /class="right-rail month-stats-rail period-product-rail"/);
  assert.match(monthHtml, /href="#product-id-governance"/);
  assert.match(monthHtml, /updates by product/);
  assert.match(monthHtml, /class="product-update-group"/);
  assert.match(monthHtml, /class="story-description">This readable summary explains the configuration baseline change in full/);
  assert.doesNotMatch(monthHtml, /Notable changes|class="two-column"/);
  assert.match(aboutHtml, /Built for the die-hard Microsoft Entra community/);
  assert.match(aboutHtml, /Why it exists/);
  assert.match(aboutHtml, /How it works/);
  assert.match(aboutHtml, /Made for the community/);
  assert.match(aboutHtml, /id="daily-email"/);
  assert.match(aboutHtml, /Get the daily update by email/);
  assert.match(aboutHtml, /Emails are sent only on days with meaningful Microsoft Entra documentation or Message Center updates/);
  assert.match(aboutHtml, /data-kit-form-uid="daily-form-123" data-kit-form-src="https:\/\/daily-entra-news\.kit\.com\/daily-form-123\/index\.js"/);
  assert.doesNotMatch(aboutHtml, /<script async data-uid="daily-form-123"/);
  assert.doesNotMatch(aboutHtml, /Email signup will appear here/);
  assert.match(aboutHtml, /Daily automated AI entries are useful, but nothing beats content created and curated/);
  assert.match(aboutHtml, /insights from Microsoft MVPs and identity subject-matter experts/);
  assert.match(aboutHtml, /practical guidance learned the hard way/);
  assert.match(aboutHtml, /Want to chat about Entra\?/);
  assert.match(aboutHtml, /href="https:\/\/discord\.entra\.news"/);
  assert.match(aboutHtml, /identity admins, architects, MVPs, and other Entra folks/);
  assert.match(aboutHtml, /Join the Entra community on Discord/);
  assert.match(aboutHtml, /Get daily email updates/);
  assert.match(aboutHtml, /Subscribe to the weekly update/);
  assert.match(indexHtml, /href="\/about\/\?subscribe=daily"[^>]*data-daily-email-open[^>]*>Get daily email updates<\/a>/);
  assert.match(docDetailHtml, /href="\/about\/\?subscribe=daily"[^>]*data-daily-email-open[^>]*>Get daily email updates<\/a>/);
  assert.match(messageDetailHtml, /href="\/about\/\?subscribe=daily"[^>]*data-daily-email-open[^>]*>Get daily email updates<\/a>/);
  assert.match(aboutHtml, /<dialog class="daily-email-dialog" id="daily-email-dialog" data-daily-email-dialog/);
  assert.match(aboutHtml, /Get a concise summary of the latest Microsoft Entra updates delivered straight to your inbox/);
  assert.doesNotMatch(aboutHtml, /Receive a concise digest only on days/);
  assert.doesNotMatch(aboutHtml, /subscription=pending|data-daily-email-pending-dialog|Check your inbox/);
  assert.match(siteCss, /\.daily-email-dialog::backdrop/);
  assert.match(siteCss, /\.daily-email-trigger\{/);
  assert.match(siteJs, /document\.createElement\('script'\)/);
  assert.match(siteJs, /consumeDailyEmailSubscribeQuery/);
  assert.doesNotMatch(siteJs, /subscription['"],['"]pending|dailyEmailPendingDialog/);
  assert.match(siteJs, /history\.replaceState\(null,''/);
  assert.match(siteJs, /data-kit-daily-form/);
  assert.doesNotMatch(aboutHtml, /Bookmark|updates are posted daily/);
  assert.match(aboutHtml, /github\.com\/merill\/entra-doc-diff\/issues/);
  assert.match(indexHtml, /href="\/about\/"/);
  assert.match(indexHtml, /data-nav="compare"[^>]*aria-label="View full page diff"/);
  assert.match(compareHtml, /See what changed on a Microsoft Learn page/);
  assert.match(learnDiffJs, /See what changed on a Microsoft Learn page/);
  assert.match(compareHtml, /data-learn-diff-form/);
  assert.match(compareHtml, /data-live-visual-diff/);
  assert.match(compareHtml, /data-live-markdown-diff/);
  assert.match(siteCss, /\.compare-revisions\{[^}]*margin:12px 0 20px/);
  assert.match(siteCss, /\.compare-revision\{[^}]*grid-template-areas:"label commit date" "message message message"[^}]*padding:8px 11px/);
  assert.match(siteCss, /\.compare-revision p\{[^}]*font-size:13px[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  assert.match(compareHtml, /data-diff-navigator/);
  assert.match(compareHtml, /data-diff-previous/);
  assert.match(compareHtml, /data-diff-next/);
  assert.match(compareHtml, /src="\/assets\/ui\/microsoft\.svg" alt=""><span>Microsoft Learn<\/span>/);
  assert.match(compareHtml, /src="\/assets\/ui\/github\.svg" alt=""><span>GitHub<\/span>/);
  assert.match(compareHtml, /src="\/assets\/ui\/chart-history\.svg" alt=""><span>History<\/span>/);
  assert.doesNotMatch(compareHtml, /Optional: use a GitHub token|<details class="compare-token"/);
  assert.match(compareHtml, /placeholder="https:\/\/learn\.microsoft\.com\/en-us\/entra\/identity\/conditional-access\/overview"/);
  assert.doesNotMatch(compareHtml, /docs\.example\.com|The URL must match a source declared in assets\/diff-config\.js/);
  assert.match(compareHtml, /data-github-token-drawer role="dialog" aria-modal="true"/);
  assert.match(compareHtml, /GitHub’s hourly limit was reached/);
  assert.match(compareHtml, /personal-access-tokens\/new/);
  assert.doesNotMatch(indexHtml, /data-github-token-open|data-github-token-drawer/);
  assert.match(compareHtml, /data-github-token-open[^>]*aria-label="Configure GitHub API settings"/);
  assert.match(compareHtml, /src="\/assets\/vendor\/marked\.js"/);
  assert.match(compareHtml, /src="\/assets\/diff-config\.js"/);
  assert.match(diffConfigJs, /repositoryUrl: 'https:\/\/github\.com\/MicrosoftDocs\/entra-docs'/);
  assert.match(diffConfigJs, /repositoryUrl: 'https:\/\/github\.com\/MicrosoftDocs\/azure-docs'/);
  assert.match(diffConfigJs, /repositoryUrl: 'https:\/\/github\.com\/microsoftgraph\/microsoft-graph-docs-contrib'/);
  assert.match(diffConfigJs, /repositoryUrl: 'https:\/\/github\.com\/MicrosoftDocs\/windowsserverdocs'/);
  assert.match(compareHtml, /src="\/assets\/vendor\/diff\.min\.js"/);
  assert.match(compareHtml, /src="\/assets\/vendor\/htmldiff\.js"/);
  assert.match(compareHtml, /src="\/assets\/learn-diff\.js"/);
  assert.match(siteCss, /\.compare-main\{/);
  assert.match(siteCss, /\.diff-navigator\{position:fixed/);
  assert.match(siteCss, /\.diff-navigator\{[^}]*left:50%/);
  assert.match(siteCss, /\.diff-navigator\{[^}]*transform:translateX\(-50%\)/);
  assert.match(siteCss, /:root\[data-compare-view="diff"\] \.compare-hero/);
  assert.match(siteCss, /\.compare-direct-status\{/);
  assert.match(siteCss, /\.compare-supported-sources\{/);
  assert.match(siteCss, /\.compare-callout\{display:none\}/);
  assert.match(learnDiffJs, /querySelector\('\.compare-callout'\)\?\.remove\(\)/);
  assert.match(learnDiffJs, /configured documentation page/);
  assert.match(learnDiffJs, /Supported Microsoft Learn docsets/);
  assert.doesNotMatch(learnDiffJs, /escapeHtml\(author\.name/);
  assert.match(learnDiffJs, /previous\.textContent = '← Previous diff'/);
  assert.match(learnDiffJs, /next\.textContent = 'Next diff →'/);
  assert.match(learnDiffJs, /groupContiguousChangedBlocks/);
  assert.match(learnDiffJs, /change\.dataset\.operationIndex/);
  assert.match(learnDiffJs, /getBoundingClientRect\(\)\.bottom/);
  assert.match(learnDiffJs, /TOKEN_STORAGE_KEY = 'entra-news-github-token'/);
  assert.match(learnDiffJs, /localStorage\.getItem\(TOKEN_STORAGE_KEY\)/);
  assert.doesNotMatch(learnDiffJs, /localStorage\.setItem\(TOKEN_STORAGE_KEY|tokenInput|tokenDetails|compare-token-help/);
  assert.match(learnDiffJs, /shared unauthenticated allowance of 60 API requests per hour/);
  assert.match(learnDiffJs, /github-token-required/);
  assert.match(learnDiffJs, /retryAfterTokenChange/);
  assert.match(siteJs, /GITHUB_TOKEN_STORAGE_KEY='entra-news-github-token'/);
  assert.match(siteJs, /localStorage\.setItem\(GITHUB_TOKEN_STORAGE_KEY,value\)/);
  assert.match(siteJs, /github-token-changed/);
  assert.match(siteJs, /github-token-required/);
  assert.match(learnDiffJs, /pageUrl\.searchParams\.get\('view'\) === 'diff'/);
  assert.match(learnDiffJs, /shareUrl\.searchParams\.set\('view', 'diff'\)/);
  assert.match(learnDiffJs, /shareUrl\.searchParams\.set\('base', comparison\.baseCommit\.sha\)/);
  assert.match(learnDiffJs, /learnLink\.setAttribute\('aria-label', 'Open on Microsoft Learn'\)/);
  assert.doesNotMatch(learnDiffJs, /learnLink\.textContent|githubLink\.textContent/);
  assert.match(learnDiffJs, /shareUrl\.searchParams\.set\('head', comparison\.headCommit\.sha\)/);
  assert.match(indexHtml, /href="https:\/\/maester\.cloud"/);
  assert.match(indexHtml, /class="footer-feature-logo" src="\/assets\/ui\/maester\.png"/);
  assert.match(indexHtml, /Everyone loves using Maester to track their Microsoft Entra and Microsoft 365 tenant security configuration/);
  assert.match(indexHtml, /5\+ years of history, drift detection, and alerts when your posture changes/);
  assert.match(indexHtml, /Graph Permissions Explorer/);
  assert.match(indexHtml, /M365 Message Center Archive/);
  assert.match(indexHtml, /Shout me a cup of coffee/);
  assert.match(indexHtml, /href="https:\/\/github\.com\/sponsors\/merill"/);
  assert.match(indexHtml, /<button class="footer-feedback-button" type="button" data-userjot-feedback>Report an issue or share feedback<\/button>/);
  assert.match(siteJs, /window\.uj\?\.showWidget\(\{section:'feedback'\}\)/);
  assert.doesNotMatch(indexHtml, /Follow Merill on GitHub|href="https:\/\/github\.com\/merill"/);
  assert.match(indexHtml, /href="https:\/\/merill\.net" target="_blank" rel="noopener noreferrer">merill\.net/);
  assert.match(indexHtml, /href="https:\/\/entra\.news" target="_blank" rel="noopener noreferrer"[^>]*><img src="\/assets\/ui\/newspaper\.svg"/);
  assert.match(indexHtml, /href="https:\/\/entra\.chat" target="_blank" rel="noopener noreferrer"[^>]*><img src="\/assets\/ui\/microphone\.svg"/);
  assert.match(indexHtml, /<a class="brand" href="\/">\s*<img class="brand-logo" src="\/assets\/ui\/entra-news-logo\.png" alt="">\s*<span>Daily\.Entra\.News<\/span><\/a>/);
  assert.doesNotMatch(indexHtml, /<small>daily\.entra\.news<\/small>/);
  const headerHtml = indexHtml.match(/<header class="site-header">[\s\S]*?<\/header>/)?.[0] || '';
  assert.doesNotMatch(headerHtml, />Products<\/a>|>Topics<\/a>/);
  assert.match(headerHtml, /href="\/" data-nav="day" aria-current="page"[^>]*>[\s\S]*?<span class="nav-label">Day<\/span>[\s\S]*data-nav="week"[^>]*>[\s\S]*?<span class="nav-label">Week<\/span>[\s\S]*data-nav="month"[^>]*>[\s\S]*?<span class="nav-label">Month<\/span>[\s\S]*data-nav="message-center"[^>]*>[\s\S]*?<span class="nav-label">Message Center<\/span>/);
  const footerHtml = indexHtml.match(/<footer class="footer"[\s\S]*?<\/footer>/)?.[0] || '';
  const footerLinks = footerHtml.match(/<a\b[^>]*>/g) || [];
  assert.equal(footerLinks.length > 0, true);
  assert.equal(footerLinks.every(link => /target="_blank"/.test(link) && /rel="noopener noreferrer"/.test(link)), true);
  assert.match(indexHtml, /Last refreshed <time data-refresh-last>checking…<\/time>/);
  assert.match(indexHtml, /Next refresh <span class="refresh-relative" data-refresh-next>within six hours<\/span>/);
  assert.match(await fs.readFile(path.join(websiteDir, 'assets', 'site.js'), 'utf8'), /fetch\('\/refresh-status\.json',\{cache:'no-store'\}\)/);
  assert.match(siteJs, /function nextRefreshSlot/);
  assert.doesNotMatch(indexHtml, /Next refresh <time|UTC|GMT/);
  const refreshStatus = JSON.parse(await fs.readFile(path.join(websiteDir, 'refresh-status.json'), 'utf8'));
  assert.equal(refreshStatus.nextScheduledAt, '2026-08-04T14:15:00.000Z');
  assert.match(siteJs, /Intl\.DateTimeFormat/);
  assert.doesNotMatch(siteJs, /timeZoneName/);
  assert.match(siteJs, /data-local-day/);
  assert.match(siteJs, /hours ago|'in '/);
  assert.match(siteJs, /data-period-picker/);
  assert.match(siteJs, /event\.composedPath\(\)\.includes\(root\)/);
  assert.match(siteJs, /event\.key!==['"]Escape['"]/);
  assert.match(siteJs, /aria-expanded/);
  assert.match(siteJs, /localStorage\.setItem\(THEME_STORAGE_KEY,value\)/);
  assert.match(siteJs, /data-theme-option/);
  assert.equal((await fs.stat(path.join(websiteDir, 'favicon.ico'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'og-image.png'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'newspaper.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'microphone.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'entra-news-logo.png'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'maester.png'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'book-bookmark.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'calendar-days.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'chevron-down.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'chevron-right.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'microsoft.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'github.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'chart-history.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'learn-diff.js'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'vendor', 'marked.js'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'vendor', 'diff.min.js'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'vendor', 'htmldiff.js'))).size > 0, true);
  await assert.rejects(fs.stat(path.join(websiteDir, '2026-07-31.html')), { code: 'ENOENT' });
  assert.equal((await fs.readFile(path.join(websiteDir, 'CNAME'), 'utf8')).trim(), 'daily.entra.news');
});

test('the workflow builds the site unconditionally and forwards the UserJot variable', async () => {
  const workflow = await fs.readFile(path.join(__dirname, '..', '.github', 'workflows', 'daily-docs-monitor.yml'), 'utf8');
  assert.equal((workflow.match(/USERJOT_PROJECT_ID: \$\{\{ vars\.USERJOT_PROJECT_ID \}\}/g) || []).length, 2);
  // The site must rebuild even when no briefs were generated, so a rendering
  // change reaches the site on the next run rather than the next brief.
  assert.match(workflow, /- name: Build the static site through the latest refresh date\n\s+env:[\s\S]*?run: npm run build:site/);
  assert.doesNotMatch(workflow, /- name: Build the static site through the latest refresh date\n\s+if:/);
});
