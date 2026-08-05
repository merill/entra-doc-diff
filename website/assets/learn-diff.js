(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EntraLearnDiff = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const TOKEN_STORAGE_KEY = 'entra-news-github-token';
  const DEFAULT_SOURCES = [{
    id: 'entra-learn',
    label: 'Microsoft Entra Learn',
    siteUrl: 'https://learn.microsoft.com/entra/',
    stripLocale: true,
    repositoryUrl: 'https://github.com/MicrosoftDocs/entra-docs',
    repositoryPathPrefix: 'docs',
    defaultBranch: 'main',
    fileExtension: '.md'
  }];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
  }

  function configuredSources() {
    const supplied = root.DOC_DIFF_CONFIG?.sources;
    return Array.isArray(supplied) && supplied.length ? supplied : DEFAULT_SOURCES;
  }

  function siteUrlToRepoInfo(value, sourceConfigs = configuredSources()) {
    let url;
    try {
      url = new URL(String(value || '').trim());
    } catch {
      throw new Error('Enter a complete documentation URL, including https://.');
    }
    if (url.protocol !== 'https:') throw new Error('Documentation URLs must use https://.');
    const inputSegments = url.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
    let match = null;
    for (const source of sourceConfigs) {
      let site;
      let repository;
      try {
        site = new URL(source.siteUrl);
        repository = new URL(source.repositoryUrl);
      } catch {
        continue;
      }
      if (site.protocol !== 'https:' || site.hostname.toLowerCase() !== url.hostname.toLowerCase()) continue;
      if (repository.protocol !== 'https:' || repository.hostname.toLowerCase() !== 'github.com') continue;
      const requiredQuery = source.query && typeof source.query === 'object' ? source.query : {};
      if (Object.entries(requiredQuery).some(([name, expected]) => url.searchParams.get(name) !== String(expected))) continue;
      const segments = [...inputSegments];
      if (source.stripLocale && /^[a-z]{2}-[a-z]{2}$/i.test(segments[0] || '')) segments.shift();
      const prefix = site.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
      if (!prefix.every((segment, index) => segments[index]?.toLowerCase() === segment.toLowerCase())) continue;
      const articleSegments = segments.slice(prefix.length);
      if (!articleSegments.length || articleSegments.some(segment => segment === '.' || segment === '..')) continue;
      match = { source, site, repository, articleSegments, requiredQuery };
      break;
    }
    if (!match) {
      throw new Error(`No configured documentation source matches ${url.hostname}${url.pathname}.`);
    }
    const { source, site, repository, articleSegments, requiredQuery } = match;
    const finalIndex = articleSegments.length - 1;
    articleSegments[finalIndex] = articleSegments[finalIndex].replace(/\.(?:mdx?|html?)$/i, '');
    if (!articleSegments[finalIndex]) throw new Error('Use a documentation article URL, not a section landing page.');
    const repositoryParts = repository.pathname.split('/').filter(Boolean);
    if (repositoryParts.length !== 2) throw new Error(`The repositoryUrl for ${source.label || source.id || 'this source'} must identify one GitHub repository.`);
    const [owner, repo] = repositoryParts;
    const repositoryPathPrefix = String(source.repositoryPathPrefix || '').replace(/^\/+|\/+$/g, '');
    const fileExtension = String(source.fileExtension || '.md').startsWith('.') ? String(source.fileExtension || '.md') : `.${source.fileExtension}`;
    const articlePath = articleSegments.join('/');
    const mappedArticlePath = String(source.pathAliases?.[articlePath] || articlePath).replace(/^\/+|\/+$/g, '');
    const mappedSegments = mappedArticlePath.split('/').filter(Boolean);
    if (!mappedSegments.length || mappedSegments.some(segment => segment === '.' || segment === '..')) {
      throw new Error(`The configured path mapping for ${source.label || source.id || 'this source'} is invalid.`);
    }
    const repoPath = [repositoryPathPrefix, `${mappedSegments.join('/')}${fileExtension}`].filter(Boolean).join('/');
    const defaultBranch = source.defaultBranch || 'main';
    const githubRoot = `https://github.com/${owner}/${repo}`;
    const preservedQuery = new URLSearchParams();
    for (const name of Object.keys(requiredQuery)) preservedQuery.set(name, url.searchParams.get(name));
    const publicUrl = `${url.origin}${url.pathname.replace(/\/$/, '')}${preservedQuery.size ? `?${preservedQuery}` : ''}`;
    return {
      sourceId: source.id || `${owner}/${repo}`,
      sourceLabel: source.label || site.hostname,
      publicUrl,
      learnUrl: publicUrl,
      siteRoot: site.href.endsWith('/') ? site.href : `${site.href}/`,
      owner,
      repo,
      repository: `${owner}/${repo}`,
      defaultBranch,
      path: repoPath,
      apiRoot: `https://api.github.com/repos/${owner}/${repo}`,
      githubRoot,
      githubUrl: `${githubRoot}/blob/${encodeURIComponent(defaultBranch)}/${repoPath}`,
      historyUrl: `${githubRoot}/commits/${encodeURIComponent(defaultBranch)}/${repoPath}`
    };
  }

  const learnUrlToRepoInfo = siteUrlToRepoInfo;

  function githubFileUrl(info, ref) {
    return `${info.githubRoot}/blob/${encodeURIComponent(ref || info.defaultBranch || 'main')}/${info.path.split('/').map(encodeURIComponent).join('/')}`;
  }

  function apiPath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function commitRefsFromSearchParams(searchParams) {
    const base = (searchParams.get('base') || '').trim();
    const head = (searchParams.get('head') || '').trim();
    if (!base && !head) return null;
    if (base && !head) throw new Error('A base commit also requires a head commit.');
    if ((base && !/^[0-9a-f]{7,40}$/i.test(base)) || !/^[0-9a-f]{7,40}$/i.test(head)) {
      throw new Error('The base and head parameters must be Git commit SHAs between 7 and 40 hexadecimal characters.');
    }
    if (base && base.toLowerCase() === head.toLowerCase()) throw new Error('The base and head commits must be different.');
    return { base: base || null, head };
  }

  function extractTitle(markdown, fallback) {
    const frontMatter = String(markdown).match(/^---\s*\n([\s\S]*?)\n---/);
    const title = frontMatter && frontMatter[1].match(/^title:\s*["']?(.+?)["']?\s*$/mi);
    const heading = String(markdown).match(/^#\s+(.+)$/m);
    return (title && title[1]) || (heading && heading[1]) || fallback;
  }

  function stripFrontMatter(markdown) {
    return String(markdown || '').replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '');
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function firstLine(value) {
    return String(value || '').split('\n')[0];
  }

  function countChangedLines(parts) {
    return parts.reduce((counts, part) => {
      const lineCount = part.count || Math.max(0, part.value.split('\n').length - 1);
      if (part.added) counts.additions += lineCount;
      if (part.removed) counts.deletions += lineCount;
      return counts;
    }, { additions: 0, deletions: 0 });
  }

  function markdownForRendering(markdown) {
    return stripFrontMatter(markdown)
      .replace(/:::image\s+([^\n]*?):::/g, (_match, attributes) => {
        const source = attributes.match(/\bsource="([^"]+)"/i)?.[1] || '';
        const alt = attributes.match(/\balt-text="([^"]*)"/i)?.[1] || '';
        return source ? `![${alt.replace(/]/g, '\\]')}](${source})` : '';
      })
      .replace(/^:::(?:moniker|zone|row|column|code)[^\n]*$/gm, '')
      .replace(/^:::\s*$/gm, '');
  }

  function resolveContentUrl(value, info, ref, type) {
    const url = String(value || '').trim();
    if (!url || url.startsWith('#')) return url;
    if (/^(https?:|mailto:)/i.test(url)) return url;
    if (/^(javascript:|data:|vbscript:)/i.test(url)) return '';
    if (url.startsWith('~/')) {
      try { return new URL(url.slice(2).replace(/\.md(?=($|[?#]))/i, ''), info.siteRoot).href; } catch { return ''; }
    }
    if (url.startsWith('/')) {
      try { return new URL(url.replace(/\.md(?=($|[?#]))/i, ''), info.publicUrl).href; } catch { return ''; }
    }
    if (type === 'src') {
      const directory = info.path.split('/').slice(0, -1).join('/');
      return `https://raw.githubusercontent.com/${info.repository}/${encodeURIComponent(ref)}/${directory}/${url}`;
    }
    const publicBase = info.publicUrl.endsWith('/') ? info.publicUrl : `${info.publicUrl.slice(0, info.publicUrl.lastIndexOf('/') + 1)}`;
    try { return new URL(url.replace(/\.md(?=($|[?#]))/i, ''), publicBase).href; } catch { return ''; }
  }

  function sanitizeRenderedHtml(html, info, ref) {
    if (!root.DOMParser) return html;
    const document = new root.DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
    document.querySelectorAll('script,style,link,meta,base,iframe,object,embed,form,input,button,textarea,select,svg,math').forEach(node => node.remove());
    document.querySelectorAll('*').forEach(node => {
      for (const attribute of [...node.attributes]) {
        if (!['href', 'src', 'alt', 'title', 'colspan', 'rowspan'].includes(attribute.name.toLowerCase())) node.removeAttribute(attribute.name);
      }
      if (node.hasAttribute('href')) {
        const href = resolveContentUrl(node.getAttribute('href'), info, ref, 'href');
        if (href) node.setAttribute('href', href); else node.removeAttribute('href');
      }
      if (node.hasAttribute('src')) {
        const src = resolveContentUrl(node.getAttribute('src'), info, ref, 'src');
        if (src) node.setAttribute('src', src); else node.removeAttribute('src');
      }
      if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy');
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    document.querySelectorAll('blockquote').forEach(block => {
      const firstParagraph = block.querySelector('p');
      const match = firstParagraph?.textContent.match(/^\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]\s*/i);
      if (!match) return;
      const type = match[1].toLowerCase();
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      firstParagraph.innerHTML = firstParagraph.innerHTML.replace(/^\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]\s*/i, '');
      block.className = `learn-alert learn-alert-${type}`;
      block.insertAdjacentHTML('afterbegin', `<div class="learn-alert-title"><span class="learn-alert-icon" aria-hidden="true">!</span><span>${label}</span></div>`);
    });
    return document.querySelector('main').innerHTML;
  }

  function renderMarkdown(markdown, info, ref) {
    if (!root.marked || typeof root.marked.parse !== 'function') throw new Error('The Markdown renderer did not load.');
    const html = root.marked.parse(markdownForRendering(markdown), { async: false, mangle: false, headerIds: false });
    return sanitizeRenderedHtml(html, info, ref);
  }

  function renderVisualDiff(before, after, info, baseRef, headRef) {
    if (typeof root.htmldiff !== 'function') throw new Error('The visual diff engine did not load.');
    // Use the same ref for media in both revisions so an unchanged relative image
    // URL is not reported as a content change merely because its commit SHA differs.
    const oldHtml = renderMarkdown(before, info, headRef);
    const newHtml = renderMarkdown(after, info, headRef);
    const html = root.htmldiff(oldHtml, newHtml);
    return html.trim() ? `<div class="rich-diff live-rich-diff">${html}</div>` : '<p class="quiet">No rendered content changed.</p>';
  }

  function renderMarkdownDiff(before, after, info, baseRef, headRef) {
    if (!root.Diff || typeof root.Diff.createTwoFilesPatch !== 'function') throw new Error('The Markdown diff engine did not load.');
    const patch = root.Diff.createTwoFilesPatch(
      `${info.path} @ ${(baseRef || 'new file').slice(0, 7)}`,
      `${info.path} @ ${headRef.slice(0, 7)}`,
      before,
      after,
      '',
      '',
      { context: 4 }
    );
    const lines = patch.split('\n').map(line => {
      let kind = 'context';
      if (/^@@/.test(line)) kind = 'hunk';
      else if (/^(Index:|={3,}|\\ No newline)/.test(line)) kind = 'meta';
      else if (/^\+\+\+/.test(line)) kind = 'file-new';
      else if (/^---/.test(line)) kind = 'file-old';
      else if (line.startsWith('+')) kind = 'added';
      else if (line.startsWith('-')) kind = 'removed';
      return `<span class="markdown-diff-line ${kind}">${escapeHtml(line || ' ')}</span>`;
    }).join('');
    return `<div class="markdown-diff" role="region" aria-label="Markdown Git diff"><pre><code>${lines}</code></pre></div>`;
  }

  async function request(endpoint, token, accept, rateElement) {
    const headers = {
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await root.fetch(endpoint, { headers });
    const remaining = response.headers.get('x-ratelimit-remaining');
    const limit = response.headers.get('x-ratelimit-limit');
    const reset = response.headers.get('x-ratelimit-reset');
    if (rateElement && remaining && limit) rateElement.textContent = `${remaining} of ${limit} GitHub API requests remaining this hour`;
    if (!response.ok) {
      let message = `GitHub returned ${response.status}.`;
      try { message = (await response.json()).message || message; } catch {}
      const rateLimited = response.status === 429 || (response.status === 403 && remaining === '0');
      if (rateLimited) {
        const resetDate = reset ? new Date(Number(reset) * 1000) : null;
        const resetText = resetDate && !Number.isNaN(resetDate.getTime())
          ? ` It should reset around ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(resetDate)}.`
          : '';
        message = token
          ? `The hourly GitHub API allowance for this token has been used.${resetText} You can wait for it to reset or replace the token with one that has available requests.`
          : `GitHub’s shared unauthenticated allowance of 60 API requests per hour has been used for this IP address.${resetText} Add a GitHub token to continue with your personal allowance.`;
      }
      const error = new Error(message);
      error.status = response.status;
      error.rateLimited = rateLimited;
      error.resetAt = reset ? Number(reset) * 1000 : null;
      throw error;
    }
    return accept === 'application/vnd.github.raw+json' ? response.text() : response.json();
  }

  async function loadComparison(info, token, rateElement, refs) {
    const encodedPath = apiPath(info.path);
    const rawUrl = ref => `${info.apiRoot}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
    if (refs) {
      const commitUrl = ref => `${info.apiRoot}/commits/${encodeURIComponent(ref)}`;
      const rawAt = ref => request(rawUrl(ref), token, 'application/vnd.github.raw+json', rateElement)
        .catch(error => error.status === 404 ? '' : Promise.reject(error));
      const headCommit = await request(commitUrl(refs.head), token, undefined, rateElement);
      const baseRef = refs.base || headCommit.parents?.[0]?.sha || '';
      if (!baseRef) throw new Error('The selected head commit does not have a parent revision to compare.');
      const [baseCommit, before, after] = await Promise.all([
        request(commitUrl(baseRef), token, undefined, rateElement),
        rawAt(baseRef),
        rawAt(refs.head)
      ]);
      return { info, headCommit, baseCommit, after, before };
    }
    const commits = await request(`${info.apiRoot}/commits?path=${encodedPath}&per_page=2`, token, undefined, rateElement);
    if (!Array.isArray(commits) || !commits.length) {
      throw new Error(`No file history was found at ${info.path}. The Learn URL may use a nonstandard source path.`);
    }
    const headCommit = commits[0];
    const baseCommit = commits[1] || null;
    const [after, before] = await Promise.all([
      request(rawUrl(headCommit.sha), token, 'application/vnd.github.raw+json', rateElement),
      baseCommit ? request(rawUrl(baseCommit.sha), token, 'application/vnd.github.raw+json', rateElement) : Promise.resolve('')
    ]);
    return { info, headCommit, baseCommit, after, before };
  }

  function commitCard(commit, label) {
    if (!commit) return `<div class="compare-revision"><div class="eyebrow">${label}</div><strong>New file</strong><p>No earlier revision was found.</p></div>`;
    const author = commit.commit?.author || {};
    return `<div class="compare-revision"><div class="eyebrow">${label}</div><a href="${escapeHtml(commit.html_url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(commit.sha.slice(0, 7))}</strong></a><p>${escapeHtml(firstLine(commit.commit?.message))}</p>${author.date ? `<span>${escapeHtml(formatDate(author.date))}</span>` : ''}</div>`;
  }

  function setStatus(element, message, state) {
    element.hidden = !message;
    element.className = `compare-status ${state || ''}`.trim();
    element.textContent = message || '';
  }

  function groupContiguousChangedBlocks(entries) {
    const groups = [];
    for (const entry of entries) {
      const operations = new Set(entry.operations || []);
      const current = groups[groups.length - 1];
      const continuesCurrent = current && operations.size && [...operations].some(operation => current.operations.has(operation));
      if (continuesCurrent) {
        current.blocks.push(entry.block);
        operations.forEach(operation => current.operations.add(operation));
      } else {
        groups.push({ blocks: [entry.block], operations });
      }
    }
    return groups.map(group => group.blocks);
  }

  function createDiffNavigator(document) {
    const navigator = document.querySelector('[data-diff-navigator]');
    const diffRoot = document.querySelector('[data-diff]');
    if (!navigator || !diffRoot) return { refresh() {}, hide() {} };
    const position = navigator.querySelector('[data-diff-position]');
    const previous = navigator.querySelector('[data-diff-previous]');
    const next = navigator.querySelector('[data-diff-next]');
    previous.textContent = '← Previous diff';
    previous.title = 'Previous diff';
    previous.setAttribute('aria-label', 'Previous diff');
    next.textContent = 'Next diff →';
    next.title = 'Next diff';
    next.setAttribute('aria-label', 'Next diff');
    let targets = [];
    let currentIndex = -1;

    function positionUnderHeader() {
      const header = document.querySelector('.site-header');
      navigator.style.top = `${Math.max(12, (header?.getBoundingClientRect().bottom || 78) + 12)}px`;
    }

    function clearTargets() {
      diffRoot.querySelectorAll('.diff-jump-target,.diff-jump-active').forEach(target => {
        target.classList.remove('diff-jump-target', 'diff-jump-active');
      });
    }

    function visualTargets(panel) {
      const blockSelector = 'p,li,h1,h2,h3,h4,h5,h6,tr,pre,blockquote';
      const blocks = new Map();
      panel.querySelectorAll('ins,del').forEach(change => {
        const ancestor = change.closest(blockSelector);
        const descendants = [...change.querySelectorAll(blockSelector)];
        const candidates = ancestor && panel.contains(ancestor) ? [ancestor] : descendants.length ? descendants : [change];
        const operation = change.dataset.operationIndex || '';
        candidates.forEach(block => {
          if (!blocks.has(block)) blocks.set(block, new Set());
          if (operation) blocks.get(block).add(operation);
        });
      });
      return groupContiguousChangedBlocks([...blocks].map(([block, operations]) => ({ block, operations })));
    }

    function refresh() {
      clearTargets();
      currentIndex = -1;
      const panel = diffRoot.querySelector('[data-diff-panel]:not([hidden])');
      if (!panel) {
        navigator.hidden = true;
        return;
      }
      targets = panel.dataset.diffPanel === 'markdown'
        ? [...panel.querySelectorAll('.markdown-diff-line.hunk')].map(target => [target])
        : visualTargets(panel);
      if (!targets.length && panel.dataset.diffPanel === 'markdown') {
        targets = [...panel.querySelectorAll('.markdown-diff-line.added,.markdown-diff-line.removed')].map(target => [target]);
      }
      targets.forEach(group => group[0].classList.add('diff-jump-target'));
      positionUnderHeader();
      navigator.hidden = !targets.length;
      position.textContent = `${targets.length} change${targets.length === 1 ? '' : 's'}`;
      previous.disabled = !targets.length;
      next.disabled = !targets.length;
    }

    function move(amount) {
      if (!targets.length) return;
      if (currentIndex < 0) currentIndex = amount > 0 ? 0 : targets.length - 1;
      else currentIndex = (currentIndex + amount + targets.length) % targets.length;
      targets.forEach((group, index) => group[0].classList.toggle('diff-jump-active', index === currentIndex));
      position.textContent = `${currentIndex + 1} of ${targets.length}`;
      targets[currentIndex][0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    previous.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    diffRoot.addEventListener('click', event => {
      if (event.target.closest('[data-diff-tab]')) root.setTimeout(refresh, 0);
    });
    root.addEventListener('resize', positionUnderHeader);
    return {
      refresh,
      hide() {
        clearTargets();
        targets = [];
        currentIndex = -1;
        navigator.hidden = true;
      }
    };
  }

  function init() {
    const form = root.document?.querySelector('[data-learn-diff-form]');
    if (!form) return;
    const input = form.querySelector('[name="learn-url"]');
    const submit = form.querySelector('button[type="submit"]');
    const status = root.document.querySelector('[data-compare-status]');
    const rate = root.document.querySelector('[data-github-rate-status]');
    const results = root.document.querySelector('[data-compare-results]');
    const empty = root.document.querySelector('[data-compare-empty]');
    const diffNavigator = createDiffNavigator(root.document);
    const pageUrl = new URL(root.location.href);
    const queryUrl = pageUrl.searchParams.get('url');
    const directView = pageUrl.searchParams.get('view') === 'diff';
    const main = root.document.querySelector('.compare-main');
    root.document.querySelector('.compare-callout')?.remove();
    root.document.title = 'Compare documentation revisions — Entra.News Daily';
    root.document.querySelector('.compare-hero h1').textContent = 'See what changed on a Microsoft Learn page.';
    root.document.querySelector('.compare-hero .lede').textContent = 'Paste a documentation URL. This page maps it to its configured GitHub repository, loads two revisions, and builds a visual and Markdown diff entirely in your browser.';
    root.document.querySelector('label[for="learn-url"]').textContent = 'Documentation page URL';
    input.placeholder = 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview';
    const emptyStrong = empty.querySelector('strong');
    if (emptyStrong) emptyStrong.textContent = 'Paste a configured documentation page to begin.';
    let supportedSources = root.document.querySelector('[data-supported-sources]');
    if (!supportedSources) {
      supportedSources = root.document.createElement('p');
      supportedSources.className = 'compare-supported-sources';
      supportedSources.dataset.supportedSources = '';
      form.querySelector('.compare-input-row').after(supportedSources);
    }
    const labels = [...new Set(configuredSources().map(source => source.label).filter(Boolean))];
    supportedSources.textContent = `Supported Microsoft Learn docsets: ${labels.join(', ')}.`;
    const directStatus = root.document.createElement('div');
    directStatus.className = 'compare-direct-status';
    directStatus.setAttribute('role', 'status');
    directStatus.setAttribute('aria-live', 'polite');
    directStatus.textContent = 'Loading the full documentation diff…';
    directStatus.hidden = !directView;
    main.insertBefore(directStatus, results);
    root.document.documentElement.dataset.compareView = directView ? 'diff' : 'standard';

    function savedToken() {
      try { return root.localStorage.getItem(TOKEN_STORAGE_KEY) || ''; } catch { return ''; }
    }
    let retryAfterTokenChange = false;
    root.document.addEventListener('github-token-changed', event => {
      if (!retryAfterTokenChange || !event.detail?.hasToken) return;
      retryAfterTokenChange = false;
      form.requestSubmit();
    });
    if (queryUrl) input.value = queryUrl;

    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Comparing…';
      results.hidden = true;
      empty.hidden = true;
      diffNavigator.hide();
      if (directView) {
        directStatus.hidden = false;
        directStatus.classList.remove('error');
        directStatus.textContent = 'Loading the full documentation diff…';
      }
      setStatus(status, 'Finding the configured source file and revisions on GitHub…', 'loading');
      try {
        const info = siteUrlToRepoInfo(input.value);
        const token = savedToken();
        const requestedRefs = commitRefsFromSearchParams(pageUrl.searchParams);
        const comparison = await loadComparison(info, token, rate, requestedRefs);
        const parts = root.Diff.diffLines(comparison.before, comparison.after);
        const counts = countChangedLines(parts);
        const headRef = comparison.headCommit.sha;
        const baseRef = comparison.baseCommit?.sha || '';
        const title = extractTitle(comparison.after, info.path.split('/').pop().replace(/\.md$/i, ''));
        root.document.querySelector('[data-result-title]').textContent = title;
        root.document.querySelector('[data-result-path]').textContent = info.path;
        root.document.querySelector('[data-result-stats]').textContent = `+${counts.additions} / −${counts.deletions} lines in the latest change`;
        const learnLink = root.document.querySelector('[data-result-learn]');
        learnLink.href = info.publicUrl;
        learnLink.title = 'Open on Microsoft Learn';
        learnLink.setAttribute('aria-label', 'Open on Microsoft Learn');
        const githubLink = root.document.querySelector('[data-result-github]');
        githubLink.href = githubFileUrl(info, headRef);
        githubLink.title = 'Open this revision on GitHub';
        githubLink.setAttribute('aria-label', 'Open this revision on GitHub');
        const historyLink = root.document.querySelector('[data-result-history]');
        historyLink.href = info.historyUrl;
        historyLink.title = 'View complete file history';
        historyLink.setAttribute('aria-label', 'View complete file history');
        root.document.querySelector('[data-result-revisions]').innerHTML = commitCard(comparison.baseCommit, 'Before') + commitCard(comparison.headCommit, 'After');
        root.document.querySelector('[data-live-visual-diff]').innerHTML = renderVisualDiff(comparison.before, comparison.after, info, baseRef, headRef);
        root.document.querySelector('[data-live-markdown-diff]').innerHTML = renderMarkdownDiff(comparison.before, comparison.after, info, baseRef, headRef);
        const shareUrl = new URL(root.location.href);
        shareUrl.search = '';
        shareUrl.searchParams.set('url', info.publicUrl);
        if (requestedRefs && comparison.baseCommit) {
          shareUrl.searchParams.set('base', comparison.baseCommit.sha);
          shareUrl.searchParams.set('head', comparison.headCommit.sha);
        }
        if (directView) shareUrl.searchParams.set('view', 'diff');
        root.history.replaceState(null, '', shareUrl);
        results.hidden = false;
        directStatus.hidden = true;
        retryAfterTokenChange = false;
        diffNavigator.refresh();
        setStatus(status, '', '');
        if (!directView) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        if (error.rateLimited) {
          retryAfterTokenChange = true;
          root.document.dispatchEvent(new root.CustomEvent('github-token-required', { detail: { message: error.message, resetAt: error.resetAt } }));
        }
        empty.hidden = directView;
        if (directView) {
          directStatus.hidden = false;
          directStatus.classList.add('error');
          directStatus.textContent = error.message || 'The comparison could not be loaded.';
        }
        setStatus(status, error.message || 'The comparison could not be loaded.', 'error');
      } finally {
        submit.disabled = false;
        submit.textContent = 'Compare latest change';
      }
    });

    if (queryUrl) form.requestSubmit();
  }

  const api = {
    learnUrlToRepoInfo,
    siteUrlToRepoInfo,
    configuredSources,
    commitRefsFromSearchParams,
    githubFileUrl,
    extractTitle,
    stripFrontMatter,
    countChangedLines,
    loadComparison,
    groupContiguousChangedBlocks,
    init
  };
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
  return api;
}));
