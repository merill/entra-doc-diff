const fs = require('fs').promises;
const path = require('path');
const moment = require('moment-timezone');
const { marked } = require('marked');
const { parse } = require('node-html-parser');
const htmlDiff = require('node-htmldiff');
const simpleGit = require('simple-git');
const { nextScheduledRefresh, readJson, writeJsonAtomic } = require('./update-state');
const { getConfig, runRules } = require('./config');

const config = getConfig();

const SITE = config.site;

const REFRESH_SCHEDULE_UTC = { hour: 8, minute: 15 };

function dateAtRefresh(date) {
  return `${date}T${String(REFRESH_SCHEDULE_UTC.hour).padStart(2, '0')}:${String(REFRESH_SCHEDULE_UTC.minute).padStart(2, '0')}:00Z`;
}

const PRODUCTS = config.taxonomy.products.map(product => ({ ...product, icon: product.icon.file }));

const TOPICS = config.taxonomy.topics.map(topic => ({ ...topic, icon: `/assets/topics/${topic.icon.file}` }));

const STOPWORDS = config.taxonomy.stopwords;

// The browser bundles ship inside the packages that also serve as build-time
// dependencies. Resolving them through the package's own package.json anchors
// them to this module's dependency graph rather than to the working directory —
// which is what lets the generator run from anywhere. marked restricts its
// `exports` map, so the file itself cannot be require.resolve()d directly.
function vendorFile(pkg, file) {
  return path.join(path.dirname(require.resolve(`${pkg}/package.json`)), file);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function escapeXml(value = '') {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F]/g, '')
    .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function stripHtml(value = '') {
  return parse(String(value)).text.replace(/\s+/g, ' ').trim();
}

function firstTwoSentences(value = '') {
  const text = String(value).replace(/\s+/g, ' ').trim();
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
  if (sentences.length) return sentences.slice(0, 2).join(' ').trim();
  return text;
}

function truncate(value = '', length = 220) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1).trim()}…` : text;
}

function dailySummaryText(summary = {}) {
  if (!summary || typeof summary !== 'object') return '';
  const plain = value => stripHtml(value).replace(/\s+/g, ' ').trim();
  const parts = [plain(summary.overview)];
  const keyChanges = Array.isArray(summary.keyChanges) && summary.keyChanges.length
    ? summary.keyChanges.map(change => [plain(change.title || change.headline), plain(change.detail || change.summary)].filter(Boolean).join(': '))
    : Array.isArray(summary.groups) && summary.groups.length
      ? summary.groups.map(group => [plain(group.title || group.headline), plain(group.summary || group.detail)].filter(Boolean).join(': '))
      : Array.isArray(summary.highlights)
        ? summary.highlights.map(highlight => [plain(highlight.headline || highlight.title), plain(highlight.detail || highlight.summary)].filter(Boolean).join(': '))
        : [];
  parts.push(...keyChanges);
  if (summary.adminImpact) parts.push(`${config.copy.detail.adminImpactLabel}: ${plain(summary.adminImpact)}`);
  return [...new Set(parts.filter(Boolean))].join('\n\n');
}

function dailySummaryChanges(summary = {}) {
  const changes = Array.isArray(summary.keyChanges) && summary.keyChanges.length
    ? summary.keyChanges
    : Array.isArray(summary.groups) && summary.groups.length
      ? summary.groups
      : Array.isArray(summary.highlights)
        ? summary.highlights
        : [];
  return changes.map(change => ({
    title: change.title || change.headline || '',
    detail: change.detail || change.summary || '',
    product: change.product || '',
    sourceId: change.sourceId || ''
  })).filter(change => change.title || change.detail);
}

function rssHtmlText(value = '') {
  return escapeHtml(String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F]/g, ''));
}

function richDailySummaryHtml(summary, date, sourceById = new Map()) {
  const dayUrl = `${SITE.url}/day/${date}/`;
  const dateLabel = moment(date).format('D MMMM YYYY');
  const headline = summary.headline || `${SITE.productName} daily update for ${dateLabel}`;
  const productFromLabel = label => {
    const value = String(label || '').toLowerCase();
    return value ? [...PRODUCTS].sort((a, b) => b.name.length - a.name.length).find(product =>
      value === product.name.toLowerCase() || value === product.short.toLowerCase() || value.includes(product.name.toLowerCase()) || value.includes(product.short.toLowerCase())
    ) : null;
  };
  const changes = dailySummaryChanges(summary).map(change => {
    const target = sourceById.get(change.sourceId);
    const product = target?.product ? PRODUCTS.find(candidate => candidate.slug === target.product.slug) : productFromLabel(change.product);
    const inferredTopic = classifyTopic('', change.title, change.detail);
    const topic = target?.topic
      ? TOPICS.find(candidate => candidate.slug === target.topic.slug || candidate.name === target.topic.name)
      : inferredTopic?.slug !== 'general' ? inferredTopic : null;
    const targetId = target?.id || change.sourceId;
    const href = targetId ? `${dayUrl}#${encodeURIComponent(targetId)}` : dayUrl;
    const labels = [product?.short || change.product, topic?.name].filter(Boolean);
    const icons = [
      product ? `<img src="${SITE.url}/assets/products/${product.icon}" width="20" height="20" alt="" style="display:inline-block;width:20px!important;max-width:20px!important;height:20px!important;max-height:20px!important;object-fit:contain;vertical-align:middle">` : '',
      topic ? `<img src="${SITE.url}${topic.icon}" width="16" height="16" alt="" style="display:inline-block;width:16px!important;max-width:16px!important;height:16px!important;max-height:16px!important;object-fit:contain;vertical-align:middle">` : ''
    ].join('<span style="display:inline-block;width:5px"></span>');
    const taxonomy = labels.length ? `<div style="margin:0 0 5px;color:#0d5745;font:700 11px/1.35 Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase">${rssHtmlText(labels.join(' · '))}</div>` : '';
    const heading = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:0;border-collapse:collapse"><tr>${icons ? `<td width="46" valign="top" style="width:46px;min-width:46px;padding:1px 8px 0 0;vertical-align:top;white-space:nowrap">${icons}</td>` : ''}<td valign="top" style="padding:0;vertical-align:top">${taxonomy}<h3 style="margin:0 0 7px;font:600 18px/1.3 Georgia,serif"><a href="${rssHtmlText(href)}" style="color:#11181d;text-decoration:none">${rssHtmlText(change.title)}</a></h3></td></tr></table>`;
    return `<div style="margin:0 0 20px;padding:0 0 18px;border-bottom:1px solid #d8d3c7">${heading}${change.detail ? `<p style="margin:5px 0 0;color:#46514e;font:14px/1.55 Arial,sans-serif">${rssHtmlText(change.detail)}</p>` : ''}</div>`;
  }).join('');
  return `<div style="max-width:760px;color:#11181d;font-family:Arial,sans-serif"><div style="margin:0 0 24px"><div style="margin:0 0 6px;color:#0d5745;font:700 11px/1.3 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase">Day in brief · ${rssHtmlText(dateLabel)}</div><h2 style="margin:0 0 12px;font:650 28px/1.2 Georgia,serif"><a href="${dayUrl}" style="color:#11181d;text-decoration:none">${rssHtmlText(headline)}</a></h2>${summary.overview ? `<p style="margin:0;color:#263030;font:16px/1.6 Arial,sans-serif">${rssHtmlText(summary.overview)}</p>` : ''}</div>${changes}<p style="margin:24px 0 0"><a href="${dayUrl}" style="color:#0d5745;font:700 15px/1.4 Georgia,serif">View all updates for ${rssHtmlText(dateLabel)} →</a></p></div>`;
}

function renderDailyRss(reports, daySummaries = {}, limit = 50, sourceItems = []) {
  const reportsByDate = new Map(reports.map(report => [report.date, report]));
  const sourceById = new Map(sourceItems.filter(item => item?.id).map(item => [item.id, item]));
  const dates = [...new Set([...reportsByDate.keys(), ...Object.keys(daySummaries || {})])];
  const entries = dates
    .map(date => {
      const summary = daySummaries?.[date] || reportsByDate.get(date)?.data?.englishSummary;
      return { date, summary, description: dailySummaryText(summary) };
    })
    .filter(entry => moment(entry.date, 'YYYY-MM-DD', true).isValid() && entry.description)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
  const items = entries.map(entry => {
    const url = `${SITE.url}/day/${entry.date}/`;
    const dateLabel = moment(entry.date).format('D MMMM YYYY');
    const title = entry.summary.headline ? `${entry.summary.headline} — ${dateLabel}` : `${SITE.productName} daily update — ${dateLabel}`;
    const richContent = richDailySummaryHtml(entry.summary, entry.date, sourceById);
    return [
      '    <item>',
      `      <title>${escapeXml(title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <pubDate>${moment.utc(dateAtRefresh(entry.date)).toDate().toUTCString()}</pubDate>`,
      `      <description><![CDATA[${richContent}]]></description>`,
      `      <content:encoded><![CDATA[${richContent}]]></content:encoded>`,
      '    </item>'
    ].join('\n');
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '  <channel>',
    `    <title>${SITE.name} summaries</title>`,
    `    <link>${SITE.url}/</link>`,
    `    <description>Plain-English daily summaries of ${SITE.productName} documentation and Message Center changes.</description>`,
    '    <language>en</language>',
    `    <atom:link href="${SITE.url}/rss.xml" rel="self" type="application/rss+xml"/>`,
    items,
    '  </channel>',
    '</rss>',
    ''
  ].filter((line, index) => line || index === 0).join('\n');
}

function slugify(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96) || 'update';
}

function isProductMessage(message) {
  const pattern = config.messageCenter.servicePattern;
  return (message.Services || []).some(service => pattern.test(String(service))) || pattern.test(String(message.Title || ''));
}

function classifyProduct(filename = '', title = '', body = '') {
  return runRules(config.classify.products, PRODUCTS, config.taxonomy.defaultProduct, filename, title, body);
}

function classifyTopic(filename = '', title = '', body = '') {
  return runRules(config.classify.topics, TOPICS, config.taxonomy.defaultTopic, filename, title, body);
}

function humanizeFilename(filename = '') {
  const leaf = filename.split('/').pop().replace(/\.md$/i, '').replace(/^(concept|how-to|reference|overview)-/, '');
  return leaf.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

const CHANGE_NATURE_LABELS = new Map([
  ['Doc update', 'doc-update'],
  ['Feature update', 'feature-update'],
  ['New feature', 'new-feature'],
  ['Private preview', 'private-preview'],
  ['Public preview', 'public-preview'],
  ['Generally available', 'generally-available'],
  ['Retirement', 'retirement']
]);

const LEGACY_CHANGE_NATURE = new Map([
  ['Preview', 'Public preview'],
  ['General availability', 'Generally available'],
  ['New documentation', 'Doc update'],
  ['Documentation change', 'Doc update'],
  ['Retirement or breaking change', 'Retirement'],
  ['Admin action', 'Feature update']
]);

// Only summaries an AI actually judged carry a trustworthy category; fallback
// summaries default every modified file to the same value, so they show the
// mechanical New/Updated/Removed pill instead.
function changeNature(summary) {
  if (!summary || !['openai', 'codex-one-time-backfill'].includes(summary.generatedBy)) return '';
  const raw = String(summary.category || '');
  const mapped = LEGACY_CHANGE_NATURE.get(raw) || raw;
  return CHANGE_NATURE_LABELS.has(mapped) ? mapped : '';
}

function humanizeLabel(value = '') {
  const label = String(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
  const normalized = label.toLowerCase();
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : '';
}

function extractMarkdownMetadata(patch = '', filename = '') {
  const usable = String(patch).split('\n')
    .filter(line => !line.startsWith('diff ') && !line.startsWith('index ') && !line.startsWith('--- ') && !line.startsWith('+++ ') && !line.startsWith('@@'))
    .filter(line => line.startsWith('+') || line.startsWith(' '))
    .map(line => line.replace(/^[+ ]/, ''));
  const joined = usable.join('\n');
  const title = joined.match(/^title:\s*["']?(.+?)["']?\s*$/mi)?.[1]
    || joined.match(/^#\s+(.+)$/m)?.[1]
    || humanizeFilename(filename);
  const description = joined.match(/^description:\s*["']?(.+?)["']?\s*$/mi)?.[1]
    || usable.find(line => line && !/^(---|title:|titleSuffix:|description:|ms\.|#|<!--|\[!)/i.test(line.trim()))
    || `A ${SITE.productName} documentation page was updated: ${title}.`;
  return {
    title: truncate(title.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'), 150),
    description: String(description).replace(/\s+/g, ' ').trim()
  };
}

function tokenize(value = '') {
  return new Set(slugify(value).split('-').filter(token => token.length > 3 && !STOPWORDS.has(token)));
}

const PERIOD_SIGNAL_TOKENS = new Set([
  'branding', 'captcha', 'controls', 'custom', 'external', 'federated', 'migration',
  'otp', 'partner', 'passkey', 'purview', 'retirement', 'tier1', 'tier2'
]);

function periodTokens(value = '') {
  const expanded = String(value)
    .replace(/\bdlp\b/gi, 'data loss prevention')
    .replace(/\bgsa\b/gi, 'global secure access')
    .replace(/\bsspr\b/gi, 'self service password reset')
    .replace(/\botp\b/gi, 'one time passcode otp');
  return tokenize(expanded);
}

function periodChangeScore(change, item) {
  const titleTokens = periodTokens(change.title);
  const changeTokens = periodTokens(`${change.title || ''} ${change.detail || ''} ${change.product || ''}`);
  const itemTitleTokens = periodTokens(item.title);
  const itemTokens = periodTokens(`${item.title || ''} ${item.summary || ''} ${item.adminImpact || ''} ${item.product?.name || ''} ${item.product?.short || ''} ${item.topic?.name || ''}`);
  let score = 0;
  let titleMatches = 0;
  let signalMatches = 0;
  for (const token of titleTokens) {
    if (itemTitleTokens.has(token)) {
      score += 6;
      titleMatches += 1;
    } else if (itemTokens.has(token)) {
      score += 3;
      titleMatches += 1;
    }
  }
  for (const token of changeTokens) if (itemTokens.has(token)) score += 1;
  for (const token of changeTokens) {
    if (PERIOD_SIGNAL_TOKENS.has(token) && itemTokens.has(token)) {
      score += 12;
      signalMatches += 1;
    }
  }
  const product = slugify(change.product || '');
  const productLabels = [item.product?.slug, item.product?.short, item.product?.name].filter(Boolean).map(slugify);
  if (product && productLabels.some(label => product.includes(label) || label.includes(product))) score += 3;
  return { score, titleMatches, signalMatches };
}

function relatedScore(left, right) {
  if (left.id === right.id) return -1;
  let score = left.product.slug === right.product.slug ? 4 : 0;
  score += left.topic.slug === right.topic.slug ? 3 : 0;
  const a = tokenize(left.title);
  const b = tokenize(right.title);
  for (const token of a) if (b.has(token)) score += 2;
  const dayGap = Math.abs(moment(left.date).diff(moment(right.date), 'days'));
  if (dayGap <= 7) score += 2;
  else if (dayGap <= 30) score += 1;
  return score;
}

function findRelatedItems(item, items, limit = 5) {
  return items.map(candidate => ({ candidate, score: relatedScore(item, candidate) }))
    .filter(result => result.score >= 4)
    .sort((a, b) => b.score - a.score || b.candidate.date.localeCompare(a.candidate.date))
    .slice(0, limit)
    .map(result => result.candidate);
}

function selectRelatedItems(item, items, limit = 5) {
  const ranked = findRelatedItems(item, items, Math.max(limit * 4, 20));
  const selected = ranked.slice(0, limit);
  const crossSource = ranked.find(candidate => candidate.source !== item.source);
  if (crossSource && !selected.some(candidate => candidate.id === crossSource.id)) {
    if (selected.length === limit) selected[selected.length - 1] = crossSource;
    else selected.push(crossSource);
  }
  return selected;
}

function impactScore(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  let score = item.source === 'mc' && item.changeType === 'Major update' ? 5 : 0;
  if (/retire|deprecat|breaking|mandatory|action required|security|vulnerab|risk|deadline|migrat/.test(text)) score += 6;
  if (/preview|general availability|\bga\b|new feature|launch/.test(text)) score += 3;
  if (/passkey|conditional access|federated credential|tenant governance|authentication/.test(text)) score += 2;
  score += Math.min(3, Number(item.additions || 0) / 30);
  return score;
}

function sanitizeMcHtml(html = '') {
  const root = parse(String(html));
  root.querySelectorAll('script,style,iframe,object,embed,img,form,input,button').forEach(node => node.remove());
  root.querySelectorAll('*').forEach(node => {
    for (const key of Object.keys(node.attributes || {})) {
      if (/^on/i.test(key) || !['href', 'title', 'colspan', 'rowspan'].includes(key)) node.removeAttribute(key);
    }
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) node.removeAttribute('href');
      else node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return root.toString();
}

function mondayOf(date) {
  const day = moment(date).startOf('day');
  return day.clone().subtract((day.day() + 6) % 7, 'days').format('YYYY-MM-DD');
}

function formatWeekRange(weekStart) {
  const first = moment(weekStart);
  const last = first.clone().add(6, 'days');
  if (first.year() !== last.year()) return `${first.format('D MMMM YYYY')}–${last.format('D MMMM YYYY')}`;
  if (first.month() !== last.month()) return `${first.format('D MMMM')}–${last.format('D MMMM YYYY')}`;
  return `${first.format('D')}–${last.format('D MMMM YYYY')}`;
}

function renderLearnMarkdown(markdown = '') {
  return marked.parse(markdown, { async: false })
    .replace(/(href|src)="\/(?!\/)([^"]+)"/g, '$1="https://learn.microsoft.com/$2"')
    .replace(/(href|src)="~\/([^"]+)"/g, `$1="${config.docs.learnRootUrl}$2"`);
}

function stripFrontMatter(records) {
  const firstContent = records.findIndex(record => record.value.trim());
  if (firstContent < 0) return [];

  // A patch that starts at line one contains both YAML delimiters. A hunk that
  // starts partway through the metadata usually contains only the closing one.
  const firstValue = records[firstContent].value.trim();
  if (firstValue === '---') {
    const closing = records.findIndex((record, index) => index > firstContent && record.value.trim() === '---');
    if (closing >= 0) return records.slice(closing + 1);
  }

  const closing = records.findIndex(record => record.value.trim() === '---');
  if (closing >= 0) {
    const beforeClosing = records.slice(0, closing).filter(record => record.value.trim());
    const looksLikeMetadata = beforeClosing.some(record => /^[a-z][\w.-]*\s*:/i.test(record.value.trim()));
    if (looksLikeMetadata) return records.slice(closing + 1);
  }

  // A hunk can begin inside front matter and omit both delimiters. In that
  // case, remove the leading metadata run but preserve the Markdown that
  // follows the first blank line.
  const firstBlank = records.findIndex(record => !record.value.trim());
  if (firstBlank > 0) {
    const prefix = records.slice(0, firstBlank).filter(record => record.value.trim());
    const metadataPrefix = prefix.length && prefix.every(record =>
      /^[a-z][\w.-]*\s*:/i.test(record.value.trim()) || /^\s+[-\w]/.test(record.value)
    );
    if (metadataPrefix) return records.slice(firstBlank + 1);
  }

  // Metadata-only hunks don't always include either delimiter.
  const meaningful = records.filter(record => record.value.trim());
  if (meaningful.length && meaningful.every(record => /^[a-z][\w.-]*\s*:/i.test(record.value.trim()))) return [];
  return records;
}

function renderLearnDocumentMarkdown(markdown = '') {
  const lines = String(markdown).split('\n');
  const blocks = [];
  let regular = [];
  const flushRegular = () => {
    if (regular.some(line => line.trim())) blocks.push(renderLearnMarkdown(regular.join('\n')));
    regular = [];
  };

  for (let index = 0; index < lines.length;) {
    const alert = lines[index].trim().match(/^>\s*\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]\s*$/i);
    if (!alert) {
      regular.push(lines[index]);
      index += 1;
      continue;
    }

    flushRegular();
    let end = index + 1;
    while (end < lines.length && (!lines[end].trim() || /^>/.test(lines[end].trimStart()))) end += 1;
    const type = alert[1].toUpperCase();
    const label = type.charAt(0) + type.slice(1).toLowerCase();
    const body = lines.slice(index + 1, end).map(line => line.replace(/^\s*>\s?/, '')).join('\n');
    blocks.push(`<aside class="learn-alert learn-alert-${type.toLowerCase()}"><div class="learn-alert-title"><span class="learn-alert-icon" aria-hidden="true">!</span><span>${label}</span></div><div class="learn-alert-body">${renderLearnMarkdown(body)}</div></aside>`);
    index = end;
  }
  flushRegular();
  return blocks.join('');
}

function repairBlockDiffHtml(value = '') {
  let html = String(value);
  const paragraphHeadingOverlap = /(<p\b[^>]*>)([\s\S]*?)(<h([1-6])\b[^>]*>)([\s\S]*?)(<\/p>)([\s\S]*?)(<\/h\4>)/gi;
  let previous;
  do {
    previous = html;
    html = html.replace(paragraphHeadingOverlap, (_match, paragraphOpen, paragraphBody, headingOpen, _level, headingBody, _paragraphClose, headingRemainder, headingClose) =>
      `${paragraphOpen}${paragraphBody}</p>${headingOpen}${headingBody}${headingRemainder}${headingClose}`
    );
  } while (html !== previous);
  return html.replace(/<p(?:\s[^>]*)?><\/p>/g, '');
}

function formattedDiff(patch = '') {
  const records = [];
  for (const line of String(patch).split('\n')) {
    if (/^(diff |index |--- |\+\+\+ |@@)/.test(line)) continue;
    records.push({
      kind: line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context',
      value: line.replace(/^[+\- ]/, '')
    });
  }

  const content = stripFrontMatter(records);
  const oldMarkdown = content.filter(record => record.kind !== 'added').map(record => record.value).join('\n');
  const newMarkdown = content.filter(record => record.kind !== 'removed').map(record => record.value).join('\n');
  const rendered = repairBlockDiffHtml(htmlDiff(
    renderLearnDocumentMarkdown(oldMarkdown),
    renderLearnDocumentMarkdown(newMarkdown)
  ));
  return rendered.trim()
    ? `<div class="rich-diff">${rendered}</div>`
    : '<p class="quiet">No content changes were available in this diff.</p>';
}

function renderMarkdownDiff(patch = '') {
  const lines = String(patch).split('\n').filter(line =>
    !/^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to))/.test(line)
  ).map(line => {
    let kind = 'context';
    if (/^@@/.test(line)) kind = 'hunk';
    else if (/^(diff |index |new file mode|deleted file mode|similarity index|rename (from|to))/.test(line)) kind = 'meta';
    else if (/^\+\+\+ /.test(line)) kind = 'file-new';
    else if (/^--- /.test(line)) kind = 'file-old';
    else if (line.startsWith('+')) kind = 'added';
    else if (line.startsWith('-')) kind = 'removed';
    return `<span class="markdown-diff-line ${kind}">${escapeHtml(line || ' ')}</span>`;
  }).join('');
  return `<div class="markdown-diff" role="region" aria-label="Markdown Git diff"><pre><code>${lines}</code></pre></div>`;
}

const CSS = `:root{--paper:#f7f5ef;--ink:#11181d;--muted:#5c6665;--green:#0d5745;--green-soft:#e3eee8;--rule:#d8d3c7;--red:#8e342e;--red-soft:#f3dfdc;--sans:"Aptos","Segoe UI",system-ui,sans-serif;--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.52}a{color:var(--green);text-decoration-thickness:1px;text-underline-offset:3px}a:hover{color:#083b30}.site-header{height:78px;border-bottom:1px solid var(--rule);display:flex;align-items:center;padding:0 3.2vw;gap:28px;background:rgba(247,245,239,.97);position:sticky;top:0;z-index:10}.brand{font-family:var(--serif);font-size:31px;font-weight:700;color:var(--ink);text-decoration:none;white-space:nowrap}.brand small{font-family:var(--sans);font-size:12px;font-weight:500;color:var(--muted);margin-left:14px;letter-spacing:.02em}.main-nav{margin-left:auto;display:flex;align-items:center;gap:28px}.main-nav a{color:var(--ink);text-decoration:none;padding:27px 0 22px;border-bottom:4px solid transparent}.main-nav a[aria-current="page"]{color:var(--green);border-color:var(--green);font-weight:650}.utility{display:flex;align-items:center;gap:16px;border-left:1px solid var(--rule);padding-left:23px}.site-link{font-size:13px;color:var(--muted);text-decoration:none;white-space:nowrap}.site-link:hover{color:var(--green)}.icon-link{display:inline-flex}.icon-link img,.icon{width:20px;height:20px}.page-shell{max-width:1420px;margin:0 auto;display:grid;grid-template-columns:270px minmax(0,1fr) 235px;min-height:calc(100vh - 78px)}.left-rail,.right-rail{padding:32px 24px}.left-rail{border-right:1px solid var(--rule)}.right-rail{border-left:1px solid var(--rule)}.content{padding:30px 42px 70px;min-width:0}.eyebrow{font-family:var(--serif);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#313937}.rail-heading{font-family:var(--serif);font-size:13px;letter-spacing:.1em;text-transform:uppercase;margin:0 0 20px}.product-list,.plain-list{list-style:none;padding:0;margin:0}.product-list li{margin:0 0 17px}.product-list a{display:flex;align-items:center;gap:11px;color:var(--ink);font-family:var(--serif);font-size:15px}.product-list img{width:30px;height:30px;object-fit:contain}.plain-list li{margin:0 0 11px}.rail-rule{border:0;border-top:1px solid var(--rule);margin:26px 0}.page-title{font-family:var(--serif);font-size:38px;line-height:1.1;margin:8px 0 12px;font-weight:650}.section-title{font-family:var(--serif);font-size:26px;line-height:1.2;margin:0 0 15px}.lede{font-size:17px;max-width:850px;color:#263030}.period-nav{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--rule);padding-bottom:18px}.period-nav h1{font-family:var(--serif);font-size:27px;margin:0}.feature{padding:26px 0 25px;border-bottom:1px solid var(--rule)}.feature h2{font-family:var(--serif);font-size:31px;line-height:1.15;margin:8px 0 14px}.feature p{max-width:820px}.taxonomy{font-family:var(--serif);color:var(--green);font-size:14px}.story-list{margin-top:20px}.date-group{border-bottom:1px solid var(--rule);padding:0 0 9px;margin-bottom:14px}.date-label{font-family:var(--serif);text-transform:uppercase;letter-spacing:.08em;font-size:13px;margin:0 0 8px}.story-row{display:grid;grid-template-columns:105px 1fr;gap:18px;padding:8px 0}.story-time{color:var(--muted);font-family:var(--serif)}.story-row h3{font-family:var(--serif);font-size:18px;line-height:1.25;margin:0 0 4px;font-weight:500}.story-row h3 a{color:var(--ink);text-decoration:none}.story-row h3 a:hover{text-decoration:underline;text-decoration-color:var(--green)}.source-label{font-family:var(--sans);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-left:8px}.archive-links a{display:block;margin-bottom:10px}.rss-box{display:flex;gap:10px;align-items:flex-start}.rss-box img{width:18px}.hero-product{display:grid;grid-template-columns:125px 1fr;gap:28px;align-items:center;padding:8px 0 30px;border-bottom:1px solid var(--rule)}.hero-product>img{width:120px;height:120px;object-fit:contain}.hero-product h1{font-family:var(--serif);font-size:43px;margin:0 0 5px}.hero-product p{margin:0 0 12px}.two-column{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:52px}.article-list article{display:grid;grid-template-columns:135px 1fr;gap:20px;padding:15px 0;border-bottom:1px solid var(--rule)}.article-list h2{font-family:var(--serif);font-size:19px;font-weight:500;line-height:1.25;margin:0 0 3px}.article-list h2 a{color:var(--green);text-decoration:none}.article-list p{font-size:14px;margin:4px 0}.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:38px;border-bottom:1px solid var(--rule);padding:20px 0 24px}.summary-grid>div+div{border-left:1px solid var(--rule);padding-left:38px}.action-list{list-style:none;padding:0;margin:0}.action-list li{position:relative;padding-left:28px;margin:0 0 10px}.action-list li:before{content:"✓";position:absolute;left:0;color:var(--green);font-weight:700}.article-meta{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);border-bottom:1px solid var(--rule);padding-bottom:18px}.detail-layout{max-width:1420px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:calc(100vh - 78px)}.detail-main{padding:26px 48px 70px}.detail-aside{border-left:1px solid var(--rule);padding:54px 30px}.breadcrumbs{font-family:var(--serif);font-size:14px;margin-bottom:25px}.product-kicker{display:flex;align-items:center;gap:12px;font-family:var(--serif)}.product-kicker img{width:34px;height:34px}.detail-main h1{font-family:var(--serif);font-size:39px;line-height:1.1;margin:8px 0 14px;max-width:950px}.doc-change{padding-top:26px}.diff-tabs{display:flex;gap:25px;border-bottom:1px solid var(--rule);margin-bottom:15px}.diff-tabs button{font:inherit;border:0;border-bottom:3px solid transparent;background:transparent;padding:0 3px 9px;cursor:pointer}.diff-tabs button.active{color:var(--green);border-color:var(--green);font-weight:650}.diff-panel[hidden]{display:none}.rendered-change{padding:8px 12px;margin:0 0 3px;border-left:3px solid transparent}.rendered-change p,.rendered-change ul,.rendered-change ol,.rendered-change pre,.rendered-change h1,.rendered-change h2,.rendered-change h3{margin:2px 0}.rendered-change.added{background:var(--green-soft);border-color:#79aa89}.rendered-change.removed{background:var(--red-soft);border-color:#c88680;color:#642620;text-decoration:line-through}.rendered-change.context{padding-left:15px}.raw-diff{background:#222824;color:#eef4ef;padding:20px;overflow:auto;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap}.aside-link{display:flex;gap:12px;margin:0 0 22px;text-decoration:none}.aside-link img{width:21px;height:21px}.related-item{margin:0 0 19px}.related-item time{display:block;color:var(--green);font-family:var(--serif)}.related-item a{color:var(--ink);text-decoration:none;font-family:var(--serif)}.calendar{display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid var(--rule);border-left:1px solid var(--rule);margin:14px 0 28px}.calendar-head,.calendar-day{border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:9px;min-height:83px}.calendar-head{min-height:auto;text-align:center;font-family:var(--serif);font-size:11px;letter-spacing:.05em;text-transform:uppercase}.calendar-day strong{display:block;font-family:var(--serif);font-weight:500}.calendar-day.selected{outline:1px solid var(--green);outline-offset:-2px;background:#eef3ed}.day-icons{display:flex;gap:4px;margin-top:8px}.day-icons img{width:22px;height:22px;object-fit:contain}.table{width:100%;border-collapse:collapse;font-family:var(--serif)}.table th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.table td,.table th{border-bottom:1px solid var(--rule);padding:8px 6px}.table img{width:24px;height:24px;vertical-align:middle;margin-right:8px}.footer{border-top:1px solid var(--rule);padding:22px 3vw;color:var(--muted);display:flex;justify-content:space-between;gap:20px;font-size:13px}.quiet{color:var(--muted)}.mc-body{max-width:820px}.mc-body h1,.mc-body h2,.mc-body h3{font-family:var(--serif)}.mc-body table{border-collapse:collapse;width:100%}.mc-body td,.mc-body th{border:1px solid var(--rule);padding:8px}.empty{border:1px solid var(--rule);padding:30px;margin-top:20px}.mobile-menu{display:none}
.story-row{display:block;padding:10px 0}.story-source{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin:4px 0 3px;color:var(--muted);font-size:12px}.story-source .mc-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--green)}.story-source a{font-family:var(--sans);font-weight:650}.summary-grid.single{grid-template-columns:minmax(0,820px);gap:0}.month-overview{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.85fr);gap:50px;padding:4px 0 30px;margin:0 0 30px;border-bottom:1px solid var(--rule)}.month-overview h2{font-family:var(--serif);font-size:29px;line-height:1.2;margin:7px 0 12px}.month-overview p{margin:0;max-width:700px}.month-highlights{list-style:none;padding:0;margin:0;border-top:1px solid var(--rule)}.month-highlights li{padding:11px 0;border-bottom:1px solid var(--rule)}.month-highlights a{display:block;color:var(--ink);font-family:var(--serif);font-size:17px;line-height:1.25;text-decoration:none}.month-highlights a:hover{text-decoration:underline;text-decoration-color:var(--green)}.month-highlights .taxonomy{margin-top:3px}.calendar-date-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.calendar-count{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 6px;border-radius:999px;background:var(--green);color:#fff;font:700 11px/1 var(--sans);text-decoration:none}.related-meta{display:block;color:var(--green);font-family:var(--serif);font-size:14px}.related-meta a{font-family:var(--serif);color:var(--green);text-decoration:underline}.weekday-short{display:none}
.product-groups{margin-top:20px}.product-update-group{border-top:1px solid var(--rule);padding:22px 0 12px}.product-group-header{display:flex;align-items:center;gap:14px;margin:0 0 18px}.product-group-header img{width:38px;height:38px;object-fit:contain}.product-group-header h2{font-family:var(--serif);font-size:24px;line-height:1.15;margin:0}.product-group-header h2 a{color:var(--ink);text-decoration:none}.product-group-count{display:block;color:var(--muted);font-size:12px;margin-top:2px}.topic-update-group{margin:0 0 22px 52px}.topic-group-header{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--rule);padding-bottom:7px}.topic-group-title{display:flex;min-width:0;align-items:center;gap:8px}.topic-group-title img{width:21px;height:21px;object-fit:contain;flex:0 0 auto}.topic-group-header h3{min-width:0;font-family:var(--serif);font-size:16px;line-height:1.2;margin:0}.topic-group-header h3 a{color:var(--green);text-decoration:none}.topic-group-count{color:var(--muted);font-size:12px}.grouped-story{padding:10px 0;border-bottom:1px solid rgba(216,211,199,.72)}.grouped-story-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.grouped-story h4{font-family:var(--serif);font-size:18px;font-weight:500;line-height:1.3;margin:0}.grouped-story h4 a{color:var(--ink);text-decoration:none}.grouped-story h4 a:hover{text-decoration:underline;text-decoration-color:var(--green)}.change-pill{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border:1px solid var(--rule);border-radius:999px;padding:2px 8px;font:700 10px/1.4 var(--sans);letter-spacing:.06em;text-transform:uppercase}.change-pill.new{background:var(--green-soft);border-color:#a9c8b5;color:var(--green)}.change-pill.updated{background:#ece9e1;color:#4c5653}.change-pill.removed{background:var(--red-soft);border-color:#d7aaa6;color:var(--red)}.change-pills{display:inline-flex;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;gap:6px}.change-pill.nature.doc-update{background:#ece9e1;border-color:#c4bdae;color:#4c5653}.change-pill.nature.feature-update{background:#e6eef7;border-color:#a9c0da;color:#1c4e80}.change-pill.nature.new-feature{background:var(--green-soft);border-color:#a9c8b5;color:var(--green)}.change-pill.nature.private-preview{background:transparent;border-style:dashed;border-color:#a682c9;color:#5c3a8a}.change-pill.nature.public-preview{background:#f6e6fb;border-color:#cfaee0;color:#5c3a75}.change-pill.nature.generally-available{background:#e2efe6;border-color:#9dc0a8;color:#175c33}.change-pill.nature.retirement{background:var(--red-soft);border-color:#d7aaa6;color:var(--red)}.change-pill.action-required{background:#fbeed8;border-color:#d9b478;color:#7a4c07}.story-support{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin-top:4px;color:var(--muted);font-size:12px}.story-support .story-source{margin:0}.month-overview.compact{grid-template-columns:minmax(0,760px);margin-bottom:20px}.rail-count-list{list-style:none;padding:0;margin:0}.rail-count-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--rule)}.rail-count-list a{display:flex;align-items:center;gap:8px;color:var(--ink);font-family:var(--serif);font-size:14px}.rail-count-list img{width:22px;height:22px;object-fit:contain}.rail-count{color:var(--muted);font-family:var(--serif)}
.left-rail .product-list a,.left-rail .topic-rail .plain-list a,.detail-aside .plain-list a,.period-product-rail .rail-count-list a{display:flex;align-items:center;margin-inline:-8px;padding:0 8px;border-radius:5px;color:var(--ink);text-decoration:none;transition:background-color .15s ease,color .15s ease,box-shadow .15s ease,transform .15s ease}.left-rail .product-list a:hover,.left-rail .topic-rail .plain-list a:hover,.detail-aside .plain-list a:hover,.period-product-rail .rail-count-list a:hover,.left-rail .product-list a:focus-visible,.left-rail .topic-rail .plain-list a:focus-visible,.detail-aside .plain-list a:focus-visible,.period-product-rail .rail-count-list a:focus-visible{background:var(--green-soft);box-shadow:inset 3px 0 0 var(--green);color:var(--green);text-decoration:none;transform:translateX(3px)}.left-rail .product-list a:focus-visible,.left-rail .topic-rail .plain-list a:focus-visible,.detail-aside .plain-list a:focus-visible,.period-product-rail .rail-count-list a:focus-visible{outline:2px solid var(--green);outline-offset:2px}@media(prefers-reduced-motion:reduce){.left-rail .product-list a,.left-rail .topic-rail .plain-list a,.detail-aside .plain-list a,.period-product-rail .rail-count-list a{transition:none}.left-rail .product-list a:hover,.left-rail .topic-rail .plain-list a:hover,.detail-aside .plain-list a:hover,.period-product-rail .rail-count-list a:hover,.left-rail .product-list a:focus-visible,.left-rail .topic-rail .plain-list a:focus-visible,.detail-aside .plain-list a:focus-visible,.period-product-rail .rail-count-list a:focus-visible{transform:none}}
.site-link[aria-current="page"]{color:var(--green);font-weight:650}.about-layout{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 270px;min-height:calc(100vh - 78px)}.about-main{padding:56px 64px 82px 36px}.about-aside{border-left:1px solid var(--rule);padding:62px 30px}.about-kicker{display:flex;align-items:center;gap:13px;margin-bottom:26px}.about-kicker img{width:42px;height:42px;object-fit:contain}.about-hero{border-bottom:1px solid var(--rule);padding-bottom:38px}.about-hero h1{font-family:var(--serif);font-size:52px;line-height:1.04;letter-spacing:-.02em;max-width:820px;margin:0 0 20px}.about-hero .lede{font-size:20px;line-height:1.55;max-width:780px;margin:0}.about-section{padding:34px 0;border-bottom:1px solid var(--rule)}.about-section h2{font-family:var(--serif);font-size:28px;line-height:1.2;margin:0 0 12px}.about-section p{max-width:760px;margin:0 0 14px}.about-section p:last-child{margin-bottom:0}.about-pair{display:grid;grid-template-columns:1fr 1fr;gap:44px}.about-pair .about-section+section{border-left:1px solid var(--rule);padding-left:44px}.community-note{margin-top:34px;border-left:4px solid var(--green);padding:4px 0 4px 24px}.community-note p{font-family:var(--serif);font-size:25px;line-height:1.35;margin:0;max-width:760px}.about-aside .plain-list{margin-bottom:28px}.about-aside .plain-list a{font-family:var(--serif)}.about-aside p{font-size:14px;color:var(--muted)}
@media(max-width:1050px){.site-header{height:auto;min-height:68px;padding:13px 24px;flex-wrap:wrap;gap:12px}.main-nav{order:3;width:100%;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0 12px}.main-nav a{padding:7px 0;text-align:center;white-space:nowrap}.utility{margin-left:auto;border:0;padding:0}.page-shell{grid-template-columns:220px minmax(0,1fr)}.right-rail{display:none}.content{padding:28px}.detail-layout{grid-template-columns:1fr}.detail-aside{border-left:0;border-top:1px solid var(--rule);padding:28px 48px}.two-column{grid-template-columns:1fr}.two-column>aside{border-top:1px solid var(--rule);padding-top:25px}}
@media(max-width:760px){.site-header{height:auto;min-height:68px;padding:13px 18px;flex-wrap:wrap;gap:12px}.brand{font-size:24px}.brand small{display:none}.main-nav{order:3;width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 12px}.main-nav a{padding:7px 0;text-align:center;white-space:nowrap}.utility{margin-left:auto;border:0;padding:0}.page-shell{display:block}.left-rail{display:none}.content,.detail-main{padding:24px 19px 55px}.detail-aside{padding:27px 19px}.page-title,.detail-main h1{font-size:32px}.period-nav{display:grid;grid-template-columns:1fr;gap:8px;align-items:start}.period-nav h1{font-size:22px;grid-row:2}.period-nav>span:empty{display:none}.story-row{grid-template-columns:75px 1fr}.summary-grid{grid-template-columns:1fr}.summary-grid>div+div{border-left:0;border-top:1px solid var(--rule);padding:22px 0 0}.hero-product{grid-template-columns:75px 1fr}.hero-product>img{width:70px;height:70px}.hero-product h1{font-size:34px}.article-list article{grid-template-columns:1fr;gap:4px}.calendar-head{font-size:8px;padding:6px 2px}.calendar-day{min-height:64px;padding:5px}.calendar .day-icons img:nth-child(n+2){display:none}.footer{display:block}.footer div+div{margin-top:8px}}
@media(max-width:760px){.month-overview{grid-template-columns:1fr;gap:24px}.calendar{width:100%;min-width:0}.calendar-head,.calendar-day{min-width:0}.weekday-long{display:none}.weekday-short{display:inline}.calendar-count{min-width:20px;height:18px;padding:0 5px;font-size:10px}.day-icons{margin-top:5px}}
@media(max-width:1050px){.month-stats-rail{display:block;grid-column:2;border-left:0;border-top:1px solid var(--rule);padding:28px}}
@media(max-width:1050px){.about-layout{grid-template-columns:minmax(0,1fr) 240px}.about-main{padding:45px 38px 70px}.about-aside{padding:52px 25px}.about-hero h1{font-size:45px}}
@media(max-width:760px){.topic-update-group{margin-left:0}.product-group-header img{width:34px;height:34px}.grouped-story-head{align-items:flex-start}.month-stats-rail{display:block;padding:26px 19px}}
@media(max-width:760px){.about-layout{display:block}.about-main{padding:36px 19px 54px}.about-aside{border-left:0;border-top:1px solid var(--rule);padding:30px 19px}.about-hero h1{font-size:38px}.about-hero .lede{font-size:18px}.about-pair{grid-template-columns:1fr;gap:0}.about-pair .about-section+section{border-left:0;padding-left:0}.community-note{padding-left:18px}.community-note p{font-size:22px}}
#daily-email,#stay-current{scroll-margin-top:96px}.daily-email-signup{border:1px solid var(--rule);border-radius:8px;background:#f0eee6;padding:28px 30px}.daily-email-signup h2{margin:5px 0 10px}.daily-email-signup>p{max-width:760px}.daily-email-form{max-width:680px;margin-top:20px;min-height:96px}.daily-email-fallback{margin-top:18px;padding:14px 16px;border-left:3px solid var(--green);background:var(--paper)}.update-paths{display:grid;grid-template-columns:1fr 1fr;gap:44px}.update-path{padding-top:5px}.update-path+.update-path{border-left:1px solid var(--rule);padding-left:44px}.update-path h3{font-family:var(--serif);font-size:23px;line-height:1.2;margin:6px 0 10px}.update-path p{margin-bottom:13px}.update-link{display:inline-block;font-family:var(--serif);font-size:17px;font-weight:650}.about-aside .stay-current a{font-family:var(--serif);font-weight:650}@media(max-width:760px){#daily-email,#stay-current{scroll-margin-top:200px}.daily-email-signup{padding:22px 20px}.update-paths{grid-template-columns:1fr;gap:26px}.update-path+.update-path{border-left:0;border-top:1px solid var(--rule);padding:26px 0 0}}
.daily-email-dialog-open{overflow:hidden}.daily-email-trigger{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 17px;border:1px solid var(--green);border-radius:5px;background:var(--green);color:#fff;font:700 14px/1.2 var(--sans);text-decoration:none;cursor:pointer}.daily-email-trigger:hover{background:#083b30;color:#fff}.daily-email-trigger:focus-visible,.daily-email-dialog-close:focus-visible{outline:2px solid var(--green);outline-offset:3px}.rss-box .daily-email-trigger{min-height:0;padding:0;border:0;background:transparent;color:var(--green);font-family:var(--serif);font-size:16px;text-align:left;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}.daily-email-dialog{width:min(620px,calc(100vw - 34px));max-height:calc(100dvh - 34px);padding:0;border:1px solid var(--rule);border-radius:10px;background:var(--paper);color:var(--ink);box-shadow:0 22px 70px rgba(8,13,11,.3);overflow:auto}.daily-email-dialog::backdrop{background:rgba(8,13,11,.58);backdrop-filter:blur(3px)}.daily-email-dialog-card{position:relative;padding:34px 36px 36px}.daily-email-dialog-card h2{margin:6px 42px 11px 0;font-family:var(--serif);font-size:32px;line-height:1.12}.daily-email-dialog-intro{max-width:520px;margin:0;color:var(--muted)}.daily-email-dialog-close{position:absolute;top:20px;right:20px;display:grid;place-items:center;width:36px;height:36px;padding:0;border:1px solid var(--rule);border-radius:50%;background:transparent;color:var(--ink);font:25px/1 var(--sans);cursor:pointer}.daily-email-dialog-close:hover{border-color:var(--green);color:var(--green)}.daily-email-dialog .daily-email-form{max-width:none;margin-top:24px}.daily-email-form-loading{display:flex;align-items:center;gap:10px;min-height:74px;margin:0;padding:18px;border:1px solid var(--rule);border-radius:6px;background:#fff;color:var(--muted)}.daily-email-form-loading:before{content:"";width:17px;height:17px;border:2px solid var(--rule);border-top-color:var(--green);border-radius:50%;animation:daily-email-spin .8s linear infinite}@keyframes daily-email-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.daily-email-form-loading:before{animation-duration:1.8s}}@media(max-width:600px){.daily-email-dialog{width:calc(100vw - 20px);max-height:calc(100dvh - 20px)}.daily-email-dialog-card{padding:28px 21px 25px}.daily-email-dialog-card h2{font-size:28px}.daily-email-dialog-close{top:15px;right:15px}}
:root[data-theme="dark"] .daily-email-dialog{background:#111512}:root[data-theme="dark"] .daily-email-form-loading{border-color:#59635f;background:#171b19}
.product-update-group{scroll-margin-top:96px}.period-product-rail .rail-heading:first-child{margin-bottom:14px}.period-product-rail .rail-count-list{margin-bottom:2px}
.landing-intro{padding:15px 0 16px;border-bottom:1px solid var(--rule)}.landing-intro h2{font-family:var(--serif);font-size:19px;font-style:italic;line-height:1.25;margin:0 0 3px}.landing-intro p{max-width:780px;margin:0;color:var(--muted);font-size:13.5px;font-style:italic;line-height:1.5}.landing-intro a{font-family:inherit;font-weight:650}.footer{display:block;padding:0;color:var(--ink);font-size:14px;background:#f0eee6}.footer-inner{max-width:1420px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.8fr) minmax(280px,.8fr);gap:0;padding:52px 3.2vw 46px}.footer-feature{padding-right:54px}.footer-feature-lockup{display:flex;align-items:center;gap:15px;margin:7px 0 15px}.footer-feature-logo{width:56px;height:56px;object-fit:contain;flex:0 0 auto}.footer-feature h2{font-family:var(--serif);font-size:40px;line-height:1.05;margin:0}.footer-feature h2 a{color:var(--ink);text-decoration:none}.footer-feature p{font-size:17px;line-height:1.55;max-width:620px;margin:0 0 17px;color:#34403d}.footer-cta{display:inline-block;font-family:var(--serif);font-size:17px;font-weight:650}.footer-projects,.footer-support{border-left:1px solid var(--rule);padding-left:38px}.footer-section-title{font-family:var(--serif);font-size:21px;line-height:1.2;margin:0 0 16px}.footer-project-list{list-style:none;margin:0;padding:0}.footer-project-list li{padding:7px 0;border-bottom:1px solid rgba(216,211,199,.85)}.footer-project-list a{color:var(--ink);font-family:var(--serif);font-size:16px;text-decoration:none}.footer-project-list a:hover{text-decoration:underline;text-decoration-color:var(--green)}.footer-support p{color:#34403d;max-width:300px;margin:0 0 16px}.footer-support-links{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.footer-support-links a{font-family:var(--serif);font-size:16px;font-weight:650}.footer-bottom{border-top:1px solid var(--rule);max-width:1420px;margin:0 auto;padding:20px 3.2vw 24px;display:flex;justify-content:space-between;gap:24px;color:var(--muted);font-size:13px}.footer-bottom nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px}.footer-bottom a{color:var(--muted)}.footer-rss-link{display:inline-flex;align-items:center;gap:6px}.footer-rss-link img{width:15px;height:15px}.refresh-status{display:flex;flex-wrap:wrap;gap:3px 14px;margin-top:5px;font-size:12px}.refresh-status time{color:#35413e}.refresh-relative{white-space:nowrap}
@media(max-width:1050px){.footer-inner{grid-template-columns:1fr 1fr}.footer-feature{grid-column:1/-1;border-bottom:1px solid var(--rule);padding:0 0 35px;margin-bottom:35px}.footer-projects{border-left:0;padding-left:0;padding-right:35px}.footer-support{padding-left:35px}}
@media(max-width:760px){.product-update-group{scroll-margin-top:200px}.landing-intro{padding:13px 0 14px}.landing-intro h2{font-size:18px}.landing-intro p{font-size:13px}.footer{display:block}.footer-inner{display:block;padding:38px 19px 34px}.footer-feature{padding-bottom:30px;margin-bottom:30px}.footer-feature-lockup{gap:13px;margin-bottom:14px}.footer-feature-logo{width:48px;height:48px}.footer-feature h2{font-size:34px}.footer-projects,.footer-support{border-left:0;padding:0}.footer-support{border-top:1px solid var(--rule);margin-top:30px;padding-top:30px}.footer div+div{margin-top:0}.footer-bottom{display:block;padding:20px 19px 26px}.footer-bottom nav{margin-top:14px}.refresh-status{display:block}.refresh-status span{display:block;margin-top:3px}}
.rendered-change.changed{background:#efede6;border-color:#9a927f}.rendered-table{padding:0;margin:16px 0 22px;background:transparent!important;border-left:0}.rendered-table table{width:100%;border-collapse:collapse;background:#fff}.rendered-table th,.rendered-table td{border:1px solid #c9c9c9;padding:13px 15px;text-align:left;vertical-align:top}.rendered-table th{font-weight:700;background:#fafafa}.rendered-table tr.diff-row.added td{background:var(--green-soft)}.rendered-table tr.diff-row.removed td{background:var(--red-soft);color:#642620;text-decoration:line-through}.learn-alert{--alert-bg:#efd9fd;--alert-border:#3b2e58;display:block;margin:20px 0 24px;padding:20px 24px;border:1px solid var(--alert-border);border-radius:10px;background:var(--alert-bg);color:var(--ink)}.learn-alert-note{--alert-bg:#efd9fd;--alert-border:#3b2e58}.learn-alert-tip{--alert-bg:#f1faf1;--alert-border:#0e700e}.learn-alert-important{--alert-bg:#ebf3fc;--alert-border:#115ea3}.learn-alert-caution{--alert-bg:#fff9f5;--alert-border:#8a3707}.learn-alert-warning{--alert-bg:#fdf3f4;--alert-border:#b10e1c}.learn-alert-title{display:flex;align-items:center;gap:10px;margin:0 0 14px;color:var(--alert-border);font-weight:700;font-size:18px}.learn-alert-icon{display:inline-flex;align-items:center;justify-content:center;width:21px;height:21px;border:2px solid currentColor;border-radius:50%;font:700 13px/1 var(--sans)}.learn-alert-body p,.learn-alert-body ul,.learn-alert-body ol,.learn-alert-body pre{margin:0 0 10px}.learn-alert-body>*:last-child,.learn-alert-change>*:last-child{margin-bottom:0}.learn-alert-change{padding:7px 10px;margin:0 -10px 3px;border-left:3px solid transparent}.learn-alert-change.added{background:rgba(227,238,232,.78);border-color:#79aa89}.learn-alert-change.removed{background:rgba(243,223,220,.82);border-color:#c88680;color:#642620;text-decoration:line-through}.learn-alert.diff-added{box-shadow:inset 4px 0 #79aa89}.learn-alert.diff-removed{box-shadow:inset 4px 0 #c88680}.learn-alert.diff-changed{box-shadow:inset 4px 0 #9a927f}@media(max-width:760px){.rendered-table{overflow-x:auto}.rendered-table table{min-width:560px}.rendered-table th,.rendered-table td{padding:10px 12px}.learn-alert{padding:17px 18px}}
:root[data-theme="dark"] .learn-alert-note{--alert-bg:#251f33;--alert-border:#cbb7f2}:root[data-theme="dark"] .learn-alert-tip{--alert-bg:#15291c;--alert-border:#84d492}:root[data-theme="dark"] .learn-alert-important{--alert-bg:#152534;--alert-border:#8ec2f2}:root[data-theme="dark"] .learn-alert-caution{--alert-bg:#2e2015;--alert-border:#eeab73}:root[data-theme="dark"] .learn-alert-warning{--alert-bg:#331c1f;--alert-border:#f29ba1}:root[data-theme="dark"] .learn-alert-change.added{background:rgba(31,75,56,.72);border-color:#4f8f6c}:root[data-theme="dark"] .learn-alert-change.removed{background:rgba(85,45,51,.75);border-color:#a5646a;color:#ffc3c8}
.story-description{max-width:780px;margin:5px 0 0;color:#56615f;font-size:13px;line-height:1.45}.rich-diff{max-width:960px;padding:8px 0 18px;font-size:16px;line-height:1.62}.rich-diff h1,.rich-diff h2,.rich-diff h3,.rich-diff h4{font-family:var(--serif);line-height:1.2;margin:26px 0 11px}.rich-diff h1{font-size:30px}.rich-diff h2{font-size:25px}.rich-diff h3{font-size:20px}.rich-diff p,.rich-diff ul,.rich-diff ol{margin:0 0 16px}.rich-diff pre{overflow:auto;border:1px solid var(--rule);background:#f0eee7;padding:14px}.rich-diff code{font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.rich-diff table{width:100%;border-collapse:collapse;margin:20px 0 26px;background:#fff}.rich-diff th,.rich-diff td{border:1px solid #c9c9c9;padding:13px 15px;text-align:left;vertical-align:top}.rich-diff th{font-weight:700;background:#fafafa}.rich-diff ins{border-radius:3px;background:#c8f1da;color:#164f35;padding:1px 2px;text-decoration:none}.rich-diff del{border-radius:3px;background:#ffd7df;color:#7c2032;padding:1px 2px;text-decoration:line-through}.rich-diff ins a,.rich-diff del a{color:inherit}.rich-diff>ins,.rich-diff>del{display:block;background:transparent;color:inherit;padding:0;text-decoration:none}.rich-diff>ins:has(.learn-alert) .learn-alert{box-shadow:inset 4px 0 #79aa89}.rich-diff>del:has(.learn-alert) .learn-alert{box-shadow:inset 4px 0 #c88680}.markdown-diff{max-width:100%;overflow:hidden;border:1px solid #c9c9c9;border-radius:6px;background:#fff}.markdown-diff pre{margin:0;padding:10px 0;overflow:auto;background:#fff;color:#24292f;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2}.markdown-diff code{display:block;min-width:max-content}.markdown-diff-line{display:block;min-height:1.55em;padding:0 16px;white-space:pre}.markdown-diff-line.added,.markdown-diff-line.file-new{background:#dafbe1;color:#116329}.markdown-diff-line.removed,.markdown-diff-line.file-old{background:#ffebe9;color:#82071e}.markdown-diff-line.hunk{background:#ddf4ff;color:#0969da}.markdown-diff-line.meta{color:#57606a;font-weight:600}.markdown-diff-line.context{color:#57606a}@media(max-width:1320px) and (min-width:1051px){.site-header{gap:18px;padding-left:2vw;padding-right:2vw}.brand{font-size:27px}.brand small{display:none}.main-nav{gap:18px}.utility{gap:12px;padding-left:16px}.site-link{font-size:12px}}@media(max-width:760px){.story-description{font-size:12.5px}.rich-diff{font-size:15px}.rich-diff table{display:block;overflow-x:auto}.rich-diff th,.rich-diff td{min-width:180px;padding:10px 12px}.markdown-diff pre{font-size:12px}}
.brand{display:inline-flex;align-items:center;gap:10px;line-height:1}.brand-logo{width:38px;height:38px;object-fit:contain;flex:0 0 auto}.brand small{margin-left:4px;line-height:1.2}@media(min-width:1051px){.site-header{padding-left:max(24px,calc((100vw - 1420px)/2 + 24px));padding-right:max(24px,calc((100vw - 1420px)/2 + 24px))}.main-nav{align-self:stretch}.main-nav a{display:flex;align-items:center;padding:4px 0 0}}@media(max-width:1050px){.main-nav{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:760px){.brand{gap:8px}.brand-logo{width:32px;height:32px}.main-nav{grid-template-columns:repeat(2,minmax(0,1fr))}}
.detail-main{min-width:0}.editorial-summary{min-width:0;max-width:100%;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0;margin:22px 0 0;padding:0;border:1px solid #c8d2cc;border-radius:6px;overflow:hidden;background:#f5f7f4}.editorial-summary>.editorial-panel{min-width:0;max-width:100%;padding:23px 26px 24px}.editorial-panel.admin{border-left:1px solid #c8d2cc;background:#e9f0ec}.editorial-panel .section-title{max-width:100%;font-size:22px;margin-bottom:10px;overflow-wrap:anywhere}.editorial-panel p{max-width:100%;margin:0;color:#26302d;overflow-wrap:anywhere}.ai-disclosure{min-width:0;max-width:100%;grid-column:1/-1;margin:0;padding:9px 26px;border-top:1px solid #c8d2cc;background:#f0f2ee;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.doc-source-intro{display:block;margin:0 0 18px;padding:0 0 17px;border-bottom:1px solid var(--rule)}.doc-source-intro p{width:100%;max-width:none;margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.45}.learn-link{display:inline-flex;align-items:center;gap:9px;flex:0 0 auto;font-family:var(--serif);font-weight:650;text-decoration:none}.learn-link img{width:21px;height:21px}.grouped-story[id]{scroll-margin-top:96px}@media(max-width:760px){.editorial-summary{display:block;width:100%}.editorial-summary>.editorial-panel{width:100%;padding:20px 19px}.editorial-panel.admin{border-left:0;border-top:1px solid #c8d2cc}.ai-disclosure{display:block;width:100%;padding:9px 19px}.doc-source-intro p{margin-top:10px}.grouped-story[id]{scroll-margin-top:200px}}
.mini-calendar-header{display:grid;grid-template-columns:25px minmax(0,1fr) 25px;align-items:center;gap:5px;margin-bottom:10px}.mini-calendar-title{margin:0;text-align:center}.mini-month-nav{display:grid;place-items:center;width:25px;height:25px;padding:0;border:1px solid var(--rule);border-radius:50%;color:var(--green);font:20px/1 Arial,sans-serif;text-decoration:none}.mini-month-nav>span{display:block;line-height:1;transform:translateY(-1px)}.mini-month-nav:hover{border-color:var(--green);background:#eef3ed}.mini-month-nav.disabled{color:#aaa79f;background:#eceae4;cursor:default}.mini-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.mini-weekday{padding:0 0 5px;text-align:center;color:var(--muted);font:700 9px/1 var(--sans);text-transform:uppercase}.mini-day{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:0;height:30px;border:1px solid transparent;color:var(--ink);font-family:var(--serif);font-size:12px;line-height:1;text-decoration:none}.mini-day:hover{border-color:#aebbb4;background:#eef3ef;color:var(--green)}.mini-day.selected{border-color:var(--green);border-radius:6px;background:#eef3ed;color:var(--green);font-weight:700}.mini-day.outside{background:transparent;color:#aaa79f}.mini-day.outside:hover{background:transparent;color:#716f69}.mini-update-dot{display:block;width:4px;height:4px;border-radius:50%;background:var(--green)}.mini-day.outside .mini-update-dot{background:#85827c}.mini-month-link{display:inline-block;margin-top:10px;font-size:12px}.day-rail .rss-box{margin-top:2px}@media(max-width:760px){.mini-calendar-grid{gap:5px}.mini-day{height:36px;font-size:13px}.mini-calendar-header{grid-template-columns:30px minmax(0,1fr) 30px}.mini-month-nav{width:30px;height:30px}}
.period-brief{padding-bottom:28px}.period-brief .period-overview{max-width:900px;font-size:17px;line-height:1.6}.period-key-changes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 34px;max-width:940px;margin:24px 0 22px;padding:0;list-style:none;border-top:1px solid var(--rule)}.period-key-changes li{min-width:0;padding:14px 0 13px;border-bottom:1px solid var(--rule)}.period-change-heading{display:block;min-width:0}.period-change-heading strong{display:block;width:100%;font-family:var(--serif);font-size:17px;line-height:1.25}.period-change-heading strong a{color:inherit;text-decoration:none}.period-change-heading strong a:hover{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}.period-change-taxonomy{display:flex;min-width:0;align-items:center;gap:7px;margin:0 0 7px;color:var(--green);font-size:11px;font-weight:700;letter-spacing:.04em;line-height:1.35;text-transform:uppercase}.period-change-taxonomy img{width:22px;height:22px;object-fit:contain;flex:0 0 auto}.period-change-taxonomy img.topic-icon{width:18px;height:18px}.period-change-taxonomy span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.period-key-changes p{max-width:none;margin:7px 0 0;color:#46514e;font-size:13px;line-height:1.5}.period-admin-focus{max-width:900px;padding:14px 18px;border-left:3px solid var(--green);background:var(--green-soft)}.period-admin-focus>strong{font-family:var(--serif);font-size:16px}.period-admin-focus p{max-width:none;margin:3px 0 0}.period-ai-note{margin:12px 0 0!important;color:var(--muted);font-size:11px}.period-brief+.story-list{margin-top:25px}.detail-taxonomy-lockup{display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px}.topic-kicker{display:inline-flex;align-items:center;gap:7px;color:var(--green);font-family:var(--serif)}.topic-kicker img{width:24px;height:24px;object-fit:contain}.topic-directory-icon{width:44px;height:44px;object-fit:contain}@media(max-width:760px){.period-key-changes{grid-template-columns:1fr}.period-brief .period-overview{font-size:16px}.period-change-taxonomy{max-width:100%}}
.period-picker-nav{position:relative;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;justify-content:normal;min-height:58px;padding-bottom:15px;overflow:visible}.period-picker-nav>.period-nav-previous{justify-self:start}.period-picker-nav>.period-picker{justify-self:center}.period-picker-nav>.period-nav-next{justify-self:end}.period-picker{position:relative;display:flex;justify-content:center}.period-picker-trigger{display:inline-flex;align-items:center;justify-content:center;gap:11px;min-height:42px;padding:5px 10px;border:0;background:transparent;color:var(--green);font-family:var(--serif);font-size:27px;font-weight:650;line-height:1.15;cursor:pointer}.period-picker-trigger:hover{color:#083b30}.period-picker-trigger:focus-visible,.period-picker-shift:focus-visible,.period-picker-day:focus-visible,.period-picker-month:focus-visible{outline:2px solid var(--green);outline-offset:3px}.period-picker-trigger img{display:block;flex:0 0 auto}.period-picker-calendar-icon{width:21px;height:21px}.period-picker-caret{width:14px;height:14px;transition:transform .16s ease}.period-picker-trigger[aria-expanded="true"] .period-picker-caret{transform:rotate(180deg)}.period-picker-popover{position:absolute;z-index:30;top:calc(100% + 9px);left:50%;width:366px;max-width:calc(100vw - 38px);padding:17px 17px 18px;transform:translateX(-50%);border:1px solid #cfcabd;border-radius:7px;background:#fbfaf6;box-shadow:0 10px 30px rgba(17,24,29,.16)}.period-picker-popover[hidden]{display:none}.period-picker-panel-head{display:grid;grid-template-columns:32px minmax(0,1fr) 32px;align-items:center;gap:8px;margin-bottom:13px}.period-picker-panel-head>strong{text-align:center;font-family:var(--serif);font-size:19px;font-weight:600}.period-picker-shift{display:grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:50%;background:transparent;cursor:pointer}.period-picker-shift:hover:not(:disabled){border-color:var(--rule);background:#f0eee7}.period-picker-shift:disabled{opacity:.28;cursor:default}.period-picker-shift img{width:16px;height:16px}.period-picker-shift.previous img{transform:rotate(180deg)}.period-picker-weekdays,.period-picker-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.period-picker-weekdays span{padding:2px 0 8px;text-align:center;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase}.period-picker-day{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:38px;border:1px solid transparent;color:var(--ink);font-family:var(--serif);font-size:14px;line-height:1;text-decoration:none}.period-picker-day:hover:not(.disabled){position:relative;z-index:1;border-color:#95ab9f;color:var(--green)}.period-picker-day.outside{color:#a6a29a}.period-picker-day.selected-week{border-color:#9db2a6;border-left-color:transparent;border-right-color:transparent;background:var(--green-soft);color:var(--green);font-weight:700}.period-picker-day.selected-week.week-start{border-left-color:#9db2a6;border-radius:5px 0 0 5px}.period-picker-day.selected-week.week-end{border-right-color:#9db2a6;border-radius:0 5px 5px 0}.period-picker-day.disabled{opacity:.36}.period-picker-update-dot{display:block;width:4px;height:4px;border-radius:50%;background:var(--green)}.period-picker-months{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.period-picker-month{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:61px;border:1px solid var(--rule);border-radius:5px;color:var(--ink);text-decoration:none}.period-picker-month strong{font-family:var(--serif);font-size:16px;font-weight:600}.period-picker-month span{margin-top:2px;color:var(--muted);font-size:10px}.period-picker-month:hover:not(.disabled){border-color:#95ab9f;background:#f1f4f0;color:var(--green)}.period-picker-month.selected{border-color:var(--green);background:var(--green-soft);color:var(--green)}.period-picker-month.disabled{opacity:.32}.period-timeline{position:relative;margin:0;padding:0 0 0 13px;border-left:1px solid #c8c3b7;list-style:none}.period-timeline li{position:relative;margin:0;padding:0}.period-timeline li:before{position:absolute;z-index:1;top:16px;left:-18px;width:9px;height:9px;border:1px solid #bcb7ac;border-radius:50%;background:var(--paper);content:""}.period-timeline li.selected:before{border-color:var(--green);background:var(--green)}.period-timeline a{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-height:42px;margin:0 0 1px;padding:8px 7px 8px 10px;color:var(--ink);font-family:var(--serif);font-size:13px;line-height:1.2;text-decoration:none}.period-timeline a:hover{background:#eeece5;color:var(--green)}.period-timeline li.selected a{margin-left:-14px;padding-left:21px;border-left:3px solid var(--green);background:#e8eee9;color:var(--ink);font-weight:650}.period-timeline .rail-count{font-size:12px}.period-product-rail>.rail-heading:first-child{margin-bottom:13px}
@media(max-width:1050px){.period-picker-popover{position:fixed;top:142px;left:50%;max-height:calc(100vh - 162px);overflow:auto}}
@media(max-width:760px){.period-picker-nav{display:grid;grid-template-columns:1fr 1fr;min-height:52px;align-items:center;gap:8px}.period-picker-nav>.period-picker{grid-column:1/-1;grid-row:1;justify-self:center}.period-picker-nav>.period-nav-previous{grid-column:1;grid-row:2;justify-self:start}.period-picker-nav>.period-nav-next{grid-column:2;grid-row:2;justify-self:end}.period-picker-trigger{max-width:100%;font-size:22px}.period-picker-popover{position:fixed;top:136px;left:50%;width:min(366px,calc(100vw - 28px));max-height:calc(100vh - 156px);overflow:auto}.period-picker-day{height:40px}.period-picker-month{min-height:57px}}
.footer-feedback-button{padding:0;border:0;background:transparent;color:var(--muted);font:inherit;cursor:pointer;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px}.footer-feedback-button:hover{color:var(--green);text-decoration-color:currentColor}.footer-feedback-button:focus-visible{outline:2px solid var(--green);outline-offset:3px}
:root[data-theme="dark"] .landing-intro p{color:#cbd3cf}
.theme-picker{display:inline-flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--rule);border-radius:999px;background:var(--paper)}.theme-option{display:inline-flex;align-items:center;justify-content:center;width:30px;min-width:30px;height:30px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--muted);cursor:pointer}.theme-option span{display:none}.theme-option:hover{color:var(--ink)}.theme-option[aria-pressed="true"]{background:var(--green-soft);color:var(--green);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--green) 28%,transparent)}.theme-option:focus-visible{outline:2px solid var(--green);outline-offset:2px}.theme-option svg{width:15px;height:15px;flex:0 0 auto}@media(max-width:760px){.utility{gap:10px}.theme-picker{padding:2px}.theme-option{width:28px;min-width:28px;height:28px}}
.compare-main{max-width:1160px;min-height:calc(100vh - 78px);margin:0 auto;padding:54px 48px 80px}.compare-hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(360px,.9fr);gap:68px;align-items:end;padding-bottom:42px;border-bottom:1px solid var(--rule)}.compare-hero h1{max-width:700px;margin:8px 0 15px;font-family:var(--serif);font-size:48px;line-height:1.05}.compare-hero .lede{margin:0}.compare-form{padding:24px;border:1px solid var(--rule);border-radius:7px;background:#fbfaf6}.compare-form label{display:block;margin-bottom:7px;font-family:var(--serif);font-size:16px;font-weight:650}.compare-input-row{display:flex;gap:9px}.compare-form input{width:100%;min-width:0;height:44px;padding:9px 12px;border:1px solid #aaa69b;border-radius:4px;background:#fff;color:#11181d;font:14px/1.3 var(--sans)}.compare-form button[type="submit"]{flex:0 0 auto;padding:9px 17px;border:1px solid var(--green);border-radius:4px;background:var(--green);color:#fff;font:700 14px/1 var(--sans);cursor:pointer}.compare-form button:disabled{opacity:.58;cursor:wait}.compare-token{margin-top:14px;color:var(--muted);font-size:13px}.compare-token summary{cursor:pointer}.compare-token label{margin-top:10px;font:600 13px/1.4 var(--sans)}.compare-token p{margin:7px 0 0}.compare-status{margin:15px 0 0;padding:11px 13px;border-left:3px solid var(--green);background:var(--green-soft);font-size:13px}.compare-status.error{border-color:var(--red);background:var(--red-soft);color:var(--red)}.compare-rate{min-height:18px;margin:9px 0 0;color:var(--muted);font-size:11px}.compare-empty{padding:56px 0;text-align:center;color:var(--muted)}.compare-empty strong{display:block;margin-bottom:5px;color:var(--ink);font-family:var(--serif);font-size:23px}.compare-results{padding-top:38px;scroll-margin-top:96px}.compare-results[hidden],.compare-empty[hidden],.compare-status[hidden]{display:none}.compare-result-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:start;padding-bottom:24px;border-bottom:1px solid var(--rule)}.compare-result-head h2{margin:6px 0 8px;font-family:var(--serif);font-size:35px;line-height:1.12}.compare-path{display:block;max-width:750px;color:var(--muted);font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.compare-source-links{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.compare-source-links a{display:inline-flex;align-items:center;gap:7px;color:var(--ink);font-size:12px;text-decoration:none;white-space:nowrap}.compare-source-links a:hover{color:var(--green);text-decoration:underline}.compare-source-links img{width:16px;height:16px;object-fit:contain}.compare-revisions{display:grid;grid-template-columns:1fr 1fr;margin:12px 0 20px;border:1px solid var(--rule);border-radius:5px}.compare-revision{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"label commit date" "message message message";align-items:center;gap:1px 9px;min-width:0;padding:8px 11px}.compare-revision+.compare-revision{border-left:1px solid var(--rule)}.compare-revision>.eyebrow{grid-area:label;font-size:10px}.compare-revision>a,.compare-revision>strong{grid-area:commit;min-width:0;font-size:12px;line-height:1.2}.compare-revision strong{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.compare-revision p{grid-area:message;overflow:hidden;margin:2px 0 0;font-family:var(--serif);font-size:13px;line-height:1.2;text-overflow:ellipsis;white-space:nowrap}.compare-revision span{grid-area:date;color:var(--muted);font-size:10px;white-space:nowrap}.compare-diff-heading{display:flex;align-items:end;justify-content:space-between;gap:20px}.compare-diff-heading .section-title{margin-bottom:5px}.compare-diff-heading p{margin:0;color:var(--muted);font-size:13px}.live-rich-diff{max-width:none}.live-rich-diff img{display:block;max-width:100%;height:auto;margin:18px 0}.live-rich-diff>h1:first-child{margin-top:8px}.live-rich-diff del:has(h1),.live-rich-diff del:has(h2),.live-rich-diff del:has(h3),.live-rich-diff ins:has(h1),.live-rich-diff ins:has(h2),.live-rich-diff ins:has(h3){display:block}.diff-navigator{position:fixed;z-index:40;top:90px;left:50%;display:flex;align-items:center;gap:7px;padding:7px;border:1px solid var(--rule);border-radius:8px;background:rgba(251,250,246,.96);box-shadow:0 8px 28px rgba(17,24,29,.2);backdrop-filter:blur(10px);transform:translateX(-50%)}.diff-navigator[hidden]{display:none}.diff-navigator-label{min-width:58px;padding:0 7px;color:var(--muted);font-size:12px;text-align:center;white-space:nowrap}.diff-navigator button{height:36px;padding:0 13px;border:1px solid var(--rule);border-radius:5px;background:var(--paper);color:var(--green);font:700 13px/1 var(--sans);white-space:nowrap;cursor:pointer}.diff-navigator button:hover{border-color:var(--green);background:var(--green-soft)}.diff-navigator button:focus-visible{outline:2px solid var(--green);outline-offset:2px}.diff-jump-target{scroll-margin-block:160px}.diff-jump-active{outline:2px solid var(--green);outline-offset:7px;border-radius:2px}.markdown-diff-line.diff-jump-active{outline-offset:-2px}.compare-callout{max-width:820px;margin:32px auto 0;padding:16px 19px;border-left:3px solid var(--green);background:var(--green-soft);font-size:13px}.compare-callout p{margin:0}.compare-callout p+p{margin-top:7px}@media(max-width:1050px){.main-nav{grid-template-columns:repeat(5,minmax(0,1fr))}.compare-hero{grid-template-columns:1fr;gap:28px;align-items:start}}@media(max-width:760px){.main-nav{grid-template-columns:repeat(3,minmax(0,1fr))}.compare-main{padding:35px 19px 55px}.compare-hero h1{font-size:38px}.compare-form{padding:18px}.compare-input-row{display:block}.compare-form button[type="submit"]{width:100%;height:43px;margin-top:9px}.compare-result-head{grid-template-columns:1fr}.compare-source-links{align-items:flex-start}.compare-revisions{grid-template-columns:1fr}.compare-revision+.compare-revision{border-left:0;border-top:1px solid var(--rule)}.compare-diff-heading{display:block}.diff-navigator{width:max-content;max-width:calc(100vw - 20px);gap:4px}.diff-navigator-label{min-width:46px;padding:0 3px}.diff-navigator button{padding:0 10px;font-size:12px}}
.diff-navigator-label{order:2}.diff-navigator [data-diff-previous]{order:1}.diff-navigator [data-diff-next]{order:3}
.compare-callout{display:none}
.compare-supported-sources{margin:11px 0 0;color:var(--muted);font-size:12px;line-height:1.45}
.token-drawer-open{overflow:hidden}
.token-drawer-trigger{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--ink);cursor:pointer}.token-drawer-trigger:hover{background:var(--green-soft);color:var(--green)}.token-drawer-trigger:focus-visible{outline:2px solid var(--green);outline-offset:2px}.token-drawer-trigger svg{width:19px;height:19px}.token-drawer-backdrop{position:fixed;z-index:80;inset:0;background:rgba(8,13,11,.42);backdrop-filter:blur(2px)}.token-drawer-backdrop[hidden],.github-token-drawer[hidden]{display:none}.github-token-drawer{position:fixed;z-index:81;top:0;right:0;width:min(430px,100vw);height:100dvh;overflow-y:auto;padding:30px 31px 36px;border-left:1px solid var(--rule);background:var(--paper);box-shadow:-14px 0 42px rgba(10,16,13,.24)}.token-drawer-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:20px;border-bottom:1px solid var(--rule)}.token-drawer-head h2{margin:4px 0 0;font-family:var(--serif);font-size:28px;line-height:1.1}.token-drawer-close{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid var(--rule);border-radius:50%;background:transparent;color:var(--ink);font:24px/1 var(--sans);cursor:pointer}.token-drawer-intro{margin:20px 0 18px;color:var(--muted);font-size:14px}.token-limit-alert{margin:0 0 20px;padding:13px 15px;border-left:3px solid var(--red);background:var(--red-soft);font-size:13px}.token-limit-alert strong{display:block;margin-bottom:3px;font-family:var(--serif);font-size:16px}.token-limit-alert p{margin:0}.github-token-drawer label{display:block;margin:0 0 7px;font-family:var(--serif);font-weight:650}.github-token-drawer input{width:100%;height:44px;padding:9px 11px;border:1px solid #aaa69b;border-radius:4px;background:#fff;color:#11181d;font:14px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace}.token-drawer-actions{display:flex;align-items:center;gap:9px;margin:11px 0 8px}.token-save,.token-forget{min-height:38px;padding:8px 12px;border:1px solid var(--green);border-radius:4px;background:var(--green);color:#fff;font:700 13px/1.2 var(--sans);cursor:pointer}.token-forget{border-color:var(--rule);background:transparent;color:var(--muted)}.token-forget:hover{border-color:var(--red);color:var(--red)}.token-drawer-status{min-height:20px;margin:6px 0;color:var(--green);font-size:12px}.token-rate-status{min-height:20px;margin:3px 0 16px;color:var(--muted);font-size:12px}.token-drawer-help{padding-top:20px;border-top:1px solid var(--rule);font-size:13px}.token-drawer-help h3{margin:0 0 8px;font-family:var(--serif);font-size:18px}.token-drawer-help ol{margin:8px 0 16px;padding-left:21px}.token-drawer-help li{margin-bottom:7px}.token-drawer-warning{padding:10px 12px;border-left:3px solid var(--red);background:var(--red-soft);font-size:12px}.doc-source-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px 22px}.compare-direct-status{max-width:760px;margin:20px auto;padding:16px 18px;border-left:3px solid var(--green);background:var(--green-soft)}.compare-direct-status.error{border-color:var(--red);background:var(--red-soft);color:var(--red)}.compare-direct-status[hidden]{display:none}:root[data-compare-view="diff"] .compare-hero,:root[data-compare-view="diff"] .compare-empty,:root[data-compare-view="diff"] .compare-callout{display:none!important}:root[data-compare-view="diff"] .compare-main{padding-top:28px}:root[data-compare-view="diff"] .compare-results{padding-top:0}@media(max-width:760px){.github-token-drawer{padding:24px 21px 30px}:root[data-compare-view="diff"] .compare-main{padding-top:20px}}
:root[data-theme="dark"]{color-scheme:dark;--paper:#111512;--ink:#edf1ee;--muted:#a7b0ac;--green:#86d3b7;--green-soft:#17382d;--rule:#3b4541;--red:#f1a39d;--red-soft:#472724}:root[data-theme="dark"] body{background:var(--paper)}:root[data-theme="dark"] a:hover{color:#b6ead7}:root[data-theme="dark"] .site-header{background:rgba(17,21,18,.96)}:root[data-theme="dark"] .eyebrow,:root[data-theme="dark"] .lede,:root[data-theme="dark"] .footer-feature p,:root[data-theme="dark"] .footer-support p,:root[data-theme="dark"] .editorial-panel p,:root[data-theme="dark"] .period-key-changes p,:root[data-theme="dark"] .story-description{color:#c3cbc7}:root[data-theme="dark"] .grouped-story,:root[data-theme="dark"] .footer-project-list li{border-bottom-color:rgba(87,99,94,.72)}:root[data-theme="dark"] .change-pill.new{border-color:#3f705e}:root[data-theme="dark"] .change-pill.updated{background:#2b312e;color:#cbd2ce}:root[data-theme="dark"] .change-pill.removed{border-color:#74433f}:root[data-theme="dark"] .change-pill.nature.doc-update{background:#2b312e;border-color:#4c554f;color:#cbd2ce}:root[data-theme="dark"] .change-pill.nature.feature-update{background:#17293a;border-color:#3d5f80;color:#9dc8f0}:root[data-theme="dark"] .change-pill.nature.new-feature{background:var(--green-soft);border-color:#3f705e;color:var(--green)}:root[data-theme="dark"] .change-pill.nature.private-preview{background:transparent;border-color:#7d64a8;color:#cbb7f2}:root[data-theme="dark"] .change-pill.nature.public-preview{background:#2f2340;border-color:#6a5288;color:#dcc2ee}:root[data-theme="dark"] .change-pill.nature.generally-available{background:#153226;border-color:#3f705e;color:#86d3b7}:root[data-theme="dark"] .change-pill.nature.retirement{background:var(--red-soft);border-color:#74433f;color:var(--red)}:root[data-theme="dark"] .change-pill.action-required{background:#37280f;border-color:#7d6329;color:#f0cb8a}:root[data-theme="dark"] .calendar-day.selected,:root[data-theme="dark"] .mini-month-nav:hover,:root[data-theme="dark"] .mini-day.selected,:root[data-theme="dark"] .mini-day:hover{background:#1b332a}:root[data-theme="dark"] .mini-month-nav.disabled{background:#272c29;color:#747c78}:root[data-theme="dark"] .mini-day.outside{color:#78807c}:root[data-theme="dark"] .footer{background:#0c100e}:root[data-theme="dark"] .footer-bottom{border-top-color:var(--rule);background:#090c0a}:root[data-theme="dark"] .editorial-summary{border-color:#46514c;background:#171c19}:root[data-theme="dark"] .editorial-panel.admin{border-color:#46514c;background:#1b2822}:root[data-theme="dark"] .ai-disclosure{border-color:#46514c;background:#141916}:root[data-theme="dark"] .rich-diff pre{background:#191e1b}:root[data-theme="dark"] .rich-diff table,:root[data-theme="dark"] .markdown-diff,:root[data-theme="dark"] .markdown-diff pre{background:#151a17}:root[data-theme="dark"] .rich-diff th{background:#1f2522}:root[data-theme="dark"] .rich-diff th,:root[data-theme="dark"] .rich-diff td,:root[data-theme="dark"] .markdown-diff{border-color:#46514c}:root[data-theme="dark"] .rich-diff ins{background:#1f4b38;color:#b8efce}:root[data-theme="dark"] .rich-diff del{background:#552d33;color:#ffc3c8}:root[data-theme="dark"] .markdown-diff pre{color:#d8dedb}:root[data-theme="dark"] .markdown-diff-line.added,:root[data-theme="dark"] .markdown-diff-line.file-new{background:#173b29;color:#a9e7bc}:root[data-theme="dark"] .markdown-diff-line.removed,:root[data-theme="dark"] .markdown-diff-line.file-old{background:#482529;color:#ffc0c0}:root[data-theme="dark"] .markdown-diff-line.hunk{background:#183747;color:#9bd8ff}:root[data-theme="dark"] .markdown-diff-line.meta,:root[data-theme="dark"] .markdown-diff-line.context{color:#aeb8b3}:root[data-theme="dark"] .period-picker-popover{border-color:#4a5550;background:#171b19;box-shadow:0 12px 34px rgba(0,0,0,.42)}:root[data-theme="dark"] .period-picker-shift:hover:not(:disabled),:root[data-theme="dark"] .period-picker-month:hover:not(.disabled){background:#252b28}:root[data-theme="dark"] .period-picker-day.outside{color:#747d78}:root[data-theme="dark"] .period-picker-day:hover:not(.disabled),:root[data-theme="dark"] .period-picker-month:hover:not(.disabled){border-color:#638476}:root[data-theme="dark"] .period-picker-day.selected-week{border-color:#507665;border-left-color:transparent;border-right-color:transparent}:root[data-theme="dark"] .period-picker-day.selected-week.week-start{border-left-color:#507665}:root[data-theme="dark"] .period-picker-day.selected-week.week-end{border-right-color:#507665}:root[data-theme="dark"] .period-timeline{border-left-color:#535d58}:root[data-theme="dark"] .period-timeline li:before{border-color:#66716c;background:var(--paper)}:root[data-theme="dark"] .period-timeline a:hover{background:#202622}:root[data-theme="dark"] .period-timeline li.selected a{background:#1b3027}:root[data-theme="dark"] .icon-link img,:root[data-theme="dark"] .rss-box img,:root[data-theme="dark"] .diff-link img,:root[data-theme="dark"] .period-picker-trigger img,:root[data-theme="dark"] .period-picker-shift img{filter:invert(1) hue-rotate(180deg)}
.doc-action-link{font-size:14px}.diff-link-icon{display:inline-block;width:21px;height:21px;flex:0 0 21px;align-self:flex-start;background:#a94700;-webkit-mask:url("/assets/ui/compare-items.svg") center/contain no-repeat;mask:url("/assets/ui/compare-items.svg") center/contain no-repeat}:root[data-theme="dark"] .diff-link-icon{background:#ff9b4a}
:root[data-theme="dark"] .daily-email-signup{background:#171c19}:root[data-theme="dark"] .daily-email-fallback{background:#111512}
:root[data-theme="dark"] .compare-source-links a:nth-child(n+2) img{filter:invert(1)}
:root[data-theme="dark"] .github-token-drawer{background:#111512}:root[data-theme="dark"] .github-token-drawer input{border-color:#59635f;background:#0d110f;color:var(--ink)}:root[data-theme="dark"] .compare-form{background:#171b19}:root[data-theme="dark"] .compare-form input{border-color:#59635f;background:#0d110f;color:var(--ink)}:root[data-theme="dark"] .compare-revisions{background:#151a17}:root[data-theme="dark"] .diff-navigator{background:rgba(21,26,23,.96);box-shadow:0 8px 28px rgba(0,0,0,.45)}

${config.brand.extraCss}`;

const SEARCH_CSS = `
.visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.search-main{max-width:1180px;min-height:calc(100vh - 78px);margin:0 auto;padding:50px 48px 80px}.search-hero{max-width:850px;margin-bottom:31px}.search-hero h1{margin:7px 0 12px;font-family:var(--serif);font-size:46px;line-height:1.06}.search-hero .lede{margin:0}.search-form{padding:21px;border:1px solid var(--rule);border-radius:8px;background:#fbfaf6}.search-input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px}.search-input-wrap{position:relative}.search-input-wrap svg{position:absolute;top:50%;left:14px;width:20px;height:20px;color:var(--muted);transform:translateY(-50%);pointer-events:none}.search-input{width:100%;height:50px;padding:10px 43px;border:1px solid #aaa69b;border-radius:5px;background:#fff;color:#11181d;font:16px/1.3 var(--sans)}.search-input:focus{border-color:var(--green);outline:2px solid color-mix(in srgb,var(--green) 22%,transparent);outline-offset:1px}.search-clear{position:absolute;top:50%;right:8px;display:none;width:33px;height:33px;border:0;border-radius:50%;background:transparent;color:var(--muted);font:22px/1 var(--sans);cursor:pointer;transform:translateY(-50%)}.search-clear.visible{display:block}.search-clear:hover{background:var(--green-soft);color:var(--green)}.search-submit{min-width:112px;border:1px solid var(--green);border-radius:5px;background:var(--green);color:#fff;font:700 14px/1 var(--sans);cursor:pointer}.search-submit:hover{background:#083b30}.search-filters{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:13px}.search-control label{display:block;margin:0 0 4px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.search-control select{width:100%;height:38px;padding:6px 27px 6px 9px;border:1px solid var(--rule);border-radius:4px;background:var(--paper);color:var(--ink);font:13px/1.2 var(--sans)}.search-shortcut{margin:10px 0 0;color:var(--muted);font-size:11px}.search-results-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:33px 0 4px;padding-bottom:12px;border-bottom:1px solid var(--rule)}.search-results-head h2{margin:0;font-family:var(--serif);font-size:25px}.search-results-head p{margin:0;color:var(--muted);font-size:13px}.search-results{display:grid}.search-result{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:16px;padding:20px 0;border-bottom:1px solid var(--rule)}.search-result-icon{position:relative;width:48px;height:48px}.search-result-icon>img{width:43px;height:43px;object-fit:contain}.search-result-icon .topic{position:absolute;right:-2px;bottom:-1px;width:21px;height:21px;padding:2px;border-radius:50%;background:var(--paper);box-shadow:0 0 0 1px var(--rule);object-fit:contain}.search-result-main{min-width:0}.search-result-taxonomy{display:flex;align-items:center;gap:6px;min-width:0;margin-bottom:4px;color:var(--green);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.search-result-taxonomy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.search-result h3{margin:0 0 6px;font-family:var(--serif);font-size:21px;line-height:1.22}.search-result h3 a{color:var(--ink);text-decoration:none}.search-result h3 a:hover{text-decoration:underline;text-decoration-color:var(--green)}.search-result-excerpt{max-width:780px;margin:0;color:#46514e;font-size:14px;line-height:1.5}.search-result-excerpt mark{border-radius:2px;background:#d8e9df;color:inherit;padding:0 1px}.search-result-meta{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:9px;color:var(--muted);font-size:11px}.search-result-date{padding-top:3px;color:var(--muted);font-family:var(--serif);font-size:13px;white-space:nowrap}.search-source-pill{display:inline-flex;align-items:center;border:1px solid var(--rule);border-radius:999px;padding:2px 7px;font-size:10px;font-weight:700;letter-spacing:.03em}.search-state{padding:42px 0;text-align:center;color:var(--muted)}.search-state strong{display:block;margin-bottom:5px;color:var(--ink);font-family:var(--serif);font-size:23px}.search-load-more{display:block;min-width:150px;margin:25px auto 0;padding:10px 16px;border:1px solid var(--green);border-radius:4px;background:transparent;color:var(--green);font:700 13px/1 var(--sans);cursor:pointer}.search-load-more:hover{background:var(--green-soft)}.search-load-more[hidden]{display:none}.search-error{border-left:3px solid var(--red);background:var(--red-soft);padding:14px 17px;text-align:left;color:var(--red)}:root[data-theme="dark"] .search-form{background:#171b19}:root[data-theme="dark"] .search-input{border-color:#59635f;background:#0d110f;color:var(--ink)}:root[data-theme="dark"] .search-result-excerpt{color:#c3cbc7}:root[data-theme="dark"] .search-result-excerpt mark{background:#28513f;color:#eef6f1}:root[data-theme="dark"] .search-result-icon .topic{background:var(--paper)}@media(max-width:1050px){.main-nav{grid-template-columns:repeat(6,minmax(0,1fr))}.search-filters{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:760px){.main-nav{grid-template-columns:repeat(3,minmax(0,1fr))}.search-main{padding:33px 19px 55px}.search-hero h1{font-size:37px}.search-form{padding:15px}.search-input-row{grid-template-columns:1fr}.search-submit{height:42px}.search-filters{grid-template-columns:1fr 1fr}.search-result{grid-template-columns:38px minmax(0,1fr);gap:11px}.search-result-icon{width:38px;height:38px}.search-result-icon>img{width:34px;height:34px}.search-result-icon .topic{width:18px;height:18px}.search-result-date{grid-column:2;padding-top:0}.search-result h3{font-size:19px}.search-results-head{align-items:start;flex-direction:column;gap:2px}}
`;

const SEARCH_LOADING_CSS = `
.main-nav a[data-nav="day"]{--nav-icon:url("/assets/ui/calendar-date.svg")}.main-nav a[data-nav="week"]{--nav-icon:url("/assets/ui/calendar-planning.svg")}.main-nav a[data-nav="month"]{--nav-icon:url("/assets/ui/calendar-days.svg")}.main-nav a[data-nav="message-center"]{--nav-icon:url("/assets/ui/square-layout-grid-2.svg")}.main-nav a[data-nav="compare"]{--nav-icon:url("/assets/ui/compare-items.svg")}.main-nav a[data-nav="search"]{--nav-icon:url("/assets/ui/magnifier.svg")}.main-nav a{display:flex;align-items:center;justify-content:center;gap:7px}.main-nav .nav-mobile-icon{display:block;width:20px;height:20px;flex:0 0 auto;background:currentColor;-webkit-mask:var(--nav-icon) center/contain no-repeat;mask:var(--nav-icon) center/contain no-repeat}.main-nav .nav-icon .nav-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:760px){.site-header{padding-bottom:8px}.main-nav{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0 4px}.main-nav a,.main-nav .nav-icon{display:flex;align-items:center;justify-content:center;min-width:0;min-height:43px;padding:7px 0 6px;border-bottom-width:3px}.main-nav .nav-mobile-icon{width:23px;height:23px}.main-nav .nav-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}}
@media(min-width:761px) and (max-width:1050px){.main-nav{display:flex;justify-content:flex-end;gap:28px}}
.main-nav .nav-icon{display:flex;align-items:center;justify-content:center;min-width:24px;color:var(--ink)}.main-nav .nav-icon svg{width:20px;height:20px;display:block}.main-nav .nav-icon[aria-current="page"]{color:var(--green)}.search-loading{display:flex;align-items:center;gap:10px;min-height:48px;color:var(--muted);font-size:13px}.search-spinner{display:inline-block;width:17px;height:17px;border:2px solid var(--rule);border-top-color:var(--green);border-radius:50%;animation:search-spin .72s linear infinite}.search-progress{position:relative;height:3px;overflow:hidden;border-radius:999px;background:color-mix(in srgb,var(--green) 13%,transparent)}.search-progress span{position:absolute;inset-block:0;left:0;width:34%;border-radius:inherit;background:var(--green);animation:search-progress 1.05s ease-in-out infinite}.search-results{transition:opacity .16s ease}.search-main.is-searching .search-results{opacity:.42}.search-control{position:relative;min-width:0}.search-control-label{display:block;margin:0 0 4px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.search-select-trigger{display:flex;align-items:center;justify-content:space-between;width:100%;height:39px;gap:8px;padding:6px 9px;border:1px solid var(--rule);border-radius:6px;background:var(--paper);color:var(--ink);box-shadow:0 1px 2px rgba(17,24,29,.04);font:13px/1.2 var(--sans);text-align:left;cursor:pointer}.search-select-trigger:hover{border-color:#aaa69b}.search-select-trigger:focus-visible,.search-select-option:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 24%,transparent);outline-offset:1px}.search-select-chevron{flex:0 0 auto;width:14px;height:14px;opacity:.62;transition:transform .14s ease}.search-select-trigger[aria-expanded="true"] .search-select-chevron{transform:rotate(180deg)}.search-select-value,.search-select-option-label{display:flex;align-items:center;min-width:0;gap:7px}.search-select-value span,.search-select-option-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.search-select-icon{flex:0 0 auto;width:19px;height:19px;object-fit:contain}.search-select-content{position:absolute;z-index:60;top:calc(100% + 5px);left:0;width:max(100%,190px);max-height:286px;overflow-y:auto;padding:4px;border:1px solid var(--rule);border-radius:7px;background:#fff;box-shadow:0 10px 28px rgba(17,24,29,.14),0 2px 7px rgba(17,24,29,.08)}.search-select-content[hidden]{display:none}.search-select-option{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:35px;gap:8px;padding:6px 8px;border:0;border-radius:4px;background:transparent;color:var(--ink);font:13px/1.25 var(--sans);text-align:left;cursor:pointer}.search-select-option:hover,.search-select-option:focus-visible,.search-select-option[aria-selected="true"]{background:var(--green-soft)}.search-select-check{flex:0 0 auto;width:15px;height:15px;color:var(--green);opacity:0}.search-select-option[aria-selected="true"] .search-select-check{opacity:1}:root[data-theme="dark"] .search-select-trigger,:root[data-theme="dark"] .search-select-content{border-color:#4d5853;background:#171b19}:root[data-theme="dark"] .search-select-content{box-shadow:0 12px 30px rgba(0,0,0,.48)}:root[data-theme="dark"] .search-select-chevron{filter:invert(1)}@keyframes search-spin{to{transform:rotate(360deg)}}@keyframes search-progress{0%{transform:translateX(-115%)}55%{transform:translateX(155%)}100%{transform:translateX(320%)}}@media(prefers-reduced-motion:reduce){.search-spinner{animation-duration:1.8s}.search-progress span{width:55%;animation-duration:2.2s}.search-select-chevron{transition:none}}@media(max-width:760px){.main-nav .nav-icon{min-width:0}.main-nav .nav-icon svg{width:19px;height:19px}.search-select-content{width:100%;min-width:0}}
`;

const JS = `
const THEME_STORAGE_KEY='${config.brand.themeStorageKey}';
const GITHUB_TOKEN_STORAGE_KEY='${config.brand.tokenStorageKey}';
function applyTheme(theme,persist){const value=theme==='dark'?'dark':'light';document.documentElement.dataset.theme=value;document.documentElement.style.colorScheme=value;document.querySelectorAll('[data-theme-option]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeOption===value)));if(persist){try{localStorage.setItem(THEME_STORAGE_KEY,value)}catch{}}}
document.querySelectorAll('[data-theme-option]').forEach(button=>button.addEventListener('click',()=>applyTheme(button.dataset.themeOption,true)));
applyTheme(document.documentElement.dataset.theme||'light',false);
const dailyEmailDialog=document.querySelector('[data-daily-email-dialog]');
let dailyEmailReturnFocus=null;
let dailyEmailFormRequested=false;
function syncDailyEmailDialogLock(){document.body.classList.toggle('daily-email-dialog-open',Boolean(document.querySelector('.daily-email-dialog[open]')))}
function openDailyEmailDialog(dialog,trigger=null){if(!dialog||typeof dialog.showModal!=='function')return false;if(dialog.open)return true;dailyEmailReturnFocus=trigger||document.activeElement;dialog.showModal();syncDailyEmailDialogLock();setTimeout(()=>dialog.querySelector('[data-daily-email-close],button,input')?.focus(),0);return true}
function closeDailyEmailDialog(dialog){if(!dialog?.open)return;dialog.close();syncDailyEmailDialogLock();dailyEmailReturnFocus?.focus?.();dailyEmailReturnFocus=null}
function loadDailyEmailForm(){if(dailyEmailFormRequested)return;const host=dailyEmailDialog?.querySelector('[data-kit-daily-form]');if(!host)return;const source=host.dataset.kitFormSrc,uid=host.dataset.kitFormUid;if(!source||!uid)return;dailyEmailFormRequested=true;const script=document.createElement('script');script.async=true;script.dataset.uid=uid;script.src=source;script.addEventListener('load',()=>host.querySelector('[data-kit-form-loading]')?.remove());script.addEventListener('error',()=>{host.querySelector('[data-kit-form-loading]')?.remove();host.insertAdjacentHTML('beforeend','<div class="daily-email-fallback"><p>The signup form could not load. Please try again or use the <a href="/rss.xml">daily RSS feed</a>.</p></div>')});host.appendChild(script)}
document.querySelectorAll('[data-daily-email-open]').forEach(trigger=>trigger.addEventListener('click',event=>{if(!openDailyEmailDialog(dailyEmailDialog,trigger))return;event.preventDefault();loadDailyEmailForm()}));
document.querySelectorAll('[data-daily-email-close]').forEach(button=>button.addEventListener('click',()=>closeDailyEmailDialog(button.closest('dialog'))));
document.querySelectorAll('.daily-email-dialog').forEach(dialog=>{dialog.addEventListener('click',event=>{if(event.target===dialog)closeDailyEmailDialog(dialog)});dialog.addEventListener('close',syncDailyEmailDialogLock)});
function consumeDailyEmailSubscribeQuery(){const url=new URL(location.href);if(url.searchParams.get('subscribe')!=='daily')return false;url.searchParams.delete('subscribe');history.replaceState(null,'',url.pathname+(url.search?'?'+url.searchParams.toString():'')+url.hash);return true}
if(consumeDailyEmailSubscribeQuery()){openDailyEmailDialog(dailyEmailDialog);loadDailyEmailForm()}
const githubTokenDrawer=document.querySelector('[data-github-token-drawer]');
const githubTokenBackdrop=document.querySelector('[data-github-token-backdrop]');
const githubTokenInput=document.querySelector('[data-github-token-input]');
const githubTokenStatus=document.querySelector('[data-github-token-status]');
const githubTokenAlert=document.querySelector('[data-github-token-alert]');
let githubTokenReturnFocus=null;
function storedGithubToken(){try{return localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY)||''}catch{return ''}}
function syncGithubTokenDrawer(){if(!githubTokenInput)return;const value=storedGithubToken();githubTokenInput.value=value;const forget=document.querySelector('[data-github-token-forget]');if(forget)forget.hidden=!value}
function openGithubTokenDrawer(options={}){if(!githubTokenDrawer)return;githubTokenReturnFocus=document.activeElement;syncGithubTokenDrawer();if(githubTokenStatus)githubTokenStatus.textContent='';if(githubTokenAlert){githubTokenAlert.hidden=!options.rateLimited;const detail=githubTokenAlert.querySelector('p');if(detail&&options.message)detail.textContent=options.message}githubTokenDrawer.hidden=false;githubTokenBackdrop.hidden=false;document.body.classList.add('token-drawer-open');document.querySelectorAll('[data-github-token-open]').forEach(button=>button.setAttribute('aria-expanded','true'));setTimeout(()=>githubTokenInput?.focus(),0)}
function closeGithubTokenDrawer(){if(!githubTokenDrawer)return;githubTokenDrawer.hidden=true;githubTokenBackdrop.hidden=true;document.body.classList.remove('token-drawer-open');document.querySelectorAll('[data-github-token-open]').forEach(button=>button.setAttribute('aria-expanded','false'));githubTokenReturnFocus?.focus?.();githubTokenReturnFocus=null}
document.querySelectorAll('[data-github-token-open]').forEach(button=>button.addEventListener('click',()=>openGithubTokenDrawer()));
document.querySelectorAll('[data-github-token-close]').forEach(button=>button.addEventListener('click',closeGithubTokenDrawer));
githubTokenBackdrop?.addEventListener('click',closeGithubTokenDrawer);
document.querySelector('[data-github-token-save]')?.addEventListener('click',()=>{const value=githubTokenInput.value.trim();if(!value){githubTokenStatus.textContent='Paste a GitHub token before saving.';githubTokenInput.focus();return}try{localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY,value)}catch{githubTokenStatus.textContent='This browser did not allow the token to be saved.';return}githubTokenStatus.textContent='Token saved in this browser.';syncGithubTokenDrawer();document.dispatchEvent(new CustomEvent('github-token-changed',{detail:{hasToken:true}}));setTimeout(closeGithubTokenDrawer,250)});
document.querySelector('[data-github-token-forget]')?.addEventListener('click',()=>{try{localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY)}catch{}syncGithubTokenDrawer();githubTokenStatus.textContent='Saved GitHub token removed from this browser.';document.dispatchEvent(new CustomEvent('github-token-changed',{detail:{hasToken:false}}))});
document.addEventListener('github-token-required',event=>openGithubTokenDrawer({rateLimited:true,message:event.detail?.message}));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!githubTokenDrawer?.hidden){event.preventDefault();closeGithubTokenDrawer();return}if(event.key!=='Tab'||githubTokenDrawer?.hidden)return;const focusable=[...githubTokenDrawer.querySelectorAll('a[href],button:not([disabled]):not([hidden]),input:not([disabled])')];if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}});
document.querySelectorAll('[data-userjot-feedback]').forEach(button=>button.addEventListener('click',()=>window.uj?.showWidget({section:'feedback'})));
document.querySelectorAll('[data-diff-tab]').forEach(button=>button.addEventListener('click',()=>{const root=button.closest('[data-diff]');root.querySelectorAll('[data-diff-tab]').forEach(item=>item.classList.toggle('active',item===button));root.querySelectorAll('[data-diff-panel]').forEach(panel=>panel.hidden=panel.dataset.diffPanel!==button.dataset.diffTab)}));
const localDateTimeFormatter=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const localDayFormatter=new Intl.DateTimeFormat(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
function localizeDates(){document.querySelectorAll('[data-local-datetime]').forEach(item=>{const value=new Date(item.dateTime);if(!Number.isNaN(value.getTime()))item.textContent=localDateTimeFormatter.format(value)});document.querySelectorAll('[data-local-day]').forEach(item=>{const value=new Date(item.dateTime);if(!Number.isNaN(value.getTime()))item.textContent=localDayFormatter.format(value)})}
function updateRelativeTimes(){const now=Date.now();document.querySelectorAll('[data-relative-time]').forEach(item=>{const value=new Date(item.dataset.relativeTime).getTime();if(Number.isNaN(value))return;const difference=value-now;const hours=Math.abs(difference)/3600000;const amount=hours<10?Math.max(.1,Math.round(hours*10)/10):Math.round(hours);const label=amount===1?'hour':'hours';item.textContent=difference<0?amount+' '+label+' ago':'in '+amount+' '+label})}
function nextRefreshSlot(value=new Date()){const current=new Date(value);for(let offset=0;offset<=1;offset+=1){for(const hour of [2,8,14,20]){const candidate=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth(),current.getUTCDate()+offset,hour,15));if(candidate>current)return candidate}}return new Date(current.getTime()+21600000)}
async function syncRefreshStatus(){try{const response=await fetch('/refresh-status.json',{cache:'no-store'});if(!response.ok)throw new Error('refresh status unavailable');const status=await response.json();const last=document.querySelector('[data-refresh-last]');if(last&&status.lastCheckedAt){last.dateTime=status.lastCheckedAt;last.dataset.localDatetime='';last.dataset.refreshLast='';const value=new Date(status.lastCheckedAt);if(!Number.isNaN(value.getTime()))last.textContent=localDateTimeFormatter.format(value)}const lastRelative=document.querySelector('[data-refresh-last-relative]');if(lastRelative&&status.lastCheckedAt)lastRelative.dataset.relativeTime=status.lastCheckedAt;const next=document.querySelector('[data-refresh-next]');if(next){const declared=new Date(status.nextScheduledAt||0);next.dataset.relativeTime=(declared>Date.now()?declared:nextRefreshSlot()).toISOString()}updateRelativeTimes()}catch{}}
function pickerPad(value){return String(value).padStart(2,'0')}
function pickerDateKey(value){return value.getFullYear()+'-'+pickerPad(value.getMonth()+1)+'-'+pickerPad(value.getDate())}
function pickerMondayKey(value){const date=new Date(value.getFullYear(),value.getMonth(),value.getDate());date.setDate(date.getDate()-((date.getDay()+6)%7));return pickerDateKey(date)}
function pickerWeekLabel(value){const first=new Date(value+'T12:00:00');const last=new Date(first);last.setDate(last.getDate()+6);const day=new Intl.DateTimeFormat(undefined,{day:'numeric'});const dayMonth=new Intl.DateTimeFormat(undefined,{day:'numeric',month:'long'});const full=new Intl.DateTimeFormat(undefined,{day:'numeric',month:'long',year:'numeric'});if(first.getFullYear()!==last.getFullYear())return full.format(first)+'–'+full.format(last);if(first.getMonth()!==last.getMonth())return dayMonth.format(first)+'–'+full.format(last);return day.format(first)+'–'+full.format(last)}
function pickerIcon(){return '<img src="/assets/ui/chevron-right.svg" alt="">'}
function renderWeekPicker(root){const selected=root.dataset.selected;const min=root.dataset.min;const max=root.dataset.max;const counts=JSON.parse(decodeURIComponent(root.dataset.counts||'%7B%7D'));const parts=root.dataset.display.split('-').map(Number);const year=parts[0];const month=parts[1]-1;const first=new Date(year,month,1);const start=new Date(year,month,1-((first.getDay()+6)%7));const monthName=new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(first);let cells='';for(let index=0;index<42;index+=1){const date=new Date(start);date.setDate(start.getDate()+index);const key=pickerDateKey(date);const week=pickerMondayKey(date);const count=counts[key]||0;const weekday=(date.getDay()+6)%7;let classes='period-picker-day';if(date.getMonth()!==month)classes+=' outside';if(week===selected)classes+=' selected-week';if(weekday===0)classes+=' week-start';if(weekday===6)classes+=' week-end';const content='<span>'+date.getDate()+'</span>'+(count?'<span class="period-picker-update-dot" aria-hidden="true"></span>':'');if(week<min||week>max)cells+='<span class="'+classes+' disabled" aria-hidden="true">'+content+'</span>';else{const dateLabel=new Intl.DateTimeFormat(undefined,{day:'numeric',month:'long',year:'numeric'}).format(date);cells+='<a class="'+classes+'" href="/week/'+week+'/" aria-label="'+dateLabel+(count?', '+count+' update'+(count===1?'':'s'):'')+'; open week '+pickerWeekLabel(week)+'">'+content+'</a>'}}const previousDate=new Date(year,month-1,1);const nextDate=new Date(year,month+1,1);const previous=previousDate.getFullYear()+'-'+pickerPad(previousDate.getMonth()+1);const next=nextDate.getFullYear()+'-'+pickerPad(nextDate.getMonth()+1);const previousDisabled=previous<min.slice(0,7);const nextDisabled=next>max.slice(0,7);root.querySelector('[data-picker-popover]').innerHTML='<div class="period-picker-calendar" data-picker-content><div class="period-picker-panel-head"><button type="button" class="period-picker-shift previous" data-picker-shift="-1" aria-label="Previous month"'+(previousDisabled?' disabled':'')+'>'+pickerIcon()+'</button><strong>'+monthName+'</strong><button type="button" class="period-picker-shift" data-picker-shift="1" aria-label="Next month"'+(nextDisabled?' disabled':'')+'>'+pickerIcon()+'</button></div><div class="period-picker-weekdays"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="period-picker-days">'+cells+'</div></div>'}
function renderMonthPicker(root){const selected=root.dataset.selected;const min=root.dataset.min;const max=root.dataset.max;const counts=JSON.parse(decodeURIComponent(root.dataset.counts||'%7B%7D'));const year=Number(root.dataset.display);let months='';for(let index=0;index<12;index+=1){const key=year+'-'+pickerPad(index+1);const name=new Intl.DateTimeFormat(undefined,{month:'short'}).format(new Date(year,index,1));const fullName=new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(new Date(year,index,1));const count=counts[key]||0;if(key<min||key>max)months+='<span class="period-picker-month disabled" aria-hidden="true"><strong>'+name+'</strong></span>';else months+='<a class="period-picker-month'+(key===selected?' selected':'')+'" href="/month/'+key+'/" aria-label="'+fullName+', '+count+' update'+(count===1?'':'s')+'"><strong>'+name+'</strong><span>'+count+'</span></a>'}root.querySelector('[data-picker-popover]').innerHTML='<div class="period-picker-year" data-picker-content><div class="period-picker-panel-head"><button type="button" class="period-picker-shift previous" data-picker-shift="-1" aria-label="Previous year"'+(String(year-1)<min.slice(0,4)?' disabled':'')+'>'+pickerIcon()+'</button><strong>'+year+'</strong><button type="button" class="period-picker-shift" data-picker-shift="1" aria-label="Next year"'+(String(year+1)>max.slice(0,4)?' disabled':'')+'>'+pickerIcon()+'</button></div><div class="period-picker-months">'+months+'</div></div>'}
document.querySelectorAll('[data-period-picker]').forEach(root=>{const trigger=root.querySelector('[data-picker-trigger]');const popover=root.querySelector('[data-picker-popover]');trigger.addEventListener('click',()=>{const opening=popover.hidden;document.querySelectorAll('[data-picker-popover]').forEach(item=>{item.hidden=true;const other=item.closest('[data-period-picker]')?.querySelector('[data-picker-trigger]');if(other)other.setAttribute('aria-expanded','false')});popover.hidden=!opening;trigger.setAttribute('aria-expanded',String(opening));if(opening)setTimeout(()=>popover.querySelector('.selected-week,.period-picker-month.selected,a,button:not(:disabled)')?.focus(),0)});root.addEventListener('click',event=>{const shift=event.target.closest('[data-picker-shift]');if(!shift||shift.disabled)return;const amount=Number(shift.dataset.pickerShift);if(root.dataset.periodPicker==='week'){const parts=root.dataset.display.split('-').map(Number);const next=new Date(parts[0],parts[1]-1+amount,1);root.dataset.display=next.getFullYear()+'-'+pickerPad(next.getMonth()+1);renderWeekPicker(root)}else{root.dataset.display=String(Number(root.dataset.display)+amount);renderMonthPicker(root)}})});
document.addEventListener('click',event=>{document.querySelectorAll('[data-period-picker]').forEach(root=>{if(event.composedPath().includes(root))return;const popover=root.querySelector('[data-picker-popover]');popover.hidden=true;root.querySelector('[data-picker-trigger]').setAttribute('aria-expanded','false')})});
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;document.querySelectorAll('[data-period-picker]').forEach(root=>{const popover=root.querySelector('[data-picker-popover]');if(popover.hidden)return;popover.hidden=true;const trigger=root.querySelector('[data-picker-trigger]');trigger.setAttribute('aria-expanded','false');trigger.focus()})});
localizeDates();syncRefreshStatus();updateRelativeTimes();setInterval(updateRelativeTimes,60000);
`;

const SEARCH_JS = `
const searchRoot=document.querySelector('[data-search-app]');
if(searchRoot){
const form=searchRoot.querySelector('[data-search-form]'),input=searchRoot.querySelector('[data-search-input]'),clearButton=searchRoot.querySelector('[data-search-clear]'),resultsRoot=searchRoot.querySelector('[data-search-results]'),status=searchRoot.querySelector('[data-search-status]'),summary=searchRoot.querySelector('[data-search-summary]'),loadMore=searchRoot.querySelector('[data-search-more]');
const controls=[...searchRoot.querySelectorAll('[data-search-filter]')];let pagefind=null,currentResults=[],groupCursor=0,pendingItems=[],renderedCount=0,requestNumber=0;const pageSize=20,autoSearchDelay=600,defaultControlValues={product:'all',topic:'all',source:'all',recordType:'update',sort:'relevance'};
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeExcerpt=value=>escape(value||'').replace(/&lt;mark&gt;/g,'<mark>').replace(/&lt;\\\/mark&gt;/g,'</mark>');
const formatDate=value=>{if(!value)return'';const date=new Date(value+'T12:00:00');return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(date)};
const expandedQuery=value=>{const aliases=${JSON.stringify(config.taxonomy.searchAliases)};const normalized=value.trim();const alias=aliases[normalized.toLowerCase()];return alias?normalized+' '+alias:normalized};
const hasQuery=()=>Boolean(input.value.trim());
function setUrl(){const params=new URLSearchParams();if(hasQuery())params.set('q',input.value.trim());controls.forEach(control=>{if(control.value&&control.value!==defaultControlValues[control.name])params.set(control.name,control.value)});const next=location.pathname+(params.size?'?'+params:'');history.replaceState(null,'',next)}
function filters(){const values={};controls.forEach(control=>{if(control.dataset.searchFilter==='filter'&&control.value&&control.value!=='all')values[control.name]=[control.value]});return values}
function resultHtml(data){const meta=data.meta||{};const productIcon=meta.productIcon?'<img src="'+escape(meta.productIcon)+'" alt="">':'';const topicIcon=meta.topicIcon?'<img class="topic" src="'+escape(meta.topicIcon)+'" alt="">':'';const icon=productIcon||topicIcon?'<div class="search-result-icon">'+productIcon+topicIcon+'</div>':'<div class="search-result-icon" aria-hidden="true"></div>';const taxonomy=[meta.productShort||meta.product,meta.topic].filter(Boolean).join(' · ');const source=meta.recordType==='brief'?meta.sourceLabel:(meta.source==='mc'?'Message Center':'Microsoft Learn');const change=meta.recordType==='brief'?'AI summary':meta.changeType;return '<article class="search-result">'+icon+'<div class="search-result-main">'+(taxonomy?'<div class="search-result-taxonomy"><span>'+escape(taxonomy)+'</span></div>':'')+'<h3><a href="'+escape(data.url)+'">'+escape(meta.title||'Untitled update')+'</a></h3><p class="search-result-excerpt">'+safeExcerpt(data.excerpt||meta.description||'')+'</p><div class="search-result-meta"><span class="search-source-pill">'+escape(source)+'</span>'+(change?'<span>'+escape(change)+'</span>':'')+'</div></div><time class="search-result-date" datetime="'+escape(meta.date||'')+'">'+escape(formatDate(meta.date))+'</time></article>'}
function queryTerms(){return [...new Set(expandedQuery(input.value).toLowerCase().split(/[^a-z0-9._-]+/).filter(term=>term.length>1))]}
function itemScore(item,terms){if(!terms.length)return 1;const title=String(item.title||'').toLowerCase(),description=String(item.description||'').toLowerCase(),text=String(item.searchText||'').toLowerCase();return terms.reduce((score,term)=>score+(title.includes(term)?8:0)+(description.includes(term)?3:0)+(text.includes(term)?1:0),0)}
function itemExcerpt(item,terms){const source=String(item.searchText||item.description||'');if(!terms.length)return item.description||source.slice(0,240);const lower=source.toLowerCase();const positions=terms.map(term=>lower.indexOf(term)).filter(index=>index>=0);const start=positions.length?Math.max(0,Math.min(...positions)-75):0;let excerpt=(start?'…':'')+source.slice(start,start+260)+(start+260<source.length?'…':'');for(const term of terms.sort((a,b)=>b.length-a.length)){const escapedTerm=term.replace(/[.*+?^()|[\\]\\\\{}]/g,'\\$&').replaceAll('$','\\$');const pattern=new RegExp('('+escapedTerm+')','ig');excerpt=excerpt.replace(pattern,'<mark>$1</mark>')}return excerpt}
function expandResult(data){if(!data.meta?.items)return[data];let items=[];try{items=JSON.parse(data.meta.items)}catch{return[data]}const terms=queryTerms();const ranked=items.map(item=>({item,score:itemScore(item,terms)})).filter(entry=>!terms.length||entry.score>0).sort((a,b)=>b.score-a.score||a.item.title.localeCompare(b.item.title));return(ranked.length?ranked:items.map(item=>({item,score:0}))).map(({item})=>({url:item.url,meta:{...item,recordType:'update'},excerpt:itemExcerpt(item,terms)}))}
function updateResultSummary(){const more=pendingItems.length||groupCursor<currentResults.length;summary.textContent='Showing '+renderedCount+' matching update'+(renderedCount===1?'':'s')+(more?' · more available':'')}
async function showMore(){const request=requestNumber,additions=[];while(additions.length<pageSize&&(pendingItems.length||groupCursor<currentResults.length)){if(!pendingItems.length){const data=await currentResults[groupCursor++].data();if(request!==requestNumber)return;pendingItems.push(...expandResult(data))}while(pendingItems.length&&additions.length<pageSize)additions.push(pendingItems.shift())}resultsRoot.insertAdjacentHTML('beforeend',additions.map(resultHtml).join(''));renderedCount+=additions.length;loadMore.hidden=!pendingItems.length&&groupCursor>=currentResults.length;updateResultSummary()}
function setSearchLoading(active){searchRoot.classList.toggle('is-searching',active);resultsRoot.setAttribute('aria-busy',String(active));if(active)status.innerHTML='<div class="search-loading"><span class="search-spinner" aria-hidden="true"></span><span>Searching 25,877 archived updates…</span></div><div class="search-progress" aria-hidden="true"><span></span></div>';else status.textContent=''}
function resetSearch(){requestNumber+=1;currentResults=[];groupCursor=0;pendingItems=[];renderedCount=0;setSearchLoading(false);summary.textContent='';loadMore.hidden=true;clearButton.classList.toggle('visible',hasQuery());resultsRoot.innerHTML='<div class="search-state"><strong>Search the archive</strong><span>Enter a word or phrase to search the archive.</span></div>';setUrl()}
async function runSearch(){if(!hasQuery()){resetSearch();return}const request=++requestNumber,started=performance.now();setUrl();clearButton.classList.add('visible');setSearchLoading(true);summary.textContent='';loadMore.hidden=true;try{pagefind ||= await import('/pagefind/pagefind.js');await pagefind.init();const sortControl=controls.find(control=>control.name==='sort');const options={filters:filters()};if(sortControl?.value==='newest')options.sort={date:'desc'};if(sortControl?.value==='oldest')options.sort={date:'asc'};const response=await pagefind.search(expandedQuery(input.value),options);const remaining=Math.max(0,360-(performance.now()-started));if(remaining)await new Promise(resolve=>setTimeout(resolve,remaining));if(request!==requestNumber)return;currentResults=response.results||[];groupCursor=0;pendingItems=[];renderedCount=0;resultsRoot.innerHTML='';if(!currentResults.length){setSearchLoading(false);summary.textContent='0 results';resultsRoot.innerHTML='<div class="search-state"><strong>No matching changes</strong><span>Try fewer words or broaden the filters.</span></div>';return}await showMore();if(request===requestNumber)setSearchLoading(false)}catch(error){if(request!==requestNumber)return;setSearchLoading(false);status.innerHTML='<div class="search-error"><strong>Search could not load.</strong> Refresh the page and try again.</div>';console.error(error)}}
const customSelects=[...searchRoot.querySelectorAll('[data-search-select]')];
function syncCustomSelect(root){const select=root.querySelector('[data-search-filter]'),value=root.querySelector('[data-select-value]'),options=[...root.querySelectorAll('[data-select-option]')],selected=options.find(option=>option.dataset.value===select.value)||options[0];if(!selected)return;value.innerHTML=selected.querySelector('[data-select-option-label]').innerHTML;options.forEach(option=>option.setAttribute('aria-selected',String(option===selected)))}
function closeCustomSelect(root,restoreFocus=false){const trigger=root.querySelector('[data-select-trigger]'),content=root.querySelector('[data-select-content]');content.hidden=true;trigger.setAttribute('aria-expanded','false');if(restoreFocus)trigger.focus()}
function openCustomSelect(root){customSelects.forEach(other=>{if(other!==root)closeCustomSelect(other)});const trigger=root.querySelector('[data-select-trigger]'),content=root.querySelector('[data-select-content]');content.hidden=false;trigger.setAttribute('aria-expanded','true');const selected=[...root.querySelectorAll('[data-select-option]')].find(option=>option.getAttribute('aria-selected')==='true');(selected||root.querySelector('[data-select-option]'))?.focus()}
function chooseCustomOption(root,option){const select=root.querySelector('[data-search-filter]');if(select.value!==option.dataset.value){select.value=option.dataset.value;select.dispatchEvent(new Event('change',{bubbles:true}))}else syncCustomSelect(root);closeCustomSelect(root,true)}
customSelects.forEach(root=>{const select=root.querySelector('[data-search-filter]'),trigger=root.querySelector('[data-select-trigger]'),content=root.querySelector('[data-select-content]'),options=[...root.querySelectorAll('[data-select-option]')];trigger.addEventListener('click',()=>trigger.getAttribute('aria-expanded')==='true'?closeCustomSelect(root):openCustomSelect(root));trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();openCustomSelect(root)}});options.forEach(option=>option.addEventListener('click',()=>chooseCustomOption(root,option)));content.addEventListener('keydown',event=>{const current=options.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();closeCustomSelect(root,true);return}if(event.key==='Enter'||event.key===' '){event.preventDefault();document.activeElement?.click();return}let next=current;if(event.key==='ArrowDown')next=Math.min(options.length-1,current+1);else if(event.key==='ArrowUp')next=Math.max(0,current-1);else if(event.key==='Home')next=0;else if(event.key==='End')next=options.length-1;else return;event.preventDefault();options[next]?.focus()});select.addEventListener('change',()=>syncCustomSelect(root));syncCustomSelect(root)});
document.addEventListener('click',event=>customSelects.forEach(root=>{if(!root.contains(event.target))closeCustomSelect(root)}));
document.addEventListener('keydown',event=>{if(event.key==='Escape')customSelects.forEach(root=>{if(root.querySelector('[data-select-trigger]').getAttribute('aria-expanded')==='true')closeCustomSelect(root,true)})});
let timer;const queue=()=>{clearTimeout(timer);if(!hasQuery()){resetSearch();return}requestNumber+=1;setSearchLoading(false);timer=setTimeout(runSearch,autoSearchDelay)};form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);runSearch()});input.addEventListener('input',queue);clearButton.addEventListener('click',()=>{clearTimeout(timer);input.value='';input.focus();resetSearch()});controls.forEach(control=>control.addEventListener('change',()=>{clearTimeout(timer);hasQuery()?runSearch():resetSearch()}));loadMore.addEventListener('click',showMore);document.addEventListener('keydown',event=>{if((event.key==='/'&&!/input|textarea|select/i.test(document.activeElement?.tagName))||((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k')){event.preventDefault();input.focus()}});const params=new URLSearchParams(location.search);input.value=params.get('q')||'';controls.forEach(control=>{const value=params.get(control.name);if(value&&[...control.options].some(option=>option.value===value))control.value=value});customSelects.forEach(syncCustomSelect);hasQuery()?runSearch():resetSearch();
}
`;

class StaticSiteGenerator {
  constructor(options = {}) {
    this.websiteDir = path.resolve(options.websiteDir || 'website');
    this.mcDataPath = path.resolve(options.mcDataPath || process.env.MC_DATA_PATH || path.join(process.cwd(), '../mc/@data'));
    this.siteAssetDir = path.resolve(options.siteAssetDir || path.join(process.cwd(), 'assets/site'));
    this.docsRepoPath = path.resolve(options.docsRepoPath || process.env.DOCS_REPO_PATH || process.env.LOCAL_REPO_PATH || path.join(process.cwd(), config.build.docsCloneDir));
    this.detailDays = Number(options.detailDays || process.env.STATIC_SITE_DETAIL_DAYS || config.build.detailDays);
    const userJotProjectId = String(options.userJotProjectId ?? process.env.USERJOT_PROJECT_ID ?? '').trim();
    this.userJotProjectId = /^[a-z0-9_-]{6,100}$/i.test(userJotProjectId) ? userJotProjectId : '';
    const kitFormUid = String(options.kitDailyFormUid || process.env.KIT_DAILY_FORM_UID || '').trim();
    const kitFormEmbedSrc = String(options.kitDailyFormEmbedSrc || process.env.KIT_DAILY_FORM_EMBED_SRC || '').trim();
    let kitFormUrl;
    try { kitFormUrl = new URL(kitFormEmbedSrc); } catch {}
    const trustedKitHost = kitFormUrl?.protocol === 'https:' && (
      kitFormUrl.hostname === 'kit.com' || kitFormUrl.hostname.endsWith('.kit.com') ||
      kitFormUrl.hostname === 'convertkit.com' || kitFormUrl.hostname.endsWith('.convertkit.com')
    );
    this.kitDailyFormUid = /^[a-z0-9_-]+$/i.test(kitFormUid) ? kitFormUid : '';
    this.kitDailyFormEmbedSrc = trustedKitHost ? kitFormUrl.toString() : '';
    const generatedAt = moment.utc(options.generatedAt);
    this.generatedAt = (generatedAt.isValid() ? generatedAt : moment.utc()).toISOString();
    this.generatedUrls = new Set(['/']);
    this.periodSummaries = { days: {}, weeks: {}, months: {} };
    // Bounds of the tracked archive, computed in build(). Outside them a date has
    // no page, so links to it must not be rendered as links.
    this.archiveStart = '';
    this.archiveEnd = '';
  }

  dailyEmailForm() {
    if (this.kitDailyFormUid && this.kitDailyFormEmbedSrc) {
      return `<div class="daily-email-form" data-kit-daily-form data-kit-form-uid="${escapeHtml(this.kitDailyFormUid)}" data-kit-form-src="${escapeHtml(this.kitDailyFormEmbedSrc)}"><p class="daily-email-form-loading" data-kit-form-loading>Loading the secure signup form…</p></div>`;
    }
    return `<div class="daily-email-fallback"><p>Email signup will appear here once the Kit form is configured. Until then, use the <a href="/rss.xml">daily RSS feed</a>.</p></div>`;
  }

  emailSubscribeBox() {
    return `<div class="rss-box"><img src="/assets/ui/envelope-open.svg" alt=""><a class="daily-email-trigger" href="/about/?subscribe=daily" data-daily-email-open aria-haspopup="dialog" aria-controls="daily-email-dialog">Get daily email updates</a></div>`;
  }

  dailyEmailDialogs() {
    return `<dialog class="daily-email-dialog" id="daily-email-dialog" data-daily-email-dialog aria-labelledby="daily-email-dialog-title" aria-describedby="daily-email-dialog-intro"><div class="daily-email-dialog-card"><button class="daily-email-dialog-close" type="button" data-daily-email-close aria-label="Close email signup">×</button><div class="eyebrow">${config.copy.dailyEmail.eyebrow}</div><h2 id="daily-email-dialog-title">Get daily email updates</h2><p class="daily-email-dialog-intro" id="daily-email-dialog-intro">${config.copy.dailyEmail.intro}</p>${this.dailyEmailForm()}</div></dialog>`;
  }

  async write(relativePath, content) {
    const target = path.join(this.websiteDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content.replace(/[\t ]+(?=\r?\n)/g, ''));
    this.generatedUrls.add(`/${relativePath.replace(/index\.html$/, '').replace(/^\/+/, '')}`);
  }

  async loadReports() {
    const files = (await fs.readdir(this.websiteDir)).filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort();
    const reports = [];
    for (const file of files) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(this.websiteDir, file), 'utf8'));
        reports.push({ date: file.slice(0, 10), data });
      } catch (error) {
        console.warn(`Skipping malformed report ${file}: ${error.message}`);
      }
    }
    return reports;
  }

  async enrichCommitParents(reports) {
    const latestReportDate = reports.at(-1)?.date || moment().format('YYYY-MM-DD');
    const detailCutoff = moment(latestReportDate).subtract(this.detailDays, 'days').format('YYYY-MM-DD');
    const changes = reports.filter(report => report.date >= detailCutoff).flatMap(report => [
      ...(report.data.newFiles || []),
      ...(report.data.modifiedFiles || []),
      ...(report.data.deletedFiles || [])
    ]);
    const unresolved = [...new Set(changes
      .filter(change => !change.baseCommitSha && /^[0-9a-f]{40}$/i.test(change.commitSha || ''))
      .map(change => change.commitSha))];
    if (!unresolved.length) return reports;
    try {
      await fs.access(path.join(this.docsRepoPath, '.git'));
      const git = simpleGit(this.docsRepoPath);
      const parents = new Map();
      for (let index = 0; index < unresolved.length; index += 200) {
        const output = await git.raw(['rev-list', '--parents', '--no-walk', ...unresolved.slice(index, index + 200)]);
        for (const line of output.trim().split('\n').filter(Boolean)) {
          const [head, base] = line.trim().split(/\s+/);
          if (head && base) parents.set(head, base);
        }
      }
      for (const change of changes) {
        if (!change.baseCommitSha && parents.has(change.commitSha)) change.baseCommitSha = parents.get(change.commitSha);
      }
    } catch (error) {
      console.warn(`Historical commit parents could not be resolved from ${this.docsRepoPath}: ${error.message}`);
    }
    return reports;
  }

  async loadPeriodSummaries() {
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.websiteDir, 'period-summaries.json'), 'utf8'));
      return { days: data.days || {}, weeks: data.weeks || {}, months: data.months || {} };
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`Skipping period summaries: ${error.message}`);
      return { days: {}, weeks: {}, months: {} };
    }
  }

  normalizeDocItems(reports) {
    const items = [];
    for (const report of reports) {
      const changes = [
        ...(report.data.newFiles || []).map(item => ({ ...item, changeType: 'New' })),
        ...(report.data.modifiedFiles || []).map(item => ({ ...item, changeType: 'Updated' })),
        ...(report.data.deletedFiles || []).map(item => ({ ...item, changeType: 'Removed' }))
      ];
      changes.forEach((change, index) => {
        const meta = extractMarkdownMetadata(change.patch, change.filename);
        const product = classifyProduct(change.filename, meta.title, meta.description);
        const topic = classifyTopic(change.filename, meta.title, meta.description);
        const slug = `${slugify(meta.title)}-${String(index + 1).padStart(2, '0')}`;
        items.push({
          id: `doc-${report.date}-${slug}`,
          source: 'docs',
          sourceLabel: 'Microsoft Learn',
          date: report.date,
          title: meta.title,
          summary: change.englishSummary?.summary || meta.description,
          adminImpact: change.englishSummary?.adminImpact || 'Review the documentation change to determine whether it affects tenant configuration, security posture, or rollout plans.',
          summaryGeneratedBy: change.englishSummary?.generatedBy || 'source-metadata',
          product,
          topic,
          changeType: change.changeType,
          changeNature: changeNature(change.englishSummary),
          actionRequired: change.englishSummary?.actionRequired === true,
          url: `/changes/${report.date}/${slug}/`,
          publicUrl: change.publicDocsUrl || null,
          filename: change.filename,
          patch: change.patch || '',
          additions: change.additions || 0,
          deletions: change.deletions || 0,
          baseCommitSha: change.baseCommitSha || '',
          commitSha: change.commitSha || '',
          commitAuthor: change.commitAuthor || '',
          commitMessage: change.commitMessage || '',
          dailyOverview: report.data.englishSummary?.overview || ''
        });
      });
    }
    return items;
  }

  async loadMessageCenterItems() {
    const byId = new Map();
    const ingest = message => {
      if (!message || !message.Id || !isProductMessage(message)) return;
      const existing = byId.get(message.Id);
      if (!existing || new Date(message.LastModifiedDateTime || message.StartDateTime || 0) >= new Date(existing.LastModifiedDateTime || existing.StartDateTime || 0)) byId.set(message.Id, message);
    };
    try {
      const active = JSON.parse(await fs.readFile(path.join(this.mcDataPath, 'messages.json'), 'utf8'));
      (Array.isArray(active) ? active : active.Messages || []).forEach(ingest);
    } catch (error) {
      console.warn(`Message Center active data unavailable: ${error.message}`);
    }
    try {
      const archiveDir = path.join(this.mcDataPath, 'archive');
      for (const file of (await fs.readdir(archiveDir)).filter(name => name.endsWith('.json'))) {
        try { ingest(JSON.parse(await fs.readFile(path.join(archiveDir, file), 'utf8'))); } catch {}
      }
    } catch (error) {
      console.warn(`Message Center archive unavailable: ${error.message}`);
    }
    return [...byId.values()].map(message => {
      const body = message.Body?.Content || '';
      const summaryDetail = (message.Details || []).find(detail => /^summary$/i.test(detail.Name || ''))?.Value;
      const bodyRoot = parse(String(body));
      const bodySummary = stripHtml(bodyRoot.querySelector('p')?.toString() || body);
      const summary = stripHtml(summaryDetail) || firstTwoSentences(bodySummary)
        || `A Microsoft 365 Message Center announcement relevant to ${SITE.audience}.`;
      const dateValue = message.LastModifiedDateTime || message.StartDateTime;
      const product = classifyProduct((message.Services || []).join(' '), message.Title, body);
      const topic = classifyTopic('', message.Title, body);
      return {
        id: message.Id,
        source: 'mc',
        sourceLabel: 'Message Center',
        date: moment(dateValue).format('YYYY-MM-DD'),
        title: message.Title,
        summary,
        product,
        topic,
        changeType: message.IsMajorChange ? 'Major update' : 'Message',
        url: `/message-center/${message.Id}/`,
        originalUrl: `https://mc.merill.net/message/${message.Id}`,
        body: sanitizeMcHtml(body),
        category: message.Category || '',
        services: message.Services || [],
        tags: message.Tags || [],
        startDate: message.StartDateTime,
        endDate: message.EndDateTime,
        lastModifiedDateTime: message.LastModifiedDateTime || message.StartDateTime
      };
    });
  }

  head(title, description, canonical, active = '') {
    const safeTitle = title === SITE.name ? title : `${title} — ${SITE.name}`;
    const safeDescription = escapeHtml(truncate(description || SITE.description, 300));
    const userJot = this.userJotProjectId
      ? `<script>window.$ujq=window.$ujq||[];window.uj=window.uj||new Proxy({},{get:(_,property)=>(...args)=>window.$ujq.push([property,...args])});document.head.appendChild(Object.assign(document.createElement('script'),{src:'https://cdn.userjot.com/sdk/v2/uj.js',type:'module',async:true}));</script><script>window.uj.init('${this.userJotProjectId}',{widget:true,theme:'auto',position:'right'});</script>`
      : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title><meta name="description" content="${safeDescription}"><link rel="canonical" href="${SITE.url}${canonical}"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><script>try{const saved=localStorage.getItem('${config.brand.themeStorageKey}');document.documentElement.dataset.theme=saved==='light'||saved==='dark'?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{document.documentElement.dataset.theme='light'}</script><script defer data-site="${config.analytics.piqoSite}" data-domain="${SITE.host}" src="https://piqo.app/piqo.js"></script>${userJot}<link rel="stylesheet" href="/assets/site.css"><link rel="alternate" type="application/rss+xml" title="${SITE.name}" href="/rss.xml"><meta property="og:site_name" content="${SITE.name}"><meta property="og:title" content="${escapeHtml(safeTitle)}"><meta property="og:description" content="${safeDescription}"><meta property="og:url" content="${SITE.url}${canonical}"><meta property="og:type" content="article"><meta property="og:image" content="${SITE.url}/og-image.png"><meta property="og:image:secure_url" content="${SITE.url}/og-image.png"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${config.brand.ogAlt}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(safeTitle)}"><meta name="twitter:description" content="${safeDescription}"><meta name="twitter:image" content="${SITE.url}/og-image.png"><meta name="twitter:image:alt" content="${config.brand.ogAlt}"></head><body>${this.header(active)}${active==='compare'?this.githubTokenDrawer():''}`;
  }

  header(active = '') {
    const nav = [{key:'day',label:'Day',url:'/'},{key:'week',label:'Week',url:'/week/'},{key:'month',label:'Month',url:'/month/'},{key:'message-center',label:'Message Center',url:'/message-center/'},{key:'compare',label:'Diff',url:'https://mx.merill.net/',external:true},{key:'search',label:'Search',url:'/search/'}];
    const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>';
    const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    const settings = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    const githubSettings = active==='compare'?`<button class="token-drawer-trigger" type="button" data-github-token-open aria-haspopup="dialog" aria-controls="github-token-drawer" aria-expanded="false" title="GitHub API settings" aria-label="Configure GitHub API settings">${settings}</button>`:'';
    const themePicker = `<div class="theme-picker" role="group" aria-label="Color theme"><button class="theme-option" type="button" data-theme-option="light" aria-pressed="false" title="Use light theme">${sun}<span>Light</span></button><button class="theme-option" type="button" data-theme-option="dark" aria-pressed="false" title="Use dark theme">${moon}<span>Dark</span></button></div>`;
    return `<header class="site-header"><a class="brand" href="/"><img class="brand-logo" src="/assets/ui/${config.brand.logo}" alt=""><span>${config.brand.wordmark}</span></a><nav class="main-nav" aria-label="Primary">${nav.map(item=>{const accessibleLabel=item.key==='compare'?'View full page diff':item.label;return `<a href="${item.url}" data-nav="${item.key}"${item.external?' target="_blank" rel="noopener noreferrer"':''}${item.key==='compare'||item.key==='search'?' class="nav-icon"':''}${active===item.key?' aria-current="page"':''} aria-label="${accessibleLabel}" title="${accessibleLabel}"><span class="nav-mobile-icon" aria-hidden="true"></span><span class="nav-label">${item.label}</span></a>`}).join('')}</nav><div class="utility"><a class="site-link" href="/about/"${active==='about'?' aria-current="page"':''}>About</a><a class="site-link" href="https://merill.net" target="_blank" rel="noopener noreferrer">merill.net</a><a class="icon-link" href="/rss.xml" title="Subscribe to the daily RSS feed" aria-label="${config.copy.rssFeedLabel}"><img src="/assets/ui/rss.svg" alt=""></a>${config.links.related.map(link=>`<a class="icon-link" href="${link.url}" target="_blank" rel="noopener noreferrer" title="${link.title}" aria-label="${link.label}"><img src="/assets/ui/${link.icon}" alt=""></a>`).join('')}${githubSettings}${themePicker}</div></header>`;
  }

  githubTokenDrawer() {
    return `<div class="token-drawer-backdrop" data-github-token-backdrop hidden></div><aside class="github-token-drawer" id="github-token-drawer" data-github-token-drawer role="dialog" aria-modal="true" aria-labelledby="github-token-title" hidden><header class="token-drawer-head"><div><div class="eyebrow">Documentation diff</div><h2 id="github-token-title">GitHub API access</h2></div><button class="token-drawer-close" type="button" data-github-token-close aria-label="Close GitHub API settings">×</button></header><p class="token-drawer-intro">The diff viewer reads public documentation revisions from GitHub. Without a token, GitHub allows only 60 API requests per hour for each public IP address. One comparison normally uses three requests.</p><div class="token-limit-alert" data-github-token-alert hidden><strong>GitHub’s hourly limit was reached</strong><p>The shared unauthenticated allowance has been used. Add a token below to continue with your personal GitHub API allowance.</p></div><label for="github-api-token">Fine-grained GitHub token</label><input id="github-api-token" data-github-token-input type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"><div class="token-drawer-actions"><button class="token-save" type="button" data-github-token-save>Save token</button><button class="token-forget" type="button" data-github-token-forget>Remove token</button></div><p class="token-drawer-status" data-github-token-status role="status" aria-live="polite"></p><p class="token-rate-status" data-github-rate-status aria-live="polite"></p><section class="token-drawer-help"><h3>How to create one</h3><ol><li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub’s fine-grained token form ↗</a>.</li><li>Choose a short expiration and your own account as the resource owner.</li><li>No additional repository permissions are required for these public documentation repositories.</li><li>Generate the token, then paste and save it here.</li></ol><p class="token-drawer-warning">The token is saved only in this browser and sent only to api.github.com. Treat it like a password and use the shortest practical expiration.</p></section></aside>`;
  }

  footer() {
    const feedbackButton = this.userJotProjectId
      ? '<button class="footer-feedback-button" type="button" data-userjot-feedback>Report an issue or share feedback</button>'
      : '';
    const footer = `<footer class="footer" id="site-footer"><div class="footer-inner"><section class="footer-feature"><div class="eyebrow">Featured project</div><div class="footer-feature-lockup"><img class="footer-feature-logo" src="/assets/ui/maester.png" alt=""><h2><a href="https://maester.cloud">Maester Cloud</a></h2></div><p>${config.copy.footer.featureBlurb}</p><a class="footer-cta" href="https://maester.cloud">Explore Maester Cloud →</a></section><section class="footer-projects"><h2 class="footer-section-title">More community projects</h2><ul class="footer-project-list"><li><a href="https://maester.dev">Maester</a></li><li><a href="https://graphpermissions.merill.net">Graph Permissions Explorer</a></li><li><a href="https://cmd.ms">cmd.ms</a></li><li><a href="https://mc.merill.net">M365 Message Center Archive</a></li><li><a href="https://getyako.com">Yako</a></li></ul></section><section class="footer-support"><h2 class="footer-section-title">Support free community tools</h2><p>Found these free tools useful? Shout me a cup of coffee—or more—on GitHub Sponsors. It helps keep the projects open, useful, and moving.</p><div class="footer-support-links"><a href="https://github.com/sponsors/merill">Sponsor Merill on GitHub →</a></div></section></div><div class="footer-bottom"><div><div>${config.copy.footer.tagline}</div><div class="refresh-status"><span>Last refreshed <time data-refresh-last>checking…</time> <span class="refresh-relative" data-refresh-last-relative>recently</span></span><span>Next refresh <span class="refresh-relative" data-refresh-next>within six hours</span></span></div></div><nav aria-label="Footer">${feedbackButton}<a class="footer-rss-link" href="/rss.xml"><img src="/assets/ui/rss.svg" alt="">Daily RSS</a><a href="/about/">About</a><a href="https://merill.net">merill.net</a>${config.links.footer.map(link=>`<a href="${link.url}">${link.label}</a>`).join('')}</nav></div></footer>${this.dailyEmailDialogs()}<script src="/assets/site.js"></script></body></html>`;
    return footer.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
  }

  productRail() {
    return `<aside class="left-rail"><h2 class="rail-heading">Products</h2><ul class="product-list">${PRODUCTS.slice(0,10).map(product=>`<li><a href="/products/${product.slug}/"><img src="/assets/products/${product.icon}" alt="">${escapeHtml(product.short)}</a></li>`).join('')}</ul><hr class="rail-rule"><div class="topic-rail"><h2 class="rail-heading">Topics</h2><ul class="plain-list">${TOPICS.slice(0,8).map(topic=>`<li><a href="/topics/${topic.slug}/">${escapeHtml(topic.name)}</a></li>`).join('')}</ul></div></aside>`;
  }

  periodRail(items, type = 'week') {
    this.periodRailCache ||= {};
    if (this.periodRailCache[type]) return this.periodRailCache[type];
    const periods = [...new Set(items.map(item => type === 'month' ? item.date.slice(0,7) : mondayOf(item.date)))].sort().reverse().slice(0,6);
    this.periodRailCache[type] = `<aside class="right-rail"><h2 class="rail-heading">Recent ${type === 'month' ? 'months' : 'weeks'}</h2><div class="archive-links">${periods.map(period=>`<a href="/${type}/${period}/">${type==='month'?moment(`${period}-01`).format('MMMM YYYY'):`Week of ${moment(period).format('D MMMM YYYY')}`}</a>`).join('')}</div><hr class="rail-rule">${this.emailSubscribeBox()}</aside>`;
    return this.periodRailCache[type];
  }

  messageCenterMeta(item) {
    if (item.source !== 'mc') return '';
    const details = [item.changeType, humanizeLabel(item.category)].filter(value => value && value !== 'Message');
    return `<div class="story-source"><span class="mc-label">Message Center</span><a href="${item.originalUrl}">${escapeHtml(item.id)} on mc.merill.net ↗</a>${details.map(value=>`<span>${escapeHtml(value)}</span>`).join('')}</div>`;
  }

  changePill(item) {
    const pills = [];
    if (item.changeNature) {
      pills.push(`<span class="change-pill nature ${CHANGE_NATURE_LABELS.get(item.changeNature)}">${escapeHtml(item.changeNature)}</span>`);
    } else {
      const label = item.source === 'mc' ? 'New' : (item.changeType || 'Updated');
      const style = ['New','Updated','Removed'].includes(label) ? label.toLowerCase() : 'updated';
      pills.push(`<span class="change-pill ${style}">${escapeHtml(label)}</span>`);
    }
    if (item.actionRequired) pills.push('<span class="change-pill action-required">Action required</span>');
    return pills.length > 1 ? `<span class="change-pills">${pills.join('')}</span>` : pills[0];
  }

  groupedItems(items, options = {}) {
    const showDate = Boolean(options.showDate);
    const productGroups = PRODUCTS.map(product => ({ product, items: items.filter(item => item.product.slug === product.slug) })).filter(group => group.items.length);
    return `<section class="product-groups">${productGroups.map(({product,items:productItems})=>{
      const topicGroups = TOPICS.map(topic => ({ topic, items: productItems.filter(item => item.topic.slug === topic.slug) })).filter(group => group.items.length).sort((a,b)=>b.items.length-a.items.length||a.topic.name.localeCompare(b.topic.name));
      return `<section class="product-update-group" id="product-${product.slug}"><header class="product-group-header"><img src="/assets/products/${product.icon}" alt=""><div><h2><a href="/products/${product.slug}/">${escapeHtml(product.name)}</a></h2><span class="product-group-count">${productItems.length} update${productItems.length===1?'':'s'}</span></div></header>${topicGroups.map(({topic,items:topicItems})=>`<section class="topic-update-group"><header class="topic-group-header"><div class="topic-group-title"><img src="${topic.icon}" alt=""><h3><a href="/topics/${topic.slug}/">${escapeHtml(topic.name)}</a></h3></div><span class="topic-group-count">${topicItems.length}</span></header>${[...topicItems].sort((a,b)=>b.date.localeCompare(a.date)||impactScore(b)-impactScore(a)||a.title.localeCompare(b.title)).map(item=>{const support=[showDate?`<span>${moment(item.date).format('D MMMM YYYY')}</span>`:'',this.messageCenterMeta(item)].filter(Boolean).join('');return `<article class="grouped-story" id="${escapeHtml(item.id)}"><div class="grouped-story-head"><h4><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h4>${this.changePill(item)}</div><p class="story-description">${escapeHtml(item.summary)}</p>${support?`<div class="story-support">${support}</div>`:''}</article>`}).join('')}</section>`).join('')}</section>`;
    }).join('')}</section>`;
  }

  miniMonthCalendar(items, selectedDate) {
    const first = moment(`${selectedDate.slice(0,7)}-01`);
    const start = first.clone().startOf('isoWeek');
    const end = first.clone().endOf('month').endOf('isoWeek');
    const counts = new Map();
    items.forEach(item => counts.set(item.date, (counts.get(item.date) || 0) + 1));
    const dates = [...new Set(items.map(item => item.date).filter(Boolean))].sort();
    const previousMonth = first.clone().subtract(1, 'month');
    const nextMonth = first.clone().add(1, 'month');
    const previousDate = dates.filter(date => date.startsWith(previousMonth.format('YYYY-MM'))).at(-1);
    const nextDate = dates.find(date => date.startsWith(nextMonth.format('YYYY-MM')));
    const monthIcon = direction => `<span aria-hidden="true">${direction === 'Previous' ? '&lsaquo;' : '&rsaquo;'}</span>`;
    const monthControl = (direction, month, destination) => destination
      ? `<a class="mini-month-nav" href="/day/${destination}/" aria-label="${direction} month, ${month.format('MMMM YYYY')}" title="${month.format('MMMM YYYY')}">${monthIcon(direction)}</a>`
      : `<span class="mini-month-nav disabled" aria-hidden="true">${monthIcon(direction)}</span>`;
    const cells = Array.from({ length: end.diff(start, 'days') + 1 }, (_, index) => start.clone().add(index, 'days')).map(day => {
      const date = day.format('YYYY-MM-DD');
      const count = counts.get(date) || 0;
      const outside = date.slice(0,7) !== selectedDate.slice(0,7);
      const dot = count ? '<span class="mini-update-dot" aria-hidden="true"></span>' : '';
      if (outside && !count) return `<span class="mini-day outside" aria-label="${day.format('D MMMM YYYY')}, outside current month"><span class="mini-day-number">${day.date()}</span></span>`;
      if (outside) return `<a class="mini-day outside has-updates" href="/day/${date}/" aria-label="${day.format('D MMMM YYYY')}, ${count} change${count === 1 ? '' : 's'}, outside current month" title="${count} change${count === 1 ? '' : 's'}"><span class="mini-day-number">${day.date()}</span>${dot}</a>`;
      const inArchive = (!this.archiveStart || date >= this.archiveStart) && (!this.archiveEnd || date <= this.archiveEnd);
      const countLabel = count ? `${count} change${count === 1 ? '' : 's'}` : 'no changes';
      if (!inArchive) return `<span class="mini-day${date === selectedDate ? ' selected' : ''}" aria-label="${day.format('D MMMM YYYY')}, outside archive"><span class="mini-day-number">${day.date()}</span></span>`;
      return `<a class="mini-day${date === selectedDate ? ' selected' : ''}${count ? ' has-updates' : ''}" href="/day/${date}/" aria-label="${day.format('D MMMM YYYY')}, ${countLabel}" title="${countLabel}"><span class="mini-day-number">${day.date()}</span>${dot}</a>`;
    }).join('');
    return `<section class="mini-calendar" aria-label="${first.format('MMMM YYYY')} change calendar"><div class="mini-calendar-header">${monthControl('Previous', previousMonth, previousDate)}<h2 class="rail-heading mini-calendar-title">${first.format('MMMM YYYY')}</h2>${monthControl('Next', nextMonth, nextDate)}</div><div class="mini-calendar-grid"><span class="mini-weekday">M</span><span class="mini-weekday">T</span><span class="mini-weekday">W</span><span class="mini-weekday">T</span><span class="mini-weekday">F</span><span class="mini-weekday">S</span><span class="mini-weekday">S</span>${cells}</div><a class="mini-month-link" href="/month/${selectedDate.slice(0,7)}/">Open month view</a></section>`;
  }

  dayRail(items, dayItems, date) {
    const productCounts = PRODUCTS.map(product=>({product,count:dayItems.filter(item=>item.product.slug===product.slug).length})).filter(entry=>entry.count).sort((a,b)=>b.count-a.count||a.product.short.localeCompare(b.product.short));
    return `<aside class="right-rail month-stats-rail period-product-rail day-rail">${this.miniMonthCalendar(items,date)}<hr class="rail-rule"><h2 class="rail-heading">Day by product</h2>${productCounts.length?`<ul class="rail-count-list">${productCounts.map(({product,count})=>`<li><a href="#product-${product.slug}"><img src="/assets/products/${product.icon}" alt="">${escapeHtml(product.short)}</a><span class="rail-count">${count}</span></li>`).join('')}</ul>`:'<p class="quiet">No product updates.</p>'}<hr class="rail-rule">${this.emailSubscribeBox()}</aside>`;
  }

  weekPickerCalendar(items, selectedWeek, displayMonth = selectedWeek.slice(0, 7)) {
    const first = moment(`${displayMonth}-01`);
    const start = first.clone().startOf('isoWeek');
    const minWeek = mondayOf(items.at(-1)?.date || selectedWeek);
    const maxWeek = mondayOf(items[0]?.date || selectedWeek);
    const dayCounts = new Map();
    items.forEach(item => dayCounts.set(item.date, (dayCounts.get(item.date) || 0) + 1));
    const cells = Array.from({ length: 42 }, (_, index) => start.clone().add(index, 'days')).map(day => {
      const date = day.format('YYYY-MM-DD');
      const week = mondayOf(date);
      const count = dayCounts.get(date) || 0;
      const classes = ['period-picker-day'];
      if (day.month() !== first.month()) classes.push('outside');
      if (week === selectedWeek) classes.push('selected-week');
      if (day.isoWeekday() === 1) classes.push('week-start');
      if (day.isoWeekday() === 7) classes.push('week-end');
      const content = `<span>${day.date()}</span>${count ? '<span class="period-picker-update-dot" aria-hidden="true"></span>' : ''}`;
      if (week < minWeek || week > maxWeek) return `<span class="${classes.join(' ')} disabled" aria-hidden="true">${content}</span>`;
      const countLabel = count ? `, ${count} update${count === 1 ? '' : 's'}` : '';
      return `<a class="${classes.join(' ')}" href="/week/${week}/" aria-label="${day.format('D MMMM YYYY')}${countLabel}; open week ${escapeHtml(formatWeekRange(week))}">${content}</a>`;
    }).join('');
    const previousDisabled = first.clone().subtract(1,'month').format('YYYY-MM') < minWeek.slice(0,7) ? ' disabled' : '';
    const nextDisabled = first.clone().add(1,'month').format('YYYY-MM') > maxWeek.slice(0,7) ? ' disabled' : '';
    return `<div class="period-picker-calendar" data-picker-content><div class="period-picker-panel-head"><button type="button" class="period-picker-shift previous" data-picker-shift="-1" aria-label="Previous month"${previousDisabled}><img src="/assets/ui/chevron-right.svg" alt=""></button><strong>${first.format('MMMM YYYY')}</strong><button type="button" class="period-picker-shift" data-picker-shift="1" aria-label="Next month"${nextDisabled}><img src="/assets/ui/chevron-right.svg" alt=""></button></div><div class="period-picker-weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<span>${day}</span>`).join('')}</div><div class="period-picker-days">${cells}</div></div>`;
  }

  monthPickerGrid(items, selectedMonth, displayYear = selectedMonth.slice(0, 4)) {
    const year = Number(displayYear);
    const minMonth = (items.at(-1)?.date || `${selectedMonth}-01`).slice(0, 7);
    const maxMonth = (items[0]?.date || `${selectedMonth}-01`).slice(0, 7);
    const counts = new Map();
    items.forEach(item => { const month = item.date.slice(0,7); counts.set(month, (counts.get(month) || 0) + 1); });
    const months = Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
      const name = moment(`${key}-01`).format('MMM');
      const count = counts.get(key) || 0;
      if (key < minMonth || key > maxMonth) return `<span class="period-picker-month disabled" aria-hidden="true"><strong>${name}</strong></span>`;
      return `<a class="period-picker-month${key === selectedMonth ? ' selected' : ''}" href="/month/${key}/" aria-label="${moment(`${key}-01`).format('MMMM YYYY')}, ${count} update${count === 1 ? '' : 's'}"><strong>${name}</strong>${count ? `<span>${count}</span>` : '<span>0</span>'}</a>`;
    }).join('');
    const previousDisabled = String(year - 1) < minMonth.slice(0,4) ? ' disabled' : '';
    const nextDisabled = String(year + 1) > maxMonth.slice(0,4) ? ' disabled' : '';
    return `<div class="period-picker-year" data-picker-content><div class="period-picker-panel-head"><button type="button" class="period-picker-shift previous" data-picker-shift="-1" aria-label="Previous year"${previousDisabled}><img src="/assets/ui/chevron-right.svg" alt=""></button><strong>${year}</strong><button type="button" class="period-picker-shift" data-picker-shift="1" aria-label="Next year"${nextDisabled}><img src="/assets/ui/chevron-right.svg" alt=""></button></div><div class="period-picker-months">${months}</div></div>`;
  }

  periodPicker(items, type, selected) {
    const isWeek = type === 'week';
    const min = isWeek ? mondayOf(items.at(-1)?.date || selected) : (items.at(-1)?.date || `${selected}-01`).slice(0,7);
    const max = isWeek ? mondayOf(items[0]?.date || selected) : (items[0]?.date || `${selected}-01`).slice(0,7);
    const counts = {};
    if (isWeek) items.forEach(item => { counts[item.date] = (counts[item.date] || 0) + 1; });
    else items.forEach(item => { const month = item.date.slice(0,7); counts[month] = (counts[month] || 0) + 1; });
    const encodedCounts = encodeURIComponent(JSON.stringify(counts));
    const display = isWeek ? selected.slice(0,7) : selected.slice(0,4);
    const label = isWeek ? formatWeekRange(selected) : moment(`${selected}-01`).format('MMMM YYYY');
    const panel = isWeek ? this.weekPickerCalendar(items, selected, display) : this.monthPickerGrid(items, selected, display);
    const popoverId = `${type}-picker-${selected}`;
    return `<div class="period-picker" data-period-picker="${type}" data-selected="${selected}" data-min="${min}" data-max="${max}" data-display="${display}" data-counts="${encodedCounts}"><button type="button" class="period-picker-trigger" data-picker-trigger aria-expanded="false" aria-haspopup="dialog" aria-controls="${popoverId}"><span>${escapeHtml(label)}</span><img class="period-picker-calendar-icon" src="/assets/ui/calendar-days.svg" alt=""><img class="period-picker-caret" src="/assets/ui/chevron-down.svg" alt=""></button><div class="period-picker-popover" id="${popoverId}" data-picker-popover role="dialog" aria-label="Choose ${type}" hidden>${panel}</div></div>`;
  }

  periodStepLinks(items, type, selected) {
    const isWeek = type === 'week';
    const min = isWeek ? mondayOf(items.at(-1)?.date || selected) : (items.at(-1)?.date || `${selected}-01`).slice(0, 7);
    const max = isWeek ? mondayOf(items[0]?.date || selected) : (items[0]?.date || `${selected}-01`).slice(0, 7);
    const cursor = isWeek ? moment(selected) : moment(`${selected}-01`);
    const unit = isWeek ? 'week' : 'month';
    const format = isWeek ? 'YYYY-MM-DD' : 'YYYY-MM';
    const previous = cursor.clone().subtract(1, unit).format(format);
    const next = cursor.clone().add(1, unit).format(format);
    return {
      previous: previous >= min ? `<a class="period-nav-previous" href="/${type}/${previous}/">← Previous ${type}</a>` : '<span class="period-nav-previous"></span>',
      next: next <= max ? `<a class="period-nav-next" href="/${type}/${next}/">Next ${type} →</a>` : '<span class="period-nav-next"></span>'
    };
  }

  periodTimeline(items, selected, type) {
    const isWeek = type === 'week';
    const min = isWeek ? mondayOf(items.at(-1)?.date || selected) : (items.at(-1)?.date || `${selected}-01`).slice(0,7);
    const periods = [];
    let cursor = isWeek ? moment(selected) : moment(`${selected}-01`);
    for (let index = 0; index < 6; index += 1) {
      const key = cursor.format(isWeek ? 'YYYY-MM-DD' : 'YYYY-MM');
      if (key < min) break;
      const count = isWeek
        ? items.filter(item => mondayOf(item.date) === key).length
        : items.filter(item => item.date.startsWith(key)).length;
      periods.push({ key, count, label: isWeek ? formatWeekRange(key) : cursor.format('MMMM YYYY') });
      cursor.subtract(1, isWeek ? 'week' : 'month');
    }
    return `<ol class="period-timeline">${periods.map(period=>`<li${period.key===selected?' class="selected"':''}><a href="/${type}/${period.key}/"${period.key===selected?' aria-current="page"':''}><span class="period-timeline-label">${escapeHtml(period.label)}</span><span class="rail-count" aria-label="${period.count} update${period.count===1?'':'s'}">${period.count}</span></a></li>`).join('')}</ol>`;
  }

  periodProductRail(items, periodItems, weekStart) {
    const productCounts = PRODUCTS.map(product=>({product,count:periodItems.filter(item=>item.product.slug===product.slug).length})).filter(entry=>entry.count).sort((a,b)=>b.count-a.count||a.product.short.localeCompare(b.product.short));
    return `<aside class="right-rail month-stats-rail period-product-rail"><h2 class="rail-heading">Browse weeks</h2>${this.periodTimeline(items,weekStart,'week')}<hr class="rail-rule"><h2 class="rail-heading">By product</h2>${productCounts.length?`<ul class="rail-count-list">${productCounts.map(({product,count})=>`<li><a href="#product-${product.slug}"><img src="/assets/products/${product.icon}" alt="">${escapeHtml(product.short)}</a><span class="rail-count">${count}</span></li>`).join('')}</ul>`:'<p class="quiet">No product updates.</p>'}<hr class="rail-rule">${this.emailSubscribeBox()}</aside>`;
  }

  monthStatsRail(items, first, productCounts) {
    const selectedMonth = first.format('YYYY-MM');
    return `<aside class="right-rail month-stats-rail period-product-rail"><h2 class="rail-heading">Browse months</h2>${this.periodTimeline(items,selectedMonth,'month')}<hr class="rail-rule"><h2 class="rail-heading">By product</h2>${productCounts.length?`<ul class="rail-count-list">${productCounts.map(({product,count})=>`<li><a href="#product-${product.slug}"><img src="/assets/products/${product.icon}" alt="">${escapeHtml(product.short)}</a><span class="rail-count">${count}</span></li>`).join('')}</ul>`:'<p class="quiet">No product updates.</p>'}<hr class="rail-rule">${this.emailSubscribeBox()}</aside>`;
  }

  itemRows(items) {
    const byDate = new Map();
    items.forEach(item => { if (!byDate.has(item.date)) byDate.set(item.date, []); byDate.get(item.date).push(item); });
    return [...byDate.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([date, dayItems])=>`<section class="date-group"><h3 class="date-label">${moment(date).format('D MMMM YYYY')}</h3>${dayItems.sort((a,b)=>impactScore(b)-impactScore(a)||a.title.localeCompare(b.title)).map(item=>`<article class="story-row"><h3><a href="${item.url}">${escapeHtml(item.title)}</a></h3>${this.messageCenterMeta(item)}<div class="taxonomy">${escapeHtml(item.product.name)} &nbsp;›&nbsp; ${escapeHtml(item.topic.name)}</div></article>`).join('')}</section>`).join('');
  }

  periodChangeTarget(change, periodItems = [], allItems = periodItems) {
    const direct = change.sourceId && allItems.find(item => item.id === change.sourceId);
    if (direct) return direct;
    const rank = candidates => candidates.map(item => ({ item, ...periodChangeScore(change, item) }))
      .filter(result => result.titleMatches > 0 || result.signalMatches > 0)
      .sort((a, b) => b.score - a.score || impactScore(b.item) - impactScore(a.item) || b.item.date.localeCompare(a.item.date));
    const periodMatch = rank(periodItems)[0];
    if (periodMatch?.score >= 8) return periodMatch.item;
    const dates = periodItems.map(item => item.date).filter(Boolean).sort();
    const lower = dates.length ? moment(dates[0]).subtract(7, 'days').format('YYYY-MM-DD') : '';
    const upper = dates.length ? moment(dates.at(-1)).add(7, 'days').format('YYYY-MM-DD') : '';
    const periodIds = new Set(periodItems.map(item => item.id));
    const candidates = allItems.filter(item => !periodIds.has(item.id) && (!lower || (item.date >= lower && item.date <= upper)));
    const ranked = rank(candidates);
    return ranked[0]?.score >= 8 ? ranked[0].item : null;
  }

  renderPeriodBrief(summary, label, periodItems = [], allItems = periodItems, options = {}) {
    if (!summary) return '';
    const showAdminImpact = options.showAdminImpact !== false;
    const changes = (summary.keyChanges || []).map(change => {
      const target = this.periodChangeTarget(change, periodItems, allItems);
      const onPage = target && periodItems.some(item => item.id === target.id);
      const href = target ? (onPage ? `#${target.id}` : target.url) : '';
      const title = target ? `<a href="${escapeHtml(href)}">${escapeHtml(change.title)}</a>` : escapeHtml(change.title);
      const product = (target?.product && PRODUCTS.find(candidate => candidate.slug === target.product.slug)) || PRODUCTS.find(candidate => {
        const value = String(change.product || '').toLowerCase();
        return value.includes(candidate.name.toLowerCase()) || value.includes(candidate.short.toLowerCase());
      });
      const topic = (target?.topic && TOPICS.find(candidate => candidate.slug === target.topic.slug || candidate.name === target.topic.name)) || TOPICS.find(candidate => String(change.detail || '').toLowerCase().includes(candidate.name.toLowerCase()));
      const productLabel = product?.short || change.product || '';
      const taxonomy = productLabel || topic ? `<div class="period-change-taxonomy">${product?`<img src="/assets/products/${product.icon}" alt="">`:''}${topic?`<img class="topic-icon" src="${topic.icon}" alt="">`:''}<span title="${escapeHtml([productLabel, topic?.name].filter(Boolean).join(' · '))}">${escapeHtml([productLabel, topic?.name].filter(Boolean).join(' · '))}</span></div>` : '';
      return `<li><div class="period-change-heading">${taxonomy}<strong>${title}</strong></div><p>${escapeHtml(change.detail)}</p></li>`;
    }).join('');
    const adminImpact = showAdminImpact && summary.adminImpact ? `<div class="period-admin-focus"><strong>${config.copy.detail.adminImpactLabel}</strong><p>${escapeHtml(summary.adminImpact)}</p></div>` : '';
    const disclosure = summary.generatedBy === 'deterministic-backfill'
      ? 'This period briefing was assembled from the tracked Microsoft Learn and Message Center changes.'
      : 'This period briefing was generated by AI from the tracked Microsoft Learn and Message Center changes.';
    return `<section class="feature period-brief"><div class="eyebrow">${escapeHtml(label)}</div><h2>${escapeHtml(summary.headline)}</h2><p class="period-overview">${escapeHtml(summary.overview)}</p>${changes?`<ul class="period-key-changes">${changes}</ul>`:''}${adminImpact}<p class="period-ai-note">${escapeHtml(disclosure)}</p></section>`;
  }

  renderWeek(items, weekStart) {
    const weekEnd = moment(weekStart).add(6,'days').format('YYYY-MM-DD');
    const weekItems = items.filter(item => item.date >= weekStart && item.date <= weekEnd).sort((a,b)=>b.date.localeCompare(a.date));
    const feature = [...weekItems].sort((a,b)=>impactScore(b)-impactScore(a)||b.date.localeCompare(a.date))[0];
    const periodBrief = this.renderPeriodBrief(this.periodSummaries.weeks?.[weekStart], 'Week in brief', weekItems, items);
    const fallbackFeature = feature?`<article class="feature"><div class="eyebrow">${moment(feature.date).format('D MMMM YYYY')}</div><div class="grouped-story-head"><h2>${escapeHtml(feature.title)}</h2>${this.changePill(feature)}</div>${this.messageCenterMeta(feature)}<div class="taxonomy">${escapeHtml(feature.product.name)} &nbsp;›&nbsp; ${escapeHtml(feature.topic.name)}</div><p>${escapeHtml(feature.summary)}</p><a href="${feature.url}">Read full update →</a></article>`:'';
    const periodLinks = this.periodStepLinks(items, 'week', weekStart);
    return `${this.head(`Week of ${moment(weekStart).format('D MMMM YYYY')}`, `${SITE.productName} changes for the week of ${moment(weekStart).format('D MMMM YYYY')}.`, `/week/${weekStart}/`, 'week')}<div class="page-shell">${this.productRail()}<main class="content"><div class="period-nav period-picker-nav">${periodLinks.previous}${this.periodPicker(items,'week',weekStart)}${periodLinks.next}</div>${periodBrief || fallbackFeature}<section class="story-list"><h2 class="section-title">Updates this week</h2>${weekItems.length?this.groupedItems(weekItems,{showDate:true}):'<div class="empty"><h2>No tracked updates</h2><p>There are no documentation or Message Center changes recorded for this week.</p></div>'}</section></main>${this.periodProductRail(items,weekItems,weekStart)}</div>${this.footer()}`;
  }

  renderDay(items, date, { landing = false } = {}) {
    const resolvedDate = date;
    const dayItems = items.filter(item => item.date === resolvedDate);
    const storedOverview = dayItems.find(item => item.dailyOverview)?.dailyOverview || '';
    const messageCenterItems = dayItems.filter(item => item.source === 'mc').sort((a,b)=>impactScore(b)-impactScore(a));
    const fallbackOverview = dayItems.length ? `${dayItems.length} changes were tracked across ${new Set(dayItems.map(item => item.product.slug)).size} ${SITE.productName} products. The leading updates include ${[...dayItems].sort((a,b)=>impactScore(b)-impactScore(a)).slice(0,3).map(item => item.title).join('; ')}.` : '';
    const messageCenterOverview = storedOverview && messageCenterItems.length ? `${messageCenterItems.length} Message Center announcement${messageCenterItems.length===1?' was':'s were'} also published, including ${messageCenterItems.slice(0,2).map(item=>item.title).join('; ')}.` : '';
    const dailyOverview = [storedOverview || fallbackOverview, messageCenterOverview].filter(Boolean).join(' ');
    const availableDates = this.archiveStart && this.archiveEnd
      ? Array.from({ length: moment(this.archiveEnd).diff(moment(this.archiveStart), 'days') + 1 }, (_, index) => moment(this.archiveStart).add(index, 'day').format('YYYY-MM-DD'))
      : [...new Set(items.map(item=>item.date))].sort();
    const currentIndex = availableDates.indexOf(resolvedDate);
    const previousDate = currentIndex > 0 ? availableDates[currentIndex - 1] : '';
    const nextDate = currentIndex >= 0 && currentIndex < availableDates.length - 1 ? availableDates[currentIndex + 1] : '';
    const previousLink = previousDate ? `<a href="/day/${previousDate}/">← Previous day</a>` : '<span></span>';
    const nextLink = nextDate ? `<a href="/day/${nextDate}/">Next day →</a>` : '<span></span>';
    const localDateTime = dateAtRefresh(resolvedDate);
    const archiveLink = this.archiveStart ? ` Browse the archive from <a href="/day/${this.archiveStart}/">${moment(this.archiveStart).format('D MMMM YYYY')} →</a>` : '';
    const landingIntro = landing ? `<section class="landing-intro"><h2>${config.copy.landing.heading}</h2><p>${config.copy.landing.blurb}${archiveLink} <a href="/about/">About this project →</a></p></section>` : '';
    const periodBrief = this.renderPeriodBrief(this.periodSummaries.days?.[resolvedDate], 'Day in brief', dayItems, items, { showAdminImpact: false });
    const fallbackBrief = dailyOverview ? `<article class="feature"><div class="eyebrow">${SITE.productName} daily update</div><h2>What changed on this day</h2><p>${escapeHtml(dailyOverview)}</p></article>` : '';
    return `${this.head(moment(resolvedDate).format('D MMMM YYYY'), `${SITE.productName} changes published on ${moment(resolvedDate).format('D MMMM YYYY')}.`, `/day/${resolvedDate}/`, 'day')}<div class="page-shell">${this.productRail()}<main class="content"><div class="period-nav">${previousLink}<h1><time datetime="${localDateTime}" data-local-day>${moment(resolvedDate).format('dddd, D MMMM YYYY')}</time></h1>${nextLink}</div>${landingIntro}${periodBrief || fallbackBrief}<section class="story-list"><h2 class="section-title">${dayItems.length} update${dayItems.length===1?'':'s'}</h2>${dayItems.length?this.groupedItems(dayItems):'<div class="empty"><h2>No tracked updates</h2><p>Try the previous day or browse the weekly archive.</p></div>'}</section></main>${this.dayRail(items,dayItems,resolvedDate)}</div>${this.footer()}`;
  }

  renderMonth(items, month) {
    const first = moment(`${month}-01`), start = first.clone().startOf('month').startOf('week').add(1,'day');
    if (start.date() > 1) start.subtract(7,'days');
    const cells=[]; for(let i=0;i<42;i++) cells.push(start.clone().add(i,'days'));
    const monthItems=items.filter(item=>item.date.startsWith(month));
    const earliestDate=this.archiveStart||items[items.length-1]?.date||first.format('YYYY-MM-DD'), latestDate=this.archiveEnd||items[0]?.date||first.format('YYYY-MM-DD');
    const calendar = cells.map(day=>{const date=day.format('YYYY-MM-DD');const found=items.filter(item=>item.date===date);const products=[...new Map(found.map(item=>[item.product.slug,item.product])).values()].slice(0,3);const tag=date>=earliestDate&&date<=latestDate?'a':'div';const href=tag==='a'?` href="/day/${date}/"`:'';const count=found.length?`<span class="calendar-count" aria-label="${found.length} update${found.length===1?'':'s'}" title="${found.length} update${found.length===1?'':'s'}">${found.length}</span>`:'';return `<${tag} class="calendar-day${date===monthItems[0]?.date?' selected':''}"${href}><span class="calendar-date-row"><strong>${day.date()}</strong>${count}</span><span class="day-icons">${products.map(p=>`<img src="/assets/products/${p.icon}" alt="${escapeHtml(p.short)}">`).join('')}</span></${tag}>`}).join('');
    const productCounts=PRODUCTS.map(product=>({product,count:monthItems.filter(item=>item.product.slug===product.slug).length})).filter(x=>x.count).sort((a,b)=>b.count-a.count);
    const topicCounts=TOPICS.map(topic=>({topic,count:monthItems.filter(item=>item.topic.slug===topic.slug).length})).filter(x=>x.count).sort((a,b)=>b.count-a.count);
    const joinNames=values=>values.length<2?(values[0]||''):values.length===2?`${values[0]} and ${values[1]}`:`${values.slice(0,-1).join(', ')}, and ${values.at(-1)}`;
    const documentationCount=monthItems.filter(item=>item.source==='docs').length, messageCenterCount=monthItems.filter(item=>item.source==='mc').length;
    const sourceSummary=[documentationCount?`${documentationCount} documentation update${documentationCount===1?'':'s'}`:'',messageCenterCount?`${messageCenterCount} Message Center announcement${messageCenterCount===1?'':'s'}`:''].filter(Boolean);
    const themeNames=topicCounts.slice(0,3).map(({topic})=>topic.name), productNames=productCounts.slice(0,2).map(({product})=>product.short);
    const monthNarrative=monthItems.length?`${joinNames(sourceSummary)} were tracked during ${first.format('MMMM')}. Activity centred on ${joinNames(themeNames)}, with the most changes affecting ${joinNames(productNames)}.`:`No tracked ${SITE.productName} changes were recorded during ${first.format('MMMM')}.`;
    const monthOverview=this.renderPeriodBrief(this.periodSummaries.months?.[month], 'Month in brief', monthItems, items) || `<section class="month-overview compact"><div><div class="eyebrow">Month in brief</div><h2>What changed in ${first.format('MMMM')}</h2><p>${escapeHtml(monthNarrative)}</p></div></section>`;
    const periodLinks = this.periodStepLinks(items, 'month', month);
    return `${this.head(first.format('MMMM YYYY'), `${SITE.productName} changes during ${first.format('MMMM YYYY')}.`, `/month/${month}/`, 'month')}<div class="page-shell">${this.productRail()}<main class="content"><div class="period-nav period-picker-nav">${periodLinks.previous}${this.periodPicker(items,'month',month)}${periodLinks.next}</div><div class="calendar">${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=>`<div class="calendar-head"><span class="weekday-long">${day}</span><span class="weekday-short">${day.slice(0,3)}</span></div>`).join('')}${calendar}</div>${monthOverview}<section class="story-list"><h2 class="section-title">${monthItems.length} updates by product</h2>${monthItems.length?this.groupedItems(monthItems,{showDate:true}):'<div class="empty"><h2>No tracked updates</h2><p>There are no documentation or Message Center changes recorded for this month.</p></div>'}</section></main>${this.monthStatsRail(items,first,productCounts)}</div>${this.footer()}`;
  }

  renderCollection(items, collection, kind) {
    const isProduct=kind==='product'; const filtered=items.filter(item=>(isProduct?item.product.slug:item.topic.slug)===collection.slug).sort((a,b)=>b.date.localeCompare(a.date));
    const title=collection.name; const icon=isProduct?`<img src="/assets/products/${collection.icon}" alt="">`:`<img src="${collection.icon}" alt="">`;
    return `${this.head(title, `Recent ${SITE.productName} updates for ${title}.`, `/${isProduct?'products':'topics'}/${collection.slug}/`, isProduct?'products':'topics')}<div class="detail-layout"><main class="detail-main"><section class="hero-product">${icon}<div><div class="eyebrow">${isProduct?'Product':'Cross-product topic'}</div><h1>${escapeHtml(title)}</h1><p>${isProduct?`Track documentation and Message Center changes for ${escapeHtml(title)}.`:`A cross-product view of ${SITE.productName} changes related to ${escapeHtml(title)}.`}</p>${isProduct?`<a href="${collection.learn}">Microsoft Learn documentation ↗</a>`:''}</div></section><section class="article-list"><h2 class="section-title" style="margin-top:28px">Latest ${escapeHtml(title)} changes</h2>${filtered.slice(0,120).map(item=>`<article><time class="eyebrow">${moment(item.date).format('D MMMM YYYY')}</time><div><h2><a href="${item.url}">${escapeHtml(item.title)}</a></h2>${this.messageCenterMeta(item)}<div class="taxonomy">${escapeHtml(item.topic.name)}</div><p>${escapeHtml(item.summary)}</p></div></article>`).join('')||'<div class="empty">No changes currently classified here.</div>'}</section></main><aside class="detail-aside"><h2 class="rail-heading">Browse ${isProduct?'products':'topics'}</h2><ul class="plain-list">${(isProduct?PRODUCTS:TOPICS).map(item=>`<li><a href="/${isProduct?'products':'topics'}/${item.slug}/">${escapeHtml(item.name)}</a></li>`).join('')}</ul></aside></div>${this.footer()}`;
  }

  renderDirectory(items, kind) {
    const isProduct=kind==='product', collections=isProduct?PRODUCTS:TOPICS;
    return `${this.head(isProduct?'Products':'Topics',`Browse ${SITE.productName} updates by ${isProduct?'product':'topic'}.`,`/${isProduct?'products':'topics'}/`,isProduct?'products':'topics')}<div class="page-shell">${this.productRail()}<main class="content"><div class="eyebrow">Browse the archive</div><h1 class="page-title">${isProduct?`${SITE.productName} products`:'Topics across products'}</h1><p class="lede">${isProduct?config.copy.directory.productsLede:config.copy.directory.topicsLede}</p><section class="article-list">${collections.map(collection=>{const count=items.filter(item=>(isProduct?item.product.slug:item.topic.slug)===collection.slug).length;const source=isProduct?`/assets/products/${collection.icon}`:collection.icon;return `<article><div><img class="topic-directory-icon" src="${source}" alt=""></div><div><h2><a href="/${isProduct?'products':'topics'}/${collection.slug}/">${escapeHtml(collection.name)}</a></h2><p>${count} tracked update${count===1?'':'s'}</p></div></article>`}).join('')}</section></main>${this.periodRail(items,'month')}</div>${this.footer()}`;
  }

  renderAbout() {
    const about = config.copy.about;
    const paragraphs = values => values.map(value => `<p>${value}</p>`).join('');
    const extraSections = about.extraSections.map(section => `
        <section class="about-section" id="${section.id}"><h2>${section.heading}</h2>${section.html}</section>`).join('');
    const stayCurrent = config.links.stayCurrent.map(link => `<li><a href="${link.url}">${link.label}</a></li>`).join('');
    const followProject = config.links.followProject.map(link => `<li><a href="${link.url}">${link.label}</a></li>`).join('');
    return `${this.head('About',`Why ${SITE.name} was built for the ${SITE.productName} community.`,'/about/','about')}
      <div class="about-layout"><main class="about-main">
        <section class="about-hero"><div class="about-kicker"><img src="${config.brand.aboutIcon}" alt=""><div class="eyebrow">About ${SITE.name}</div></div><h1>${about.heading}</h1><p class="lede">${about.lede}</p></section>
        <div class="about-pair"><section class="about-section"><h2>Why it exists</h2>${paragraphs(about.whyItExists)}</section><section class="about-section"><h2>How it works</h2>${paragraphs(about.howItWorks)}</section></div>
        <section class="about-section daily-email-signup" id="daily-email"><div class="eyebrow">${about.emailEyebrow}</div><h2>Get the daily update by email</h2><p>${about.emailBody}</p><a class="daily-email-trigger" href="/about/?subscribe=daily" data-daily-email-open aria-haspopup="dialog" aria-controls="daily-email-dialog">Subscribe to daily updates</a></section>${extraSections}
        <section class="about-section"><h2>Made for the community</h2>${paragraphs(about.community)}</section>
        <blockquote class="community-note"><p>${about.quote}</p></blockquote>
      </main><aside class="about-aside"><h2 class="rail-heading">Built by Merill</h2><p>${about.bio}</p><hr class="rail-rule"><h2 class="rail-heading">Stay current</h2><ul class="plain-list stay-current"><li><a href="/about/?subscribe=daily" data-daily-email-open aria-haspopup="dialog" aria-controls="daily-email-dialog">Get daily email updates</a></li>${stayCurrent}</ul><hr class="rail-rule"><h2 class="rail-heading">Explore</h2><ul class="plain-list"><li><a href="/">Latest day</a></li><li><a href="/week/">Current week</a></li><li><a href="/month/">Month archive</a></li><li><a href="/products/">Browse products</a></li><li><a href="/topics/">Browse topics</a></li><li><a href="/message-center/">Message Center</a></li></ul><hr class="rail-rule"><h2 class="rail-heading">Follow the project</h2><ul class="plain-list">${followProject}</ul></aside></div>${this.footer()}`;
  }

  renderSearch() {
    const renderSelect = ({ id, name, label, defaultValue, options, filterType = 'filter' }) => {
      const selected = options.find(option => option.value === defaultValue) || options[0];
      const optionLabel = option => `${option.icon ? `<img class="search-select-icon" src="${escapeHtml(option.icon)}" alt="">` : ''}<span>${escapeHtml(option.label)}</span>`;
      const nativeOptions = options.map(option => `<option value="${escapeHtml(option.value)}"${option === selected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
      const menuOptions = options.map(option => `<button class="search-select-option" type="button" role="option" aria-selected="${option === selected}" data-select-option data-value="${escapeHtml(option.value)}"><span class="search-select-option-label" data-select-option-label>${optionLabel(option)}</span><svg class="search-select-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m4 10 4 4 8-8"></path></svg></button>`).join('');
      return `<div class="search-control search-select" data-search-select><span class="search-control-label" id="${id}-label">${escapeHtml(label)}</span><select class="visually-hidden search-native-select" id="${id}" name="${escapeHtml(name)}" data-search-filter="${filterType}" aria-hidden="true" tabindex="-1">${nativeOptions}</select><button class="search-select-trigger" type="button" data-select-trigger aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-listbox" aria-labelledby="${id}-label ${id}-value"><span class="search-select-value" id="${id}-value" data-select-value>${optionLabel(selected)}</span><img class="search-select-chevron" src="/assets/ui/chevron-down.svg" alt=""></button><div class="search-select-content" id="${id}-listbox" data-select-content role="listbox" aria-labelledby="${id}-label" hidden>${menuOptions}</div></div>`;
    };
    const productOptions = [{ value: 'all', label: 'All products' }, ...PRODUCTS.map(product => ({ value: product.slug, label: product.short, icon: `/assets/products/${product.icon}` }))];
    const topicOptions = [{ value: 'all', label: 'All topics' }, ...TOPICS.map(topic => ({ value: topic.slug, label: topic.name, icon: topic.icon }))];
    const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';
    return `${this.head('Search',`Search ${SITE.productName} documentation and Message Center changes.`,'/search/','search')}<main class="search-main" data-search-app><section class="search-hero"><div class="eyebrow">${SITE.productName} change archive</div><h1>Find the change you remember.</h1><p class="lede">Search the plain-English summaries and changed Microsoft Learn content, then narrow the archive by product, topic, source, or update type.</p></section><form class="search-form" data-search-form role="search"><div class="search-input-row"><div class="search-input-wrap">${icon}<label class="visually-hidden" for="archive-search">${config.copy.search.inputLabel}</label><input class="search-input" id="archive-search" data-search-input type="search" autocomplete="off" spellcheck="false" placeholder="${config.copy.search.placeholder}"><button class="search-clear" data-search-clear type="button" aria-label="Clear search">×</button></div><button class="search-submit" type="submit">Search</button></div><div class="search-filters">${renderSelect({ id: 'search-product', name: 'product', label: 'Product', defaultValue: 'all', options: productOptions })}${renderSelect({ id: 'search-topic', name: 'topic', label: 'Topic', defaultValue: 'all', options: topicOptions })}${renderSelect({ id: 'search-source', name: 'source', label: 'Source', defaultValue: 'all', options: [{ value: 'all', label: 'All sources' }, { value: 'docs', label: 'Microsoft Learn' }, { value: 'mc', label: 'Message Center' }, { value: 'editorial', label: 'Editorial briefs' }] })}${renderSelect({ id: 'search-type', name: 'recordType', label: 'Content', defaultValue: 'update', options: [{ value: 'update', label: 'Individual updates' }, { value: 'brief', label: 'Daily, weekly and monthly briefs' }, { value: 'all', label: 'Everything' }] })}${renderSelect({ id: 'search-sort', name: 'sort', label: 'Order', defaultValue: 'relevance', filterType: 'sort', options: [{ value: 'relevance', label: 'Most relevant' }, { value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }] })}</div><p class="search-shortcut">Tip: press <kbd>/</kbd> or <kbd>⌘ K</kbd> to search from this page.</p></form><section aria-labelledby="search-results-title"><div class="search-results-head"><h2 id="search-results-title">Archive results</h2><p data-search-summary></p></div><div data-search-status role="status" aria-live="polite"></div><div class="search-results" data-search-results></div><button class="search-load-more" type="button" data-search-more hidden>Show more results</button></section></main><script type="module" src="/assets/search.js"></script>${this.footer()}`;
  }

  renderLearnCompare() {
    const scripts = '<script src="/assets/diff-config.js"></script><script src="/assets/vendor/marked.js"></script><script src="/assets/vendor/diff.min.js"></script><script src="/assets/vendor/htmldiff.js"></script><script src="/assets/learn-diff.js"></script>';
    const footer = this.footer().replace('</body>', `${scripts}</body>`);
    return `${this.head(config.copy.compare.pageTitle,'Paste a Microsoft Learn URL to find its GitHub source and compare the latest two Markdown revisions in your browser.','/compare/','compare')}
      <main class="compare-main">
        <section class="compare-hero"><div><div class="eyebrow">Client-side documentation explorer</div><h1>See what changed on a Microsoft Learn page.</h1><p class="lede">${config.copy.compare.lede}</p></div><form class="compare-form" data-learn-diff-form><label for="learn-url">Microsoft Learn URL</label><div class="compare-input-row"><input id="learn-url" name="learn-url" type="url" inputmode="url" autocomplete="url" required placeholder="${config.copy.compare.placeholderUrl}"><button type="submit">Compare latest change</button></div><div class="compare-status" data-compare-status role="status" aria-live="polite" hidden></div></form></section>
        <div class="compare-empty" data-compare-empty><strong>Paste a Learn article to begin.</strong></div>
        <article class="compare-results" data-compare-results hidden><header class="compare-result-head"><div><div class="eyebrow">Latest documentation change</div><h2 data-result-title></h2><code class="compare-path" data-result-path></code></div><div class="compare-source-links"><a data-result-learn target="_blank" rel="noopener noreferrer"><img src="/assets/ui/microsoft.svg" alt=""><span>Microsoft Learn</span></a><a data-result-github target="_blank" rel="noopener noreferrer"><img src="/assets/ui/github.svg" alt=""><span>GitHub</span></a><a data-result-history target="_blank" rel="noopener noreferrer"><img src="/assets/ui/chart-history.svg" alt=""><span>History</span></a></div></header><div class="compare-revisions" data-result-revisions></div><section class="doc-change" data-diff><div class="compare-diff-heading"><div><div class="eyebrow">Browser-generated comparison</div><h2 class="section-title">What changed</h2></div><p data-result-stats></p></div><div class="diff-tabs"><button class="active" type="button" data-diff-tab="formatted">Visual diff</button><button type="button" data-diff-tab="markdown">Markdown diff</button></div><div class="diff-panel" data-diff-panel="formatted" data-live-visual-diff></div><div class="diff-panel" data-diff-panel="markdown" data-live-markdown-diff hidden></div></section><nav class="diff-navigator" data-diff-navigator aria-label="Navigate documentation changes" hidden><span class="diff-navigator-label" data-diff-position aria-live="polite">Changes</span><button type="button" data-diff-previous title="Previous change" aria-label="Previous change">↑</button><button type="button" data-diff-next title="Next change" aria-label="Next change">↓</button></nav></article>
        <aside class="compare-callout"><p><strong>How the URL mapping works:</strong> ${config.copy.compare.mapping}</p><p>Public requests work without sign-in. GitHub applies an IP-based API limit, so the optional token is useful for heavier use.</p></aside>
      </main>${footer}`;
  }

  relatedHtml(item, allItems) {
    const candidates = [...new Map([
      ...(this.relatedByProduct?.get(item.product.slug) || []).slice(0,300),
      ...(this.relatedByTopic?.get(item.topic.slug) || []).slice(0,300)
    ].map(candidate => [candidate.id, candidate])).values()];
    return selectRelatedItems(item, candidates).map(related=>`<div class="related-item"><div class="related-meta">${moment(related.date).format('D MMMM YYYY')}${related.source==='mc'?` · <a href="${related.originalUrl}">${escapeHtml(related.id)} ↗</a>`:''}</div><a href="${related.url}">${escapeHtml(related.title)}</a></div>`).join('') || '<p class="quiet">No closely related tracked changes.</p>';
  }

  microsoftXDiffUrl(item) {
    if (!item.publicUrl) return '';
    let source;
    try { source = new URL(item.publicUrl); } catch { return ''; }
    if (source.protocol !== 'https:' || source.hostname.toLowerCase() !== 'learn.microsoft.com') return '';
    const target = new URL(source.pathname, 'https://mx.merill.net');
    target.search = source.search;
    target.hash = source.hash;
    if (/^[0-9a-f]{7,40}$/i.test(item.baseCommitSha || '') && /^[0-9a-f]{7,40}$/i.test(item.commitSha || '')) {
      target.searchParams.set('_mx_base', item.baseCommitSha);
      target.searchParams.set('_mx_head', item.commitSha);
    } else if (/^[0-9a-f]{7,40}$/i.test(item.commitSha || '')) {
      target.searchParams.set('_mx_head', item.commitSha);
    }
    return target.href;
  }

  historicalDocUrl(item) {
    return this.microsoftXDiffUrl(item) || `/day/${item.date}/#${item.id}`;
  }

  renderDocDetail(item, allItems) {
    const fullPageUrl = this.microsoftXDiffUrl(item);
    const sourceActions = item.publicUrl ? `<div class="doc-source-actions">${fullPageUrl?`<a class="learn-link diff-link doc-action-link" href="${escapeHtml(fullPageUrl)}" target="_blank" rel="noopener noreferrer"><span class="diff-link-icon" aria-hidden="true"></span>View full page diff</a>`:''}<a class="learn-link doc-action-link" href="${escapeHtml(item.publicUrl)}" target="_blank" rel="noopener noreferrer"><img src="/assets/ui/microsoft.svg" alt="">View on Microsoft Learn</a></div>` : '';
    const asideActions = item.publicUrl ? `${fullPageUrl?`<a class="aside-link diff-link doc-action-link" href="${escapeHtml(fullPageUrl)}" target="_blank" rel="noopener noreferrer"><span class="diff-link-icon" aria-hidden="true"></span>View full page diff</a>`:''}<a class="aside-link doc-action-link" href="${escapeHtml(item.publicUrl)}" target="_blank" rel="noopener noreferrer"><img src="/assets/ui/microsoft.svg" alt="">View on Microsoft Learn</a><hr class="rail-rule">` : '';
    return `${this.head(item.title,item.summary,item.url,'')}<div class="detail-layout"><main class="detail-main"><nav class="breadcrumbs"><a href="/week/${mondayOf(item.date)}/">Week of ${moment(mondayOf(item.date)).format('D MMMM YYYY')}</a> &nbsp;/&nbsp; <a href="/products/${item.product.slug}/">${escapeHtml(item.product.short)}</a> &nbsp;/&nbsp; <a href="/topics/${item.topic.slug}/">${escapeHtml(item.topic.name)}</a></nav><div class="detail-taxonomy-lockup"><div class="product-kicker"><img src="/assets/products/${item.product.icon}" alt="">${escapeHtml(item.product.name)}</div><a class="topic-kicker" href="/topics/${item.topic.slug}/"><img src="${item.topic.icon}" alt="">${escapeHtml(item.topic.name)}</a></div><h1>${escapeHtml(item.title)}</h1><div class="article-meta"><span>${moment(item.date).format('D MMMM YYYY')}</span><span>${escapeHtml(item.changeNature || item.changeType)}</span>${item.actionRequired?'<span>Action required</span>':''}<span>+${item.additions} / −${item.deletions} lines</span></div><section class="summary-grid editorial-summary" aria-label="${config.copy.detail.summaryLabel}"><div class="editorial-panel brief"><h2 class="section-title">In brief</h2><p>${escapeHtml(item.summary)}</p></div><div class="editorial-panel admin"><h2 class="section-title">${config.copy.detail.adminHeading}</h2><p>${escapeHtml(item.adminImpact)}</p></div><p class="ai-disclosure">${config.copy.detail.summaryDisclosure}</p></section><section class="doc-change" data-diff><h2 class="section-title">Documentation change</h2>${item.publicUrl?`<div class="doc-source-intro">${sourceActions}<p>The comparison below shows only the changed extract. Use the full-page view for complete context.</p></div>`:''}<div class="diff-tabs"><button class="active" data-diff-tab="formatted">Formatted</button><button data-diff-tab="markdown">Markdown</button></div><div class="diff-panel" data-diff-panel="formatted">${formattedDiff(item.patch)}</div><div class="diff-panel" data-diff-panel="markdown" hidden>${renderMarkdownDiff(item.patch)}</div></section></main><aside class="detail-aside">${asideActions}<h2 class="section-title">Related changes</h2>${this.relatedHtml(item,allItems)}<hr class="rail-rule">${this.emailSubscribeBox()}</aside></div>${this.footer()}`;
  }

  renderMcDetail(item, allItems) {
    return `${this.head(item.title,item.summary,item.url,'message-center')}<div class="detail-layout"><main class="detail-main"><nav class="breadcrumbs"><a href="/message-center/">Message Center</a> &nbsp;/&nbsp; <a href="/products/${item.product.slug}/">${escapeHtml(item.product.short)}</a></nav><div class="detail-taxonomy-lockup"><div class="product-kicker"><img src="/assets/products/${item.product.icon}" alt="">${escapeHtml(item.product.name)}</div><a class="topic-kicker" href="/topics/${item.topic.slug}/"><img src="${item.topic.icon}" alt="">${escapeHtml(item.topic.name)}</a></div><h1>${escapeHtml(item.title)}</h1><div class="article-meta"><span>${moment(item.date).format('D MMMM YYYY')}</span><a href="${item.originalUrl}">${escapeHtml(item.id)} on mc.merill.net ↗</a><span>${escapeHtml(item.changeType)}</span></div><section class="summary-grid single"><div><h2 class="section-title">In brief</h2><p>${escapeHtml(item.summary)}</p></div></section><section class="doc-change"><h2 class="section-title">Message Center announcement</h2><div class="mc-body">${item.body}</div></section></main><aside class="detail-aside"><a class="aside-link" href="${item.originalUrl}"><img src="/assets/ui/envelope-open.svg" alt="">Open original Message Center item ↗</a><a class="aside-link" href="/products/${item.product.slug}/"><img src="/assets/ui/book-bookmark.svg" alt="">Browse ${escapeHtml(item.product.short)}</a><hr class="rail-rule"><h2 class="section-title">Related changes</h2>${this.relatedHtml(item,allItems)}<hr class="rail-rule">${this.emailSubscribeBox()}</aside></div>${this.footer()}`;
  }

  async build() {
    const refreshStatusPath = path.join(this.websiteDir, 'refresh-status.json');
    const refreshStatus = await readJson(refreshStatusPath, null);
    if (!refreshStatus?.lastCheckedAt) {
      await writeJsonAtomic(refreshStatusPath, {
        lastCheckedAt: this.generatedAt,
        lastContentChangedAt: this.generatedAt,
        nextScheduledAt: nextScheduledRefresh(this.generatedAt),
        sourceChanges: { documentation: 0, messageCenter: 0 }
      });
    }
    for (const directory of ['changes','day','week','month','products','topics','message-center','about','compare','search']) {
      await fs.rm(path.join(this.websiteDir, directory), { recursive: true, force: true });
    }
    for (const file of await fs.readdir(this.websiteDir)) {
      if (/^\d{4}-\d{2}-\d{2}\.html$/.test(file)) await fs.rm(path.join(this.websiteDir, file));
    }
    this.generatedUrls = new Set(['/']);
    this.periodRailCache = {};
    await fs.mkdir(path.join(this.websiteDir,'assets'),{recursive:true});
    for (const asset of ['favicon.ico','favicon-16x16.png','favicon-32x32.png','apple-touch-icon.png','og-image.png']) {
      await fs.copyFile(path.join(this.siteAssetDir,asset),path.join(this.websiteDir,asset));
    }
    await fs.mkdir(path.join(this.websiteDir,'assets','ui'),{recursive:true});
    for (const asset of ['rss.svg','maester.png','book-bookmark.svg','calendar-date.svg','calendar-planning.svg','calendar-days.svg','square-layout-grid-2.svg','compare-items.svg','magnifier.svg','chevron-down.svg','chevron-right.svg','microsoft.svg','github.svg','chart-history.svg',...config.brand.uiAssets]) {
      await fs.copyFile(path.join(this.siteAssetDir,'ui',asset),path.join(this.websiteDir,'assets','ui',asset));
    }
    await fs.rm(path.join(this.websiteDir,'assets','products'),{recursive:true,force:true});
    await fs.mkdir(path.join(this.websiteDir,'assets','products'),{recursive:true});
    for (const asset of (await fs.readdir(path.join(this.siteAssetDir,'products'))).filter(file => file.endsWith('.svg'))) {
      await fs.copyFile(path.join(this.siteAssetDir,'products',asset),path.join(this.websiteDir,'assets','products',asset));
    }
    await fs.rm(path.join(this.websiteDir,'assets','topics'),{recursive:true,force:true});
    await fs.mkdir(path.join(this.websiteDir,'assets','topics'),{recursive:true});
    for (const asset of (await fs.readdir(path.join(this.siteAssetDir,'topics'))).filter(file => file.endsWith('.svg'))) {
      await fs.copyFile(path.join(this.siteAssetDir,'topics',asset),path.join(this.websiteDir,'assets','topics',asset));
    }
    await fs.copyFile(path.join(this.siteAssetDir,'learn-diff.js'),path.join(this.websiteDir,'assets','learn-diff.js'));
    await fs.copyFile(path.join(this.siteAssetDir,'diff-config.js'),path.join(this.websiteDir,'assets','diff-config.js'));
    await fs.mkdir(path.join(this.websiteDir,'assets','vendor'),{recursive:true});
    for (const [pkg, file, target] of [
      ['marked', 'lib/marked.umd.js', 'marked.js'],
      ['diff', 'dist/diff.min.js', 'diff.min.js'],
      ['node-htmldiff', 'js/htmldiff.js', 'htmldiff.js']
    ]) await fs.copyFile(vendorFile(pkg, file), path.join(this.websiteDir,'assets','vendor',target));
    await this.write('assets/site.css',`${CSS}\n${SEARCH_CSS}\n${SEARCH_LOADING_CSS}`);
    await this.write('assets/site.js',JS);
    await this.write('assets/search.js',SEARCH_JS);
    this.periodSummaries = await this.loadPeriodSummaries();
    const reports=await this.enrichCommitParents(await this.loadReports());
    const docs=this.normalizeDocItems(reports);
    const generatedDate=moment.utc(this.generatedAt).format('YYYY-MM-DD');
    const archiveStart=reports[0]?.date||'';
    this.archiveStart = archiveStart;
    this.archiveEnd = [reports.at(-1)?.date, generatedDate].filter(Boolean).sort().at(-1) || generatedDate;
    const mc=(await this.loadMessageCenterItems()).filter(item=>!archiveStart||item.date>=archiveStart);
    const items=[...docs,...mc].sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title));
    const latestDate=items[0]?.date||reports.at(-1)?.date||generatedDate;
    const latestWeek=mondayOf(latestDate), latestMonth=latestDate.slice(0,7);
    const recentCutoff=moment(latestDate).subtract(this.detailDays,'days');
    docs.filter(item=>moment(item.date).isBefore(recentCutoff)).forEach(item => { item.url = this.historicalDocUrl(item); });
    this.relatedByProduct = new Map(PRODUCTS.map(product => [product.slug, items.filter(item => item.product.slug === product.slug)]));
    this.relatedByTopic = new Map(TOPICS.map(topic => [topic.slug, items.filter(item => item.topic.slug === topic.slug)]));
    await this.write('index.html',this.renderDay(items,latestDate,{landing:true}));
    await this.write('day/index.html',this.renderDay(items,latestDate,{landing:true}));
    await this.write('week/index.html',this.renderWeek(items,latestWeek));
    await this.write('month/index.html',this.renderMonth(items,latestMonth));
    await this.write('products/index.html',this.renderDirectory(items,'product'));
    await this.write('topics/index.html',this.renderDirectory(items,'topic'));
    await this.write('about/index.html',this.renderAbout());
    await this.write('compare/index.html',this.renderLearnCompare());
    await this.write('search/index.html',this.renderSearch());
    await this.write('message-center/index.html',`${this.head('Message Center',`Microsoft 365 Message Center posts relevant to ${SITE.audience}.`,'/message-center/','message-center')}<div class="page-shell">${this.productRail()}<main class="content"><div class="eyebrow">Microsoft 365 roadmap signals</div><h1 class="page-title">${config.copy.messageCenterHeading}</h1><p class="lede">Announcements where the service or title includes ${SITE.productName}, presented beside related documentation changes.</p><section class="story-list">${this.itemRows(mc.slice(0,160))}</section></main>${this.periodRail(items,'month')}</div>${this.footer()}`);
    const earliestDate=this.archiveStart||items[items.length-1]?.date||latestDate;
    for(let day=moment(earliestDate);day.isSameOrBefore(moment(this.archiveEnd));day.add(1,'day')) {
      const date=day.format('YYYY-MM-DD');
      await this.write(`day/${date}/index.html`,this.renderDay(items,date));
    }
    for(let week=moment(mondayOf(earliestDate));week.isSameOrBefore(moment(mondayOf(latestDate)));week.add(1,'week')) {
      const weekKey=week.format('YYYY-MM-DD');
      await this.write(`week/${weekKey}/index.html`,this.renderWeek(items,weekKey));
    }
    for(let month=moment(`${earliestDate.slice(0,7)}-01`);month.isSameOrBefore(moment(`${latestMonth}-01`));month.add(1,'month')) {
      const monthKey=month.format('YYYY-MM');
      await this.write(`month/${monthKey}/index.html`,this.renderMonth(items,monthKey));
    }
    for(const product of PRODUCTS) await this.write(`products/${product.slug}/index.html`,this.renderCollection(items,product,'product'));
    for(const topic of TOPICS) await this.write(`topics/${topic.slug}/index.html`,this.renderCollection(items,topic,'topic'));
    for(const item of docs.filter(item=>moment(item.date).isSameOrAfter(recentCutoff))) await this.write(`${item.url.replace(/^\//,'')}index.html`,this.renderDocDetail(item,items));
    for(const item of mc) await this.write(`message-center/${item.id}/index.html`,this.renderMcDetail(item,items));
    await this.write('rss.xml',renderDailyRss(reports,this.periodSummaries.days,50,items));
    await this.write('robots.txt',`User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`);
    await this.write('llms.txt',`# ${SITE.name}\n\n${SITE.description}\n\n- [Latest day](${SITE.url}/)\n- [Current week](${SITE.url}/week/)\n- [Products](${SITE.url}/products/)\n- [Topics](${SITE.url}/topics/)\n- [Message Center](${SITE.url}/message-center/)\n- [Search the archive](${SITE.url}/search/)\n- [Compare a Learn page](https://mx.merill.net/)\n- [About](${SITE.url}/about/)\n- [RSS](${SITE.url}/rss.xml)\n`);
    await this.write('CNAME',`${SITE.host}\n`);
    const sitemap=[...this.generatedUrls].filter(url=>!url.startsWith('/assets/')).map(url=>`<url><loc>${SITE.url}${url}</loc></url>`).join('');
    await this.write('sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemap}</urlset>`);
    console.log(`Generated ${this.generatedUrls.size} static ${SITE.name} URLs with ${docs.length} doc changes and ${mc.length} Message Center posts.`);
    return { docs: docs.length, messageCenter: mc.length, urls: this.generatedUrls.size, latestDate };
  }
}

module.exports = { StaticSiteGenerator, PRODUCTS, TOPICS, isProductMessage, classifyProduct, classifyTopic, extractMarkdownMetadata, findRelatedItems, selectRelatedItems, sanitizeMcHtml, slugify, formattedDiff, renderMarkdownDiff, dailySummaryText, renderDailyRss };
