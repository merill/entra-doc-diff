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
  formattedDiff
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
  const metadata = extractMarkdownMetadata('diff --git a/a b/a\n+title: Create a configuration monitor\n+description: Evaluate a tenant against a known-good configuration baseline\n+# Create a configuration monitor', 'docs/test.md');
  assert.equal(metadata.title, 'Create a configuration monitor');
  assert.match(metadata.description, /known-good configuration baseline/);
});

test('Message Center HTML sanitizer removes active content and event handlers', () => {
  const result = sanitizeMcHtml('<p onclick="alert(1)">Hello <a href="https://example.com">world</a></p><script>alert(2)</script><img src="x">');
  assert.doesNotMatch(result, /script|onclick|<img/i);
  assert.match(result, /rel="noopener noreferrer"/);
});

test('formatted diff renders added and removed document content', () => {
  const result = formattedDiff('@@ -1 +1 @@\n-# Old heading\n+# New heading\n+[Learn more](/entra/identity/example)');
  assert.match(result, /class="rendered-change removed"/);
  assert.match(result, /<h1>Old heading<\/h1>/);
  assert.match(result, /class="rendered-change added"/);
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
  assert.match(result, /class="diff-row removed"/);
  assert.match(result, /class="diff-row added"/);
});

test('formatted diff renders every Microsoft Learn alert type', () => {
  for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'CAUTION', 'WARNING']) {
    const result = formattedDiff(`@@ -1 +1 @@\n+> [!${type}]\n+> Alert content`);
    assert.match(result, new RegExp(`class="learn-alert learn-alert-${type.toLowerCase()} diff-added"`));
    assert.match(result, new RegExp(`<span>${type.charAt(0)}${type.slice(1).toLowerCase()}<\\/span>`));
    assert.doesNotMatch(result, new RegExp(`\\[!${type}\\]`));
  }
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
      publicDocsUrl: 'https://learn.microsoft.com/en-us/entra/id-governance/'
    }]
  }));
  await fs.writeFile(path.join(mcDataPath, 'messages.json'), JSON.stringify([]));
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
  const dayHtml = await fs.readFile(path.join(websiteDir, 'day', '2026-08-01', 'index.html'), 'utf8');
  const monthHtml = await fs.readFile(path.join(websiteDir, 'month', '2026-08', 'index.html'), 'utf8');
  const docDetailHtml = await fs.readFile(path.join(websiteDir, 'changes', '2026-08-01', 'create-a-configuration-monitor-01', 'index.html'), 'utf8');
  const messageDetailHtml = await fs.readFile(path.join(websiteDir, 'message-center', 'MC100', 'index.html'), 'utf8');
  const aboutHtml = await fs.readFile(path.join(websiteDir, 'about', 'index.html'), 'utf8');
  const siteJs = await fs.readFile(path.join(websiteDir, 'assets', 'site.js'), 'utf8');
  assert.match(indexHtml, /Entra\.News Daily/);
  assert.match(indexHtml, /<link rel="icon" href="\/favicon\.ico" sizes="any">/);
  assert.match(indexHtml, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png">/);
  assert.match(indexHtml, /property="og:image" content="https:\/\/daily\.entra\.news\/og-image\.png"/);
  assert.match(indexHtml, /property="og:image:width" content="1200"/);
  assert.match(indexHtml, /property="og:image:height" content="630"/);
  assert.match(indexHtml, /name="twitter:card" content="summary_large_image"/);
  assert.match(indexHtml, /href="https:\/\/merill\.net"/);
  assert.doesNotMatch(indexHtml, /class="story-time"|class="source-label"/);
  assert.match(indexHtml, /class="product-update-group"/);
  assert.match(indexHtml, /class="right-rail month-stats-rail period-product-rail"/);
  assert.match(indexHtml, /Week by product/);
  assert.match(indexHtml, /href="#product-id-governance"/);
  assert.match(indexHtml, /id="product-id-governance"/);
  assert.match(indexHtml, /class="topic-update-group"/);
  assert.match(dayHtml, /Message Center/);
  assert.match(dayHtml, /href="https:\/\/mc\.merill\.net\/message\/MC100"/);
  assert.match(dayHtml, /MC100 on mc\.merill\.net/);
  assert.match(dayHtml, /Plan for change/);
  assert.doesNotMatch(dayHtml, /planForChange/);
  assert.match(dayHtml, /class="product-group-header"/);
  assert.match(dayHtml, /Day by product/);
  assert.match(dayHtml, /href="#product-id-governance"/);
  assert.match(dayHtml, /class="change-pill updated">Updated/);
  assert.match(dayHtml, /class="change-pill new">New/);
  assert.match(dayHtml, /<time datetime="2026-08-01T08:15:00Z" data-local-day>/);
  assert.match(messageDetailHtml, /Related changes/);
  assert.doesNotMatch(docDetailHtml, /For administrators|Source: Microsoft Learn/);
  assert.doesNotMatch(docDetailHtml, /The comparison below keeps the source evidence visible/);
  assert.doesNotMatch(messageDetailHtml, /For administrators/);
  assert.match(monthHtml, /August 2026/);
  assert.match(monthHtml, /class="month-overview compact"/);
  assert.match(monthHtml, /class="calendar-count"/);
  assert.match(monthHtml, /class="right-rail month-stats-rail"/);
  assert.match(monthHtml, /href="#product-id-governance"/);
  assert.match(monthHtml, /updates by product/);
  assert.match(monthHtml, /class="product-update-group"/);
  assert.doesNotMatch(monthHtml, /Notable changes|class="two-column"/);
  assert.match(aboutHtml, /Built for the die-hard Microsoft Entra community/);
  assert.match(aboutHtml, /Why it exists/);
  assert.match(aboutHtml, /How it works/);
  assert.match(aboutHtml, /Made for the community/);
  assert.match(aboutHtml, /Entra\.News.*weekly briefing for Microsoft Entra/);
  assert.match(aboutHtml, /Bookmark.*daily\.entra\.news/);
  assert.match(aboutHtml, /href="https:\/\/discord\.entra\.news"/);
  assert.match(aboutHtml, /updates are posted daily/);
  assert.match(aboutHtml, /github\.com\/merill\/entra-doc-diff\/issues/);
  assert.match(indexHtml, /href="\/about\/"/);
  assert.match(indexHtml, /href="https:\/\/maester\.cloud"/);
  assert.match(indexHtml, /Graph Permissions Explorer/);
  assert.match(indexHtml, /M365 Message Center Archive/);
  assert.match(indexHtml, /Shout me a cup of coffee/);
  assert.match(indexHtml, /href="https:\/\/github\.com\/sponsors\/merill"/);
  assert.doesNotMatch(indexHtml, /Follow Merill on GitHub|href="https:\/\/github\.com\/merill"/);
  assert.match(indexHtml, /href="https:\/\/merill\.net" target="_blank" rel="noopener noreferrer">merill\.net/);
  assert.match(indexHtml, /href="https:\/\/entra\.news" target="_blank" rel="noopener noreferrer"[^>]*><img src="\/assets\/ui\/newspaper\.svg"/);
  assert.match(indexHtml, /href="https:\/\/entra\.chat" target="_blank" rel="noopener noreferrer"[^>]*><img src="\/assets\/ui\/microphone\.svg"/);
  const footerHtml = indexHtml.match(/<footer class="footer"[\s\S]*?<\/footer>/)?.[0] || '';
  const footerLinks = footerHtml.match(/<a\b[^>]*>/g) || [];
  assert.equal(footerLinks.length > 0, true);
  assert.equal(footerLinks.every(link => /target="_blank"/.test(link) && /rel="noopener noreferrer"/.test(link)), true);
  assert.match(indexHtml, /Last refreshed <time datetime="2026-08-04T09:00:00\.000Z" data-local-datetime>/);
  assert.match(indexHtml, /Next refresh <time datetime="2026-08-05T08:15:00\.000Z" data-local-datetime>/);
  assert.match(indexHtml, /data-relative-time="2026-08-04T09:00:00\.000Z"/);
  assert.match(siteJs, /Intl\.DateTimeFormat/);
  assert.match(siteJs, /data-local-day/);
  assert.match(siteJs, /hours ago|'in '/);
  assert.equal((await fs.stat(path.join(websiteDir, 'favicon.ico'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'og-image.png'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'newspaper.svg'))).size > 0, true);
  assert.equal((await fs.stat(path.join(websiteDir, 'assets', 'ui', 'microphone.svg'))).size > 0, true);
  assert.equal((await fs.readFile(path.join(websiteDir, 'CNAME'), 'utf8')).trim(), 'daily.entra.news');
});
