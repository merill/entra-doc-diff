const test = require('node:test');
const assert = require('node:assert/strict');
const diffConfig = require('../assets/site/diff-config');
const {
  learnUrlToRepoInfo,
  siteUrlToRepoInfo,
  commitRefsFromSearchParams,
  githubFileUrl,
  extractTitle,
  stripFrontMatter,
  countChangedLines
} = require('../assets/site/learn-diff');

test('commit URL parameters require and return an exact base/head pair', () => {
  assert.deepEqual(
    commitRefsFromSearchParams(new URLSearchParams('base=9152e77&head=4994b15')),
    { base: '9152e77', head: '4994b15' }
  );
  assert.equal(commitRefsFromSearchParams(new URLSearchParams()), null);
  assert.throws(
    () => commitRefsFromSearchParams(new URLSearchParams('head=4994b15')),
    /both base and head/
  );
  assert.throws(
    () => commitRefsFromSearchParams(new URLSearchParams('base=not-a-sha&head=4994b15')),
    /Git commit SHAs/
  );
  assert.throws(
    () => commitRefsFromSearchParams(new URLSearchParams('base=4994b15&head=4994b15')),
    /must be different/
  );
});

test('Entra Learn URLs map to their public entra-docs source path', () => {
  const info = learnUrlToRepoInfo('https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview?tabs=portal#overview');
  assert.equal(info.learnUrl, 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview');
  assert.equal(info.path, 'docs/identity/conditional-access/overview.md');
  assert.equal(info.githubUrl, 'https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/overview.md');
  assert.equal(info.historyUrl, 'https://github.com/MicrosoftDocs/entra-docs/commits/main/docs/identity/conditional-access/overview.md');
  assert.equal(githubFileUrl(info, 'abc123'), 'https://github.com/MicrosoftDocs/entra-docs/blob/abc123/docs/identity/conditional-access/overview.md');
});

test('URL mapper accepts locale-free and localized Learn URLs but rejects other hosts', () => {
  assert.equal(
    learnUrlToRepoInfo('https://learn.microsoft.com/entra/workload-id/workload-identity-federation').path,
    'docs/workload-id/workload-identity-federation.md'
  );
  assert.equal(
    learnUrlToRepoInfo('https://learn.microsoft.com/fr-fr/entra/id-governance/identity-governance-overview.html').path,
    'docs/id-governance/identity-governance-overview.md'
  );
  assert.throws(() => learnUrlToRepoInfo('https://example.com/en-us/entra/identity/example'), /No configured documentation source/);
  assert.throws(() => learnUrlToRepoInfo('https://learn.microsoft.com/en-us/azure/example'), /No configured documentation source/);
});

test('declarative source config maps another documentation site to its GitHub repository', () => {
  const info = siteUrlToRepoInfo('https://docs.example.com/en-us/guide/getting-started.html?tab=one', [{
    id: 'example-docs',
    label: 'Example Docs',
    siteUrl: 'https://docs.example.com/guide/',
    stripLocale: true,
    repositoryUrl: 'https://github.com/example/docs',
    repositoryPathPrefix: 'content',
    defaultBranch: 'trunk',
    fileExtension: '.md'
  }]);
  assert.equal(info.publicUrl, 'https://docs.example.com/en-us/guide/getting-started.html');
  assert.equal(info.path, 'content/getting-started.md');
  assert.equal(info.repository, 'example/docs');
  assert.equal(info.apiRoot, 'https://api.github.com/repos/example/docs');
  assert.equal(info.githubUrl, 'https://github.com/example/docs/blob/trunk/content/getting-started.md');
});

test('static Microsoft Learn source list maps representative articles to their public repositories', () => {
  const examples = [
    ['https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview', 'MicrosoftDocs/entra-docs', 'docs/identity/conditional-access/overview.md', 'main'],
    ['https://learn.microsoft.com/en-us/azure/azure-functions/functions-overview', 'MicrosoftDocs/azure-docs', 'articles/azure-functions/functions-overview.md', 'main'],
    ['https://learn.microsoft.com/en-us/dotnet/core/introduction', 'dotnet/docs', 'docs/core/introduction.md', 'main'],
    ['https://learn.microsoft.com/en-us/powershell/scripting/overview', 'MicrosoftDocs/PowerShell-Docs', 'reference/docs-conceptual/overview.md', 'main'],
    ['https://learn.microsoft.com/en-us/microsoft-365/admin/setup/setup', 'MicrosoftDocs/microsoft-365-docs', 'microsoft-365/admin/setup/setup.md', 'public'],
    ['https://learn.microsoft.com/en-us/mem/intune/fundamentals/what-is-intune', 'MicrosoftDocs/memdocs', 'intune/fundamentals/what-is-intune.md', 'main'],
    ['https://learn.microsoft.com/en-us/fabric/get-started/microsoft-fabric-overview', 'MicrosoftDocs/fabric-docs', 'docs/fundamentals/microsoft-fabric-overview.md', 'main'],
    ['https://learn.microsoft.com/en-us/dynamics365/get-started/intro-crossapp-index', 'MicrosoftDocs/dynamics365hubpages', 'dynamics365/get-started/intro-crossapp-index.md', 'live'],
    ['https://learn.microsoft.com/en-us/sql/sql-server/what-s-new-in-sql-server-2025?view=sql-server-ver17', 'MicrosoftDocs/sql-docs', 'docs/sql-server/what-s-new-in-sql-server-2025.md', 'live'],
    ['https://learn.microsoft.com/en-us/graph/overview', 'microsoftgraph/microsoft-graph-docs-contrib', 'concepts/overview.md', 'main'],
    ['https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0', 'microsoftgraph/microsoft-graph-docs-contrib', 'api-reference/v1.0/api/user-get.md', 'main'],
    ['https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-beta', 'microsoftgraph/microsoft-graph-docs-contrib', 'api-reference/beta/api/user-get.md', 'main'],
    ['https://learn.microsoft.com/en-us/visualstudio/ide/whats-new-visual-studio-2022', 'MicrosoftDocs/visualstudio-docs', 'docs/ide/whats-new-visual-studio-2022.md', 'main'],
    ['https://learn.microsoft.com/en-us/aspnet/core/introduction-to-aspnet-core', 'dotnet/AspNetCore.Docs', 'aspnetcore/overview.md', 'main'],
    ['https://learn.microsoft.com/en-us/windows-server/get-started/overview', 'MicrosoftDocs/windowsserverdocs', 'WindowsServerDocs/get-started/overview.md', 'main']
  ];

  for (const [url, repository, path, branch] of examples) {
    const info = siteUrlToRepoInfo(url, diffConfig.sources);
    assert.equal(info.repository, repository, url);
    assert.equal(info.path, path, url);
    assert.equal(info.defaultBranch, branch, url);
  }
});

test('query-specific sources take priority and keep required parameters in share URLs', () => {
  const info = siteUrlToRepoInfo(
    'https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-beta&tabs=http',
    diffConfig.sources
  );
  assert.equal(info.path, 'api-reference/beta/api/user-get.md');
  assert.equal(info.publicUrl, 'https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-beta');
});

test('client helpers keep front matter out of the visual page and count line changes', () => {
  const markdown = '---\ntitle: "Conditional Access overview"\n---\n# Heading\nBody\n';
  assert.equal(extractTitle(markdown, 'fallback'), 'Conditional Access overview');
  assert.equal(stripFrontMatter(markdown), '# Heading\nBody\n');
  assert.deepEqual(countChangedLines([
    { value: 'same\n', count: 1 },
    { value: 'old\nline\n', count: 2, removed: true },
    { value: 'new\n', count: 1, added: true }
  ]), { additions: 1, deletions: 2 });
});
