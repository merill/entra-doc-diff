const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const {
  StaticSiteGenerator,
  isEntraMessage,
  classifyProduct,
  extractMarkdownMetadata,
  selectRelatedItems,
  sanitizeMcHtml,
  formattedDiff,
  renderMarkdownDiff
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
      publicDocsUrl: 'https://learn.microsoft.com/en-us/entra/id-governance/',
      englishSummary: {
        summary: 'This readable summary explains the configuration baseline change in full so administrators can understand the update before opening the source diff.',
        adminImpact: 'Entra administrators should compare the documented baseline with their tenant configuration and investigate unexpected drift.'
      }
    }]
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
    weeks: {
      '2026-07-27': {
        headline: 'Passkey migration guidance leads the week',
        overview: 'The week introduced concrete migration controls and configuration guidance for Entra administrators.',
        adminImpact: 'Review the new opt-out behavior before planning migration.',
        keyChanges: [{ title: 'Migration control documented', detail: 'Administrators can assess the new behavior before rollout.', product: 'Entra ID' }]
      }
    },
    months: {
      '2026-08': {
        headline: 'Identity governance and passkeys shape August',
        overview: 'August documentation focused on configuration baselines and migration controls.',
        adminImpact: 'Compare the new guidance with current tenant configuration.',
        keyChanges: [{ title: 'Configuration baselines expanded', detail: 'New guidance explains how to evaluate configuration drift.', product: 'ID Governance' }]
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
  const generator = new StaticSiteGenerator({ websiteDir, mcDataPath, detailDays: 60, generatedAt: '2026-08-04T09:00:00Z' });
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
  const siteCss = await fs.readFile(path.join(websiteDir, 'assets', 'site.css'), 'utf8');
  const siteJs = await fs.readFile(path.join(websiteDir, 'assets', 'site.js'), 'utf8');
  assert.match(indexHtml, /Entra\.News Daily/);
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
    assert.match(html, /Microsoft Entra daily update/);
    assert.doesNotMatch(html, /Plain-English daily brief/);
  }
  assert.match(indexHtml, /class="story-description">This readable summary explains the configuration baseline change in full/);
  assert.match(indexHtml, /class="right-rail month-stats-rail period-product-rail day-rail"/);
  assert.match(indexHtml, /Day by product/);
  assert.match(indexHtml, /class="mini-calendar"/);
  assert.match(indexHtml, /aria-label="August 2026 change calendar"/);
  assert.match(indexHtml, /aria-label="1 August 2026, 2 changes"/);
  assert.match(indexHtml, /aria-label="2 August 2026, no changes; showing 1 August"/);
  assert.match(indexHtml, /class="mini-update-dot"/);
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
  assert.match(dayHtml, /What changed on this day/);
  assert.doesNotMatch(dayHtml, /What changed today/);
  assert.match(dayHtml, /class="story-description">This readable summary explains the configuration baseline change in full/);
  assert.match(dayHtml, /Day by product/);
  assert.match(dayHtml, /class="mini-calendar-grid"/);
  assert.match(dayHtml, /href="#product-id-governance"/);
  assert.match(dayHtml, /class="change-pill updated">Updated/);
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
  assert.match(weekIndexHtml, /class="period-key-changes"/);
  assert.match(weekIndexHtml, /class="period-change-heading"><span title="Entra ID">Entra ID<\/span><strong>Migration control documented<\/strong>/);
  assert.match(siteCss, /\.period-change-heading\{display:block;min-width:0\}/);
  assert.match(siteCss, /\.period-change-heading span\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  assert.equal((await fs.stat(path.join(websiteDir, 'week', '2026-06-22', 'index.html'))).size > 0, true);
  const emptyWeekHtml = await fs.readFile(path.join(websiteDir, 'week', '2026-06-22', 'index.html'), 'utf8');
  assert.match(emptyWeekHtml, /No tracked updates/);
  assert.match(generator.periodPicker([{ date: '2026-01-02' }], 'week', '2025-12-29'), /29 December 2025–4 January 2026/);
  const weekStepLinks = generator.periodStepLinks([{ date: '2026-01-12' }, { date: '2025-12-29' }], 'week', '2026-01-05');
  assert.match(weekStepLinks.previous, /href="\/week\/2025-12-29\/"/);
  assert.match(weekStepLinks.next, /href="\/week\/2026-01-12\/"/);
  assert.match(monthHtml, /Identity governance and passkeys shape August/);
  assert.match(monthHtml, /For Entra administrators/);
  assert.match(monthHtml, /data-period-picker="month"/);
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
  assert.match(docDetailHtml, /class="doc-source-intro"/);
  assert.match(docDetailHtml, /extract of the Microsoft Learn article showing only the changed content/);
  assert.match(docDetailHtml, /<a href="https:\/\/learn\.microsoft\.com\/en-us\/entra\/id-governance\/" target="_blank" rel="noopener noreferrer">Open the full article<\/a> for complete context/);
  assert.match(docDetailHtml, /href="https:\/\/learn\.microsoft\.com\/en-us\/entra\/id-governance\/" target="_blank" rel="noopener noreferrer"/);
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
  assert.match(aboutHtml, /Daily automated AI entries are useful, but nothing beats content created and curated/);
  assert.match(aboutHtml, /insights from Microsoft MVPs and identity subject-matter experts/);
  assert.match(aboutHtml, /practical guidance learned the hard way/);
  assert.match(aboutHtml, /Want to chat about Entra\?/);
  assert.match(aboutHtml, /href="https:\/\/discord\.entra\.news"/);
  assert.match(aboutHtml, /identity admins, architects, MVPs, and other Entra folks/);
  assert.match(aboutHtml, /Join the Entra community on Discord/);
  assert.doesNotMatch(aboutHtml, /Bookmark|updates are posted daily/);
  assert.match(aboutHtml, /github\.com\/merill\/entra-doc-diff\/issues/);
  assert.match(indexHtml, /href="\/about\/"/);
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
  assert.match(headerHtml, /href="\/" aria-current="page">Day<\/a>[\s\S]*href="\/week\/">Week<\/a>[\s\S]*>Month<\/a>[\s\S]*>Message Center<\/a>/);
  const footerHtml = indexHtml.match(/<footer class="footer"[\s\S]*?<\/footer>/)?.[0] || '';
  const footerLinks = footerHtml.match(/<a\b[^>]*>/g) || [];
  assert.equal(footerLinks.length > 0, true);
  assert.equal(footerLinks.every(link => /target="_blank"/.test(link) && /rel="noopener noreferrer"/.test(link)), true);
  assert.match(indexHtml, /Last refreshed <time datetime="2026-08-04T09:00:00\.000Z" data-local-datetime>/);
  assert.match(indexHtml, /Next refresh <span class="refresh-relative" data-relative-time="2026-08-05T08:15:00\.000Z">in 24 hours<\/span>/);
  assert.doesNotMatch(indexHtml, /Next refresh <time|UTC|GMT/);
  assert.match(indexHtml, /data-relative-time="2026-08-04T09:00:00\.000Z"/);
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
  await assert.rejects(fs.stat(path.join(websiteDir, '2026-07-31.html')), { code: 'ENOENT' });
  assert.equal((await fs.readFile(path.join(websiteDir, 'CNAME'), 'utf8')).trim(), 'daily.entra.news');
});
