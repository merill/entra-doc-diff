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
  countChangedLines,
  loadComparison,
  groupContiguousChangedBlocks
} = require('../assets/site/learn-diff');

test('commit URL parameters accept an exact pair or a head whose parent can be resolved', () => {
  assert.deepEqual(
    commitRefsFromSearchParams(new URLSearchParams('base=9152e77&head=4994b15')),
    { base: '9152e77', head: '4994b15' }
  );
  assert.deepEqual(
    commitRefsFromSearchParams(new URLSearchParams('head=4994b15')),
    { base: null, head: '4994b15' }
  );
  assert.equal(commitRefsFromSearchParams(new URLSearchParams()), null);
  assert.throws(
    () => commitRefsFromSearchParams(new URLSearchParams('base=9152e77')),
    /requires a head commit/
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

test('exact comparison resolves a missing base parameter and treats a missing file revision as empty', async () => {
  const originalFetch = global.fetch;
  const head = 'b'.repeat(40);
  const base = 'a'.repeat(40);
  global.fetch = async endpoint => {
    const url = String(endpoint);
    if (url.endsWith(`/commits/${head}`)) return new Response(JSON.stringify({ sha: head, parents: [{ sha: base }] }), { status: 200 });
    if (url.endsWith(`/commits/${base}`)) return new Response(JSON.stringify({ sha: base, parents: [] }), { status: 200 });
    if (url.includes(`/contents/docs/example.md?ref=${base}`)) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    if (url.includes(`/contents/docs/example.md?ref=${head}`)) return new Response('# New file\n', { status: 200 });
    return new Response(JSON.stringify({ message: 'Unexpected request' }), { status: 500 });
  };
  try {
    const result = await loadComparison({ apiRoot: 'https://api.github.com/repos/example/docs', path: 'docs/example.md' }, '', null, { base: null, head });
    assert.equal(result.baseCommit.sha, base);
    assert.equal(result.headCommit.sha, head);
    assert.equal(result.before, '');
    assert.equal(result.after, '# New file\n');
  } finally {
    global.fetch = originalFetch;
  }
});

test('GitHub hourly limits explain the shared allowance and request a token', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
    status: 403,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1785909600'
    }
  });
  try {
    await assert.rejects(
      loadComparison({ apiRoot: 'https://api.github.com/repos/example/docs', path: 'docs/example.md' }, '', null, { base: 'a'.repeat(40), head: 'b'.repeat(40) }),
      error => {
        assert.equal(error.rateLimited, true);
        assert.match(error.message, /shared unauthenticated allowance of 60 API requests per hour/);
        assert.match(error.message, /Add a GitHub token/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
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

test('diff navigator groups adjacent blocks from one continuous edit', () => {
  const first = { id: 'first' };
  const second = { id: 'second' };
  const separate = { id: 'separate' };
  const continuation = { id: 'continuation' };
  const groups = groupContiguousChangedBlocks([
    { block: first, operations: new Set(['53']) },
    { block: second, operations: new Set(['53']) },
    { block: separate, operations: new Set(['55']) },
    { block: continuation, operations: new Set(['55', '57']) }
  ]);
  assert.deepEqual(groups, [[first, second], [separate, continuation]]);
});
