const fs = require('fs').promises;
const path = require('path');
const moment = require('moment-timezone');
const { marked } = require('marked');
const { parse } = require('node-html-parser');

const SITE = {
  name: 'Entra.News Daily',
  host: 'daily.entra.news',
  url: 'https://daily.entra.news',
  description: 'A readable record of what changed across Microsoft Entra documentation and Message Center.'
};

const REFRESH_SCHEDULE_UTC = { hour: 8, minute: 15 };

function nextRefreshAfter(value) {
  const generated = moment.utc(value);
  const next = generated.clone().startOf('day')
    .hour(REFRESH_SCHEDULE_UTC.hour)
    .minute(REFRESH_SCHEDULE_UTC.minute);
  if (!next.isAfter(generated)) next.add(1, 'day');
  return next.toISOString();
}

function dateAtRefresh(date) {
  return `${date}T${String(REFRESH_SCHEDULE_UTC.hour).padStart(2, '0')}:${String(REFRESH_SCHEDULE_UTC.minute).padStart(2, '0')}:00Z`;
}

const PRODUCTS = [
  { slug: 'entra-id', name: 'Microsoft Entra ID', short: 'Entra ID', icon: 'entra-id.svg', learn: 'https://learn.microsoft.com/en-us/entra/identity/' },
  { slug: 'agent-id', name: 'Microsoft Entra Agent ID', short: 'Agent ID', icon: 'entra-family.svg', learn: 'https://learn.microsoft.com/en-us/entra/agent-id/' },
  { slug: 'id-protection', name: 'Microsoft Entra ID Protection', short: 'ID Protection', icon: 'id-protection.svg', learn: 'https://learn.microsoft.com/en-us/entra/id-protection/' },
  { slug: 'id-governance', name: 'Microsoft Entra ID Governance', short: 'ID Governance', icon: 'id-governance.svg', learn: 'https://learn.microsoft.com/en-us/entra/id-governance/' },
  { slug: 'external-id', name: 'Microsoft Entra External ID', short: 'External ID', icon: 'external-id.svg', learn: 'https://learn.microsoft.com/en-us/entra/external-id/' },
  { slug: 'internet-access', name: 'Microsoft Entra Internet Access', short: 'Internet Access', icon: 'internet-access.svg', learn: 'https://learn.microsoft.com/en-us/entra/global-secure-access/concept-internet-access' },
  { slug: 'private-access', name: 'Microsoft Entra Private Access', short: 'Private Access', icon: 'private-access.svg', learn: 'https://learn.microsoft.com/en-us/entra/global-secure-access/concept-private-access' },
  { slug: 'verified-id', name: 'Microsoft Entra Verified ID', short: 'Verified ID', icon: 'verified-id.svg', learn: 'https://learn.microsoft.com/en-us/entra/verified-id/' },
  { slug: 'workload-id', name: 'Microsoft Entra Workload ID', short: 'Workload ID', icon: 'workload-id.svg', learn: 'https://learn.microsoft.com/en-us/entra/workload-id/' },
  { slug: 'global-secure-access', name: 'Microsoft Entra Global Secure Access', short: 'Global Secure Access', icon: 'global-secure-access.svg', learn: 'https://learn.microsoft.com/en-us/entra/global-secure-access/' },
  { slug: 'security-copilot', name: 'Security Copilot + Entra', short: 'Security Copilot', icon: 'entra-family.svg', learn: 'https://learn.microsoft.com/en-us/entra/fundamentals/copilot-security-entra' }
];

const TOPICS = [
  { slug: 'architecture', name: 'Architecture' },
  { slug: 'standards', name: 'Standards' },
  { slug: 'identity-platform', name: 'Microsoft identity platform' },
  { slug: 'fundamentals', name: 'Fundamentals' },
  { slug: 'troubleshooting', name: 'Troubleshooting' },
  { slug: 'authentication', name: 'Authentication' },
  { slug: 'conditional-access', name: 'Conditional Access' },
  { slug: 'security', name: 'Security' },
  { slug: 'governance', name: 'Governance' },
  { slug: 'provisioning', name: 'Provisioning' },
  { slug: 'branding', name: 'Branding' },
  { slug: 'monitoring', name: 'Monitoring' },
  { slug: 'developer', name: 'Developer' },
  { slug: 'general', name: 'General' }
];

const STOPWORDS = new Set('microsoft entra documentation docs update updated updates change changes new for with from into about that this your their has have will are and the how use using overview configure configuration guide learn overview support service services preview'.split(' '));

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function stripHtml(value = '') {
  return parse(String(value)).text.replace(/\s+/g, ' ').trim();
}

function truncate(value = '', length = 220) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1).trim()}…` : text;
}

function slugify(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96) || 'update';
}

function isEntraMessage(message) {
  const pattern = /\bEntra\b/i;
  return (message.Services || []).some(service => pattern.test(String(service))) || pattern.test(String(message.Title || ''));
}

function classifyProduct(filename = '', title = '', body = '') {
  const text = `${filename} ${title} ${body}`.toLowerCase();
  if (/microsoft entra id(?:\s*:|\b)/i.test(title) && !/(governance|protection|workload|external|verified)/i.test(title)) {
    return PRODUCTS.find(product => product.slug === 'entra-id');
  }
  const rules = [
    ['agent-id', /agent[- ]?id|agent identit/],
    ['id-protection', /id[- /]?protection|risk[- ]?detection|risky user/],
    ['id-governance', /id[- /]?governance|entitlement|access review|lifecycle workflow|tenant governance/],
    ['external-id', /external[- /]?id|external identit|b2b|b2c|cross.?tenant/],
    ['verified-id', /verified[- /]?id|verifiable credential/],
    ['workload-id', /workload[- /]?id|workload identit|managed identit|federated credential|service principal/],
    ['internet-access', /internet[- /]?access|internet access/],
    ['private-access', /private[- /]?access|private access/],
    ['global-secure-access', /global[- /]?secure[- /]?access|global secure access|\bgsa\b/],
    ['security-copilot', /security copilot|copilot for security/],
    ['entra-id', /docs\/identity|entra id|authentication|conditional access|enterprise app|app registration|directory|tenant|user|group|sign-in|branding|passkey|password/]
  ];
  const hit = rules.find(([, pattern]) => pattern.test(text));
  return PRODUCTS.find(product => product.slug === (hit ? hit[0] : 'entra-id'));
}

function classifyTopic(filename = '', title = '', body = '') {
  const text = `${filename} ${title} ${body}`.toLowerCase();
  const rules = [
    ['architecture', /architecture|deployment plan|design pattern|reference architecture/],
    ['branding', /branding|custom css|sign-in page/],
    ['standards', /standard|rfc|openid|oauth|saml|scim/],
    ['identity-platform', /identity platform|app registration|developer|msal|graph api/],
    ['fundamentals', /fundamental|what is|overview|concept/],
    ['troubleshooting', /troubleshoot|error|diagnos|remediat/],
    ['authentication', /authenticat|passkey|password|fido|sms|voice|sign-in/],
    ['conditional-access', /conditional access/],
    ['governance', /governance|entitlement|access review|lifecycle|configuration monitor|snapshot/],
    ['provisioning', /provision|scim|synchroni[sz]/],
    ['monitoring', /monitor|log|report|audit/],
    ['security', /security|risk|protect|credential|vulnerab/],
    ['developer', /developer|api|sdk|code|application/]
  ];
  const hit = rules.find(([, pattern]) => pattern.test(text));
  return TOPICS.find(topic => topic.slug === (hit ? hit[0] : 'general'));
}

function humanizeFilename(filename = '') {
  const leaf = filename.split('/').pop().replace(/\.md$/i, '').replace(/^(concept|how-to|reference|overview)-/, '');
  return leaf.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
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
    || `A Microsoft Entra documentation page was updated: ${title}.`;
  return { title: truncate(title.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'), 150), description: truncate(description, 260) };
}

function tokenize(value = '') {
  return new Set(slugify(value).split('-').filter(token => token.length > 3 && !STOPWORDS.has(token)));
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

function renderLearnMarkdown(markdown = '') {
  return marked.parse(markdown, { async: false })
    .replace(/(href|src)="\/(?!\/)([^"]+)"/g, '$1="https://learn.microsoft.com/$2"')
    .replace(/(href|src)="~\/([^"]+)"/g, '$1="https://learn.microsoft.com/en-us/entra/$2"');
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

  // Metadata-only hunks don't always include either delimiter.
  const meaningful = records.filter(record => record.value.trim());
  if (meaningful.length && meaningful.every(record => /^[a-z][\w.-]*\s*:/i.test(record.value.trim()))) return [];
  return records;
}

function tableDivider(value = '') {
  const cells = value.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function diffKind(records) {
  const kinds = new Set(records.filter(record => record.value.trim()).map(record => record.kind));
  if (kinds.size === 1) return [...kinds][0];
  if (kinds.has('added') && !kinds.has('removed')) return 'added';
  if (kinds.has('removed') && !kinds.has('added')) return 'removed';
  return 'changed';
}

function renderDiffRuns(records, className = 'rendered-change') {
  const groups = [];
  for (const record of records) {
    let current = groups[groups.length - 1];
    if (!current || current.kind !== record.kind) {
      current = { kind: record.kind, lines: [] };
      groups.push(current);
    }
    current.lines.push(record.value);
  }
  return groups.filter(group => group.lines.some(line => line.trim())).map(group =>
    `<div class="${className} ${group.kind}">${renderLearnMarkdown(group.lines.join('\n'))}</div>`
  ).join('');
}

function renderTableDiff(records) {
  const root = parse(renderLearnMarkdown(records.map(record => record.value).join('\n')));
  const bodyRows = root.querySelectorAll('tbody tr');
  records.slice(2).filter(record => record.value.trim()).forEach((record, index) => {
    if (bodyRows[index]) bodyRows[index].setAttribute('class', `diff-row ${record.kind}`);
  });
  return `<div class="rendered-change rendered-table ${diffKind(records)}">${root.toString()}</div>`;
}

function renderLearnAlert(type, records) {
  const label = type.charAt(0) + type.slice(1).toLowerCase();
  const body = records.slice(1).map(record => ({ ...record, value: record.value.replace(/^>\s?/, '') }));
  const renderedBody = renderDiffRuns(body, 'learn-alert-change') || '<p class="quiet">Alert content changed.</p>';
  return `<aside class="learn-alert learn-alert-${type.toLowerCase()} diff-${diffKind(records)}"><div class="learn-alert-title"><span class="learn-alert-icon" aria-hidden="true">!</span><span>${label}</span></div><div class="learn-alert-body">${renderedBody}</div></aside>`;
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
  const blocks = [];
  let regular = [];
  const flushRegular = () => {
    if (regular.length) blocks.push(renderDiffRuns(regular));
    regular = [];
  };

  for (let index = 0; index < content.length;) {
    const alert = content[index].value.trim().match(/^>\s*\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]\s*$/i);
    if (alert) {
      flushRegular();
      let end = index + 1;
      while (end < content.length) {
        const nextValue = content[end].value.trim();
        if (end > index + 1 && /^>\s*\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]\s*$/i.test(nextValue)) break;
        if (!/^>/.test(content[end].value.trimStart()) && nextValue) break;
        end += 1;
      }
      blocks.push(renderLearnAlert(alert[1].toUpperCase(), content.slice(index, end)));
      index = end;
      continue;
    }

    if (index + 1 < content.length && content[index].value.includes('|') && tableDivider(content[index + 1].value)) {
      flushRegular();
      let end = index + 2;
      while (end < content.length && content[end].value.trim() && content[end].value.includes('|')) end += 1;
      blocks.push(renderTableDiff(content.slice(index, end)));
      index = end;
      continue;
    }

    regular.push(content[index]);
    index += 1;
  }
  flushRegular();
  return blocks.filter(Boolean).slice(0, 80).join('') || '<p class="quiet">No content changes were available in this diff.</p>';
}

const CSS = `
:root{--paper:#f7f5ef;--ink:#11181d;--muted:#5c6665;--green:#0d5745;--green-soft:#e3eee8;--rule:#d8d3c7;--red:#8e342e;--red-soft:#f3dfdc;--sans:"Aptos","Segoe UI",system-ui,sans-serif;--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.52}a{color:var(--green);text-decoration-thickness:1px;text-underline-offset:3px}a:hover{color:#083b30}.site-header{height:78px;border-bottom:1px solid var(--rule);display:flex;align-items:center;padding:0 3.2vw;gap:28px;background:rgba(247,245,239,.97);position:sticky;top:0;z-index:10}.brand{font-family:var(--serif);font-size:31px;font-weight:700;color:var(--ink);text-decoration:none;white-space:nowrap}.brand small{font-family:var(--sans);font-size:12px;font-weight:500;color:var(--muted);margin-left:14px;letter-spacing:.02em}.main-nav{margin-left:auto;display:flex;align-items:center;gap:28px}.main-nav a{color:var(--ink);text-decoration:none;padding:27px 0 22px;border-bottom:4px solid transparent}.main-nav a[aria-current="page"]{color:var(--green);border-color:var(--green);font-weight:650}.utility{display:flex;align-items:center;gap:16px;border-left:1px solid var(--rule);padding-left:23px}.site-link{font-size:13px;color:var(--muted);text-decoration:none;white-space:nowrap}.site-link:hover{color:var(--green)}.icon-link{display:inline-flex}.icon-link img,.icon{width:20px;height:20px}.page-shell{max-width:1420px;margin:0 auto;display:grid;grid-template-columns:270px minmax(0,1fr) 235px;min-height:calc(100vh - 78px)}.left-rail,.right-rail{padding:32px 24px}.left-rail{border-right:1px solid var(--rule)}.right-rail{border-left:1px solid var(--rule)}.content{padding:30px 42px 70px;min-width:0}.eyebrow{font-family:var(--serif);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#313937}.rail-heading{font-family:var(--serif);font-size:13px;letter-spacing:.1em;text-transform:uppercase;margin:0 0 20px}.product-list,.plain-list{list-style:none;padding:0;margin:0}.product-list li{margin:0 0 17px}.product-list a{display:flex;align-items:center;gap:11px;color:var(--ink);font-family:var(--serif);font-size:15px}.product-list img{width:30px;height:30px;object-fit:contain}.plain-list li{margin:0 0 11px}.rail-rule{border:0;border-top:1px solid var(--rule);margin:26px 0}.page-title{font-family:var(--serif);font-size:38px;line-height:1.1;margin:8px 0 12px;font-weight:650}.section-title{font-family:var(--serif);font-size:26px;line-height:1.2;margin:0 0 15px}.lede{font-size:17px;max-width:850px;color:#263030}.period-nav{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--rule);padding-bottom:18px}.period-nav h1{font-family:var(--serif);font-size:27px;margin:0}.feature{padding:26px 0 25px;border-bottom:1px solid var(--rule)}.feature h2{font-family:var(--serif);font-size:31px;line-height:1.15;margin:8px 0 14px}.feature p{max-width:820px}.taxonomy{font-family:var(--serif);color:var(--green);font-size:14px}.story-list{margin-top:20px}.date-group{border-bottom:1px solid var(--rule);padding:0 0 9px;margin-bottom:14px}.date-label{font-family:var(--serif);text-transform:uppercase;letter-spacing:.08em;font-size:13px;margin:0 0 8px}.story-row{display:grid;grid-template-columns:105px 1fr;gap:18px;padding:8px 0}.story-time{color:var(--muted);font-family:var(--serif)}.story-row h3{font-family:var(--serif);font-size:18px;line-height:1.25;margin:0 0 4px;font-weight:500}.story-row h3 a{color:var(--ink);text-decoration:none}.story-row h3 a:hover{text-decoration:underline;text-decoration-color:var(--green)}.source-label{font-family:var(--sans);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-left:8px}.archive-links a{display:block;margin-bottom:10px}.rss-box{display:flex;gap:10px;align-items:flex-start}.rss-box img{width:18px}.hero-product{display:grid;grid-template-columns:125px 1fr;gap:28px;align-items:center;padding:8px 0 30px;border-bottom:1px solid var(--rule)}.hero-product>img{width:120px;height:120px;object-fit:contain}.hero-product h1{font-family:var(--serif);font-size:43px;margin:0 0 5px}.hero-product p{margin:0 0 12px}.two-column{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:52px}.article-list article{display:grid;grid-template-columns:135px 1fr;gap:20px;padding:15px 0;border-bottom:1px solid var(--rule)}.article-list h2{font-family:var(--serif);font-size:19px;font-weight:500;line-height:1.25;margin:0 0 3px}.article-list h2 a{color:var(--green);text-decoration:none}.article-list p{font-size:14px;margin:4px 0}.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:38px;border-bottom:1px solid var(--rule);padding:20px 0 24px}.summary-grid>div+div{border-left:1px solid var(--rule);padding-left:38px}.action-list{list-style:none;padding:0;margin:0}.action-list li{position:relative;padding-left:28px;margin:0 0 10px}.action-list li:before{content:"✓";position:absolute;left:0;color:var(--green);font-weight:700}.article-meta{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);border-bottom:1px solid var(--rule);padding-bottom:18px}.detail-layout{max-width:1420px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:calc(100vh - 78px)}.detail-main{padding:26px 48px 70px}.detail-aside{border-left:1px solid var(--rule);padding:54px 30px}.breadcrumbs{font-family:var(--serif);font-size:14px;margin-bottom:25px}.product-kicker{display:flex;align-items:center;gap:12px;font-family:var(--serif)}.product-kicker img{width:34px;height:34px}.detail-main h1{font-family:var(--serif);font-size:39px;line-height:1.1;margin:8px 0 14px;max-width:950px}.doc-change{padding-top:26px}.diff-tabs{display:flex;gap:25px;border-bottom:1px solid var(--rule);margin-bottom:15px}.diff-tabs button{font:inherit;border:0;border-bottom:3px solid transparent;background:transparent;padding:0 3px 9px;cursor:pointer}.diff-tabs button.active{color:var(--green);border-color:var(--green);font-weight:650}.diff-panel[hidden]{display:none}.rendered-change{padding:8px 12px;margin:0 0 3px;border-left:3px solid transparent}.rendered-change p,.rendered-change ul,.rendered-change ol,.rendered-change pre,.rendered-change h1,.rendered-change h2,.rendered-change h3{margin:2px 0}.rendered-change.added{background:var(--green-soft);border-color:#79aa89}.rendered-change.removed{background:var(--red-soft);border-color:#c88680;color:#642620;text-decoration:line-through}.rendered-change.context{padding-left:15px}.raw-diff{background:#222824;color:#eef4ef;padding:20px;overflow:auto;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap}.aside-link{display:flex;gap:12px;margin:0 0 22px;text-decoration:none}.aside-link img{width:21px;height:21px}.related-item{margin:0 0 19px}.related-item time{display:block;color:var(--green);font-family:var(--serif)}.related-item a{color:var(--ink);text-decoration:none;font-family:var(--serif)}.calendar{display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid var(--rule);border-left:1px solid var(--rule);margin:14px 0 28px}.calendar-head,.calendar-day{border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:9px;min-height:83px}.calendar-head{min-height:auto;text-align:center;font-family:var(--serif);font-size:11px;letter-spacing:.05em;text-transform:uppercase}.calendar-day strong{display:block;font-family:var(--serif);font-weight:500}.calendar-day.selected{outline:1px solid var(--green);outline-offset:-2px;background:#eef3ed}.day-icons{display:flex;gap:4px;margin-top:8px}.day-icons img{width:22px;height:22px;object-fit:contain}.table{width:100%;border-collapse:collapse;font-family:var(--serif)}.table th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.table td,.table th{border-bottom:1px solid var(--rule);padding:8px 6px}.table img{width:24px;height:24px;vertical-align:middle;margin-right:8px}.footer{border-top:1px solid var(--rule);padding:22px 3vw;color:var(--muted);display:flex;justify-content:space-between;gap:20px;font-size:13px}.quiet{color:var(--muted)}.mc-body{max-width:820px}.mc-body h1,.mc-body h2,.mc-body h3{font-family:var(--serif)}.mc-body table{border-collapse:collapse;width:100%}.mc-body td,.mc-body th{border:1px solid var(--rule);padding:8px}.empty{border:1px solid var(--rule);padding:30px;margin-top:20px}.mobile-menu{display:none}
.story-row{display:block;padding:10px 0}.story-source{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin:4px 0 3px;color:var(--muted);font-size:12px}.story-source .mc-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--green)}.story-source a{font-family:var(--sans);font-weight:650}.summary-grid.single{grid-template-columns:minmax(0,820px);gap:0}.month-overview{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.85fr);gap:50px;padding:4px 0 30px;margin:0 0 30px;border-bottom:1px solid var(--rule)}.month-overview h2{font-family:var(--serif);font-size:29px;line-height:1.2;margin:7px 0 12px}.month-overview p{margin:0;max-width:700px}.month-highlights{list-style:none;padding:0;margin:0;border-top:1px solid var(--rule)}.month-highlights li{padding:11px 0;border-bottom:1px solid var(--rule)}.month-highlights a{display:block;color:var(--ink);font-family:var(--serif);font-size:17px;line-height:1.25;text-decoration:none}.month-highlights a:hover{text-decoration:underline;text-decoration-color:var(--green)}.month-highlights .taxonomy{margin-top:3px}.calendar-date-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.calendar-count{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 6px;border-radius:999px;background:var(--green);color:#fff;font:700 11px/1 var(--sans);text-decoration:none}.related-meta{display:block;color:var(--green);font-family:var(--serif);font-size:14px}.related-meta a{font-family:var(--serif);color:var(--green);text-decoration:underline}.weekday-short{display:none}
.product-groups{margin-top:20px}.product-update-group{border-top:1px solid var(--rule);padding:22px 0 12px}.product-group-header{display:flex;align-items:center;gap:14px;margin:0 0 18px}.product-group-header img{width:38px;height:38px;object-fit:contain}.product-group-header h2{font-family:var(--serif);font-size:24px;line-height:1.15;margin:0}.product-group-header h2 a{color:var(--ink);text-decoration:none}.product-group-count{display:block;color:var(--muted);font-size:12px;margin-top:2px}.topic-update-group{margin:0 0 22px 52px}.topic-group-header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid var(--rule);padding-bottom:7px}.topic-group-header h3{font-family:var(--serif);font-size:16px;line-height:1.2;margin:0}.topic-group-header h3 a{color:var(--green);text-decoration:none}.topic-group-count{color:var(--muted);font-size:12px}.grouped-story{padding:10px 0;border-bottom:1px solid rgba(216,211,199,.72)}.grouped-story-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.grouped-story h4{font-family:var(--serif);font-size:18px;font-weight:500;line-height:1.3;margin:0}.grouped-story h4 a{color:var(--ink);text-decoration:none}.grouped-story h4 a:hover{text-decoration:underline;text-decoration-color:var(--green)}.change-pill{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border:1px solid var(--rule);border-radius:999px;padding:2px 8px;font:700 10px/1.4 var(--sans);letter-spacing:.06em;text-transform:uppercase}.change-pill.new{background:var(--green-soft);border-color:#a9c8b5;color:var(--green)}.change-pill.updated{background:#ece9e1;color:#4c5653}.change-pill.removed{background:var(--red-soft);border-color:#d7aaa6;color:var(--red)}.story-support{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin-top:4px;color:var(--muted);font-size:12px}.story-support .story-source{margin:0}.month-overview.compact{grid-template-columns:minmax(0,760px);margin-bottom:20px}.rail-count-list{list-style:none;padding:0;margin:0}.rail-count-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--rule)}.rail-count-list a{display:flex;align-items:center;gap:8px;color:var(--ink);font-family:var(--serif);font-size:14px}.rail-count-list img{width:22px;height:22px;object-fit:contain}.rail-count{color:var(--muted);font-family:var(--serif)}
.site-link[aria-current="page"]{color:var(--green);font-weight:650}.about-layout{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 270px;min-height:calc(100vh - 78px)}.about-main{padding:56px 64px 82px 36px}.about-aside{border-left:1px solid var(--rule);padding:62px 30px}.about-kicker{display:flex;align-items:center;gap:13px;margin-bottom:26px}.about-kicker img{width:42px;height:42px;object-fit:contain}.about-hero{border-bottom:1px solid var(--rule);padding-bottom:38px}.about-hero h1{font-family:var(--serif);font-size:52px;line-height:1.04;letter-spacing:-.02em;max-width:820px;margin:0 0 20px}.about-hero .lede{font-size:20px;line-height:1.55;max-width:780px;margin:0}.about-section{padding:34px 0;border-bottom:1px solid var(--rule)}.about-section h2{font-family:var(--serif);font-size:28px;line-height:1.2;margin:0 0 12px}.about-section p{max-width:760px;margin:0 0 14px}.about-section p:last-child{margin-bottom:0}.about-pair{display:grid;grid-template-columns:1fr 1fr;gap:44px}.about-pair .about-section+section{border-left:1px solid var(--rule);padding-left:44px}.community-note{margin-top:34px;border-left:4px solid var(--green);padding:4px 0 4px 24px}.community-note p{font-family:var(--serif);font-size:25px;line-height:1.35;margin:0;max-width:760px}.about-aside .plain-list{margin-bottom:28px}.about-aside .plain-list a{font-family:var(--serif)}.about-aside p{font-size:14px;color:var(--muted)}
@media(max-width:1050px){.site-header{height:auto;min-height:68px;padding:13px 24px;flex-wrap:wrap;gap:12px}.main-nav{order:3;width:100%;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0 12px}.main-nav a{padding:7px 0;text-align:center;white-space:nowrap}.utility{margin-left:auto;border:0;padding:0}.page-shell{grid-template-columns:220px minmax(0,1fr)}.right-rail{display:none}.content{padding:28px}.detail-layout{grid-template-columns:1fr}.detail-aside{border-left:0;border-top:1px solid var(--rule);padding:28px 48px}.two-column{grid-template-columns:1fr}.two-column>aside{border-top:1px solid var(--rule);padding-top:25px}}
@media(max-width:760px){.site-header{height:auto;min-height:68px;padding:13px 18px;flex-wrap:wrap;gap:12px}.brand{font-size:24px}.brand small{display:none}.main-nav{order:3;width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 12px}.main-nav a{padding:7px 0;text-align:center;white-space:nowrap}.utility{margin-left:auto;border:0;padding:0}.page-shell{display:block}.left-rail{display:none}.content,.detail-main{padding:24px 19px 55px}.detail-aside{padding:27px 19px}.page-title,.detail-main h1{font-size:32px}.period-nav{display:grid;grid-template-columns:1fr;gap:8px;align-items:start}.period-nav h1{font-size:22px;grid-row:2}.period-nav>span:empty{display:none}.story-row{grid-template-columns:75px 1fr}.summary-grid{grid-template-columns:1fr}.summary-grid>div+div{border-left:0;border-top:1px solid var(--rule);padding:22px 0 0}.hero-product{grid-template-columns:75px 1fr}.hero-product>img{width:70px;height:70px}.hero-product h1{font-size:34px}.article-list article{grid-template-columns:1fr;gap:4px}.calendar-head{font-size:8px;padding:6px 2px}.calendar-day{min-height:64px;padding:5px}.calendar .day-icons img:nth-child(n+2){display:none}.footer{display:block}.footer div+div{margin-top:8px}}
@media(max-width:760px){.month-overview{grid-template-columns:1fr;gap:24px}.calendar{width:100%;min-width:0}.calendar-head,.calendar-day{min-width:0}.weekday-long{display:none}.weekday-short{display:inline}.calendar-count{min-width:20px;height:18px;padding:0 5px;font-size:10px}.day-icons{margin-top:5px}}
@media(max-width:1050px){.month-stats-rail{display:block;grid-column:2;border-left:0;border-top:1px solid var(--rule);padding:28px}}
@media(max-width:1050px){.about-layout{grid-template-columns:minmax(0,1fr) 240px}.about-main{padding:45px 38px 70px}.about-aside{padding:52px 25px}.about-hero h1{font-size:45px}}
@media(max-width:760px){.topic-update-group{margin-left:0}.product-group-header img{width:34px;height:34px}.grouped-story-head{align-items:flex-start}.month-stats-rail{display:block;padding:26px 19px}}
@media(max-width:760px){.about-layout{display:block}.about-main{padding:36px 19px 54px}.about-aside{border-left:0;border-top:1px solid var(--rule);padding:30px 19px}.about-hero h1{font-size:38px}.about-hero .lede{font-size:18px}.about-pair{grid-template-columns:1fr;gap:0}.about-pair .about-section+section{border-left:0;padding-left:0}.community-note{padding-left:18px}.community-note p{font-size:22px}}
#stay-current{scroll-margin-top:96px}.update-paths{display:grid;grid-template-columns:1fr 1fr;gap:44px}.update-path{padding-top:5px}.update-path+.update-path{border-left:1px solid var(--rule);padding-left:44px}.update-path h3{font-family:var(--serif);font-size:23px;line-height:1.2;margin:6px 0 10px}.update-path p{margin-bottom:13px}.update-link{display:inline-block;font-family:var(--serif);font-size:17px;font-weight:650}.about-aside .stay-current a{font-family:var(--serif);font-weight:650}@media(max-width:760px){#stay-current{scroll-margin-top:200px}.update-paths{grid-template-columns:1fr;gap:26px}.update-path+.update-path{border-left:0;border-top:1px solid var(--rule);padding:26px 0 0}}
.product-update-group{scroll-margin-top:96px}.period-product-rail .rail-heading:first-child{margin-bottom:14px}.period-product-rail .rail-count-list{margin-bottom:2px}
.footer{display:block;padding:0;color:var(--ink);font-size:14px;background:#f0eee6}.footer-inner{max-width:1420px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.8fr) minmax(280px,.8fr);gap:0;padding:52px 3.2vw 46px}.footer-feature{padding-right:54px}.footer-feature h2{font-family:var(--serif);font-size:40px;line-height:1.05;margin:7px 0 15px}.footer-feature h2 a{color:var(--ink);text-decoration:none}.footer-feature p{font-size:17px;line-height:1.55;max-width:580px;margin:0 0 17px;color:#34403d}.footer-cta{display:inline-block;font-family:var(--serif);font-size:17px;font-weight:650}.footer-projects,.footer-support{border-left:1px solid var(--rule);padding-left:38px}.footer-section-title{font-family:var(--serif);font-size:21px;line-height:1.2;margin:0 0 16px}.footer-project-list{list-style:none;margin:0;padding:0}.footer-project-list li{padding:7px 0;border-bottom:1px solid rgba(216,211,199,.85)}.footer-project-list a{color:var(--ink);font-family:var(--serif);font-size:16px;text-decoration:none}.footer-project-list a:hover{text-decoration:underline;text-decoration-color:var(--green)}.footer-support p{color:#34403d;max-width:300px;margin:0 0 16px}.footer-support-links{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.footer-support-links a{font-family:var(--serif);font-size:16px;font-weight:650}.footer-bottom{border-top:1px solid var(--rule);max-width:1420px;margin:0 auto;padding:20px 3.2vw 24px;display:flex;justify-content:space-between;gap:24px;color:var(--muted);font-size:13px}.footer-bottom nav{display:flex;flex-wrap:wrap;gap:8px 20px}.footer-bottom a{color:var(--muted)}.refresh-status{display:flex;flex-wrap:wrap;gap:3px 14px;margin-top:5px;font-size:12px}.refresh-status time{color:#35413e}.refresh-relative{white-space:nowrap}
@media(max-width:1050px){.footer-inner{grid-template-columns:1fr 1fr}.footer-feature{grid-column:1/-1;border-bottom:1px solid var(--rule);padding:0 0 35px;margin-bottom:35px}.footer-projects{border-left:0;padding-left:0;padding-right:35px}.footer-support{padding-left:35px}}
@media(max-width:760px){.product-update-group{scroll-margin-top:200px}.footer{display:block}.footer-inner{display:block;padding:38px 19px 34px}.footer-feature{padding-bottom:30px;margin-bottom:30px}.footer-feature h2{font-size:34px}.footer-projects,.footer-support{border-left:0;padding:0}.footer-support{border-top:1px solid var(--rule);margin-top:30px;padding-top:30px}.footer div+div{margin-top:0}.footer-bottom{display:block;padding:20px 19px 26px}.footer-bottom nav{margin-top:14px}.refresh-status{display:block}.refresh-status span{display:block;margin-top:3px}}
.rendered-change.changed{background:#efede6;border-color:#9a927f}.rendered-table{padding:0;margin:16px 0 22px;background:transparent!important;border-left:0}.rendered-table table{width:100%;border-collapse:collapse;background:#fff}.rendered-table th,.rendered-table td{border:1px solid #c9c9c9;padding:13px 15px;text-align:left;vertical-align:top}.rendered-table th{font-weight:700;background:#fafafa}.rendered-table tr.diff-row.added td{background:var(--green-soft)}.rendered-table tr.diff-row.removed td{background:var(--red-soft);color:#642620;text-decoration:line-through}.learn-alert{--alert-bg:#efd9fd;--alert-border:#3b2e58;display:block;margin:20px 0 24px;padding:20px 24px;border:1px solid var(--alert-border);border-radius:10px;background:var(--alert-bg);color:var(--ink)}.learn-alert-note{--alert-bg:#efd9fd;--alert-border:#3b2e58}.learn-alert-tip{--alert-bg:#f1faf1;--alert-border:#0e700e}.learn-alert-important{--alert-bg:#ebf3fc;--alert-border:#115ea3}.learn-alert-caution{--alert-bg:#fff9f5;--alert-border:#8a3707}.learn-alert-warning{--alert-bg:#fdf3f4;--alert-border:#b10e1c}.learn-alert-title{display:flex;align-items:center;gap:10px;margin:0 0 14px;color:var(--alert-border);font-weight:700;font-size:18px}.learn-alert-icon{display:inline-flex;align-items:center;justify-content:center;width:21px;height:21px;border:2px solid currentColor;border-radius:50%;font:700 13px/1 var(--sans)}.learn-alert-body p,.learn-alert-body ul,.learn-alert-body ol,.learn-alert-body pre{margin:0 0 10px}.learn-alert-body>*:last-child,.learn-alert-change>*:last-child{margin-bottom:0}.learn-alert-change{padding:7px 10px;margin:0 -10px 3px;border-left:3px solid transparent}.learn-alert-change.added{background:rgba(227,238,232,.78);border-color:#79aa89}.learn-alert-change.removed{background:rgba(243,223,220,.82);border-color:#c88680;color:#642620;text-decoration:line-through}.learn-alert.diff-added{box-shadow:inset 4px 0 #79aa89}.learn-alert.diff-removed{box-shadow:inset 4px 0 #c88680}.learn-alert.diff-changed{box-shadow:inset 4px 0 #9a927f}@media(max-width:760px){.rendered-table{overflow-x:auto}.rendered-table table{min-width:560px}.rendered-table th,.rendered-table td{padding:10px 12px}.learn-alert{padding:17px 18px}}
`;

const JS = `
document.querySelectorAll('[data-diff-tab]').forEach(button=>button.addEventListener('click',()=>{const root=button.closest('[data-diff]');root.querySelectorAll('[data-diff-tab]').forEach(item=>item.classList.toggle('active',item===button));root.querySelectorAll('[data-diff-panel]').forEach(panel=>panel.hidden=panel.dataset.diffPanel!==button.dataset.diffTab)}));
const localDateTimeFormatter=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const localDayFormatter=new Intl.DateTimeFormat(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
function localizeDates(){document.querySelectorAll('[data-local-datetime]').forEach(item=>{const value=new Date(item.dateTime);if(!Number.isNaN(value.getTime()))item.textContent=localDateTimeFormatter.format(value)});document.querySelectorAll('[data-local-day]').forEach(item=>{const value=new Date(item.dateTime);if(!Number.isNaN(value.getTime()))item.textContent=localDayFormatter.format(value)})}
function updateRelativeTimes(){const now=Date.now();document.querySelectorAll('[data-relative-time]').forEach(item=>{const value=new Date(item.dataset.relativeTime).getTime();if(Number.isNaN(value))return;const difference=value-now;const hours=Math.abs(difference)/3600000;const amount=hours<10?Math.max(.1,Math.round(hours*10)/10):Math.round(hours);const label=amount===1?'hour':'hours';item.textContent=difference<0?amount+' '+label+' ago':'in '+amount+' '+label})}
localizeDates();updateRelativeTimes();setInterval(updateRelativeTimes,60000);
`;

class StaticSiteGenerator {
  constructor(options = {}) {
    this.websiteDir = path.resolve(options.websiteDir || 'website');
    this.mcDataPath = path.resolve(options.mcDataPath || process.env.MC_DATA_PATH || path.join(process.cwd(), '../mc/@data'));
    this.siteAssetDir = path.resolve(options.siteAssetDir || path.join(process.cwd(), 'assets/site'));
    this.detailDays = Number(options.detailDays || process.env.STATIC_SITE_DETAIL_DAYS || 45);
    const generatedAt = moment.utc(options.generatedAt);
    this.generatedAt = (generatedAt.isValid() ? generatedAt : moment.utc()).toISOString();
    this.nextRefreshAt = nextRefreshAfter(this.generatedAt);
    this.generatedUrls = new Set(['/']);
  }

  async write(relativePath, content) {
    const target = path.join(this.websiteDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
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
          summary: meta.description,
          product,
          topic,
          changeType: change.changeType,
          url: `/changes/${report.date}/${slug}/`,
          legacyUrl: `/${report.date}.html`,
          publicUrl: change.publicDocsUrl || null,
          filename: change.filename,
          patch: change.patch || '',
          additions: change.additions || 0,
          deletions: change.deletions || 0,
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
      if (!message || !message.Id || !isEntraMessage(message)) return;
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
      const summary = truncate(stripHtml(summaryDetail || body) || 'A Microsoft 365 Message Center announcement relevant to Microsoft Entra administrators.', 280);
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
        endDate: message.EndDateTime
      };
    });
  }

  head(title, description, canonical, active = '') {
    const safeTitle = title === SITE.name ? title : `${title} — ${SITE.name}`;
    const safeDescription = escapeHtml(description || SITE.description);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title><meta name="description" content="${safeDescription}"><link rel="canonical" href="${SITE.url}${canonical}"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="stylesheet" href="/assets/site.css"><link rel="alternate" type="application/rss+xml" title="${SITE.name}" href="/rss.xml"><meta property="og:site_name" content="${SITE.name}"><meta property="og:title" content="${escapeHtml(safeTitle)}"><meta property="og:description" content="${safeDescription}"><meta property="og:url" content="${SITE.url}${canonical}"><meta property="og:type" content="article"><meta property="og:image" content="${SITE.url}/og-image.png"><meta property="og:image:secure_url" content="${SITE.url}/og-image.png"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Entra.News Daily — Microsoft Entra change intelligence"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(safeTitle)}"><meta name="twitter:description" content="${safeDescription}"><meta name="twitter:image" content="${SITE.url}/og-image.png"><meta name="twitter:image:alt" content="Entra.News Daily — Microsoft Entra change intelligence"></head><body>${this.header(active)}`;
  }

  header(active = '') {
    const nav = [['day','Day','/day/'],['week','Week','/'],['month','Month','/month/'],['products','Products','/products/'],['topics','Topics','/topics/'],['message-center','Message Center','/message-center/']];
    return `<header class="site-header"><a class="brand" href="/">Entra.News Daily<small>${SITE.host}</small></a><nav class="main-nav" aria-label="Primary">${nav.map(([key,label,url])=>`<a href="${url}"${active===key?' aria-current="page"':''}>${label}</a>`).join('')}</nav><div class="utility"><a class="site-link" href="/about/"${active==='about'?' aria-current="page"':''}>About</a><a class="site-link" href="https://merill.net" target="_blank" rel="noopener noreferrer">merill.net</a><a class="icon-link" href="https://entra.news" target="_blank" rel="noopener noreferrer" title="Subscribe to Entra.News" aria-label="Subscribe to the Entra.News newsletter"><img src="/assets/ui/newspaper.svg" alt=""></a><a class="icon-link" href="https://entra.chat" target="_blank" rel="noopener noreferrer" title="Listen to Entra.Chat" aria-label="Listen to the Entra.Chat podcast"><img src="/assets/ui/microphone.svg" alt=""></a></div></header>`;
  }

  footer() {
    const generatedLabel = moment.utc(this.generatedAt).format('D MMM YYYY, HH:mm [UTC]');
    const nextLabel = moment.utc(this.nextRefreshAt).format('D MMM YYYY, HH:mm [UTC]');
    const footer = `<footer class="footer" id="site-footer"><div class="footer-inner"><section class="footer-feature"><div class="eyebrow">Featured project</div><h2><a href="https://maester.cloud">Maester Cloud</a></h2><p>Turn Maester results into a continuous view of your Microsoft 365 security posture, with history, drift tracking, and evidence that is ready when your team needs it.</p><a class="footer-cta" href="https://maester.cloud">Explore Maester Cloud →</a></section><section class="footer-projects"><h2 class="footer-section-title">More community projects</h2><ul class="footer-project-list"><li><a href="https://maester.dev">Maester</a></li><li><a href="https://graphpermissions.merill.net">Graph Permissions Explorer</a></li><li><a href="https://cmd.ms">cmd.ms</a></li><li><a href="https://mc.merill.net">M365 Message Center Archive</a></li><li><a href="https://getyako.com">Yako</a></li></ul></section><section class="footer-support"><h2 class="footer-section-title">Support free community tools</h2><p>Found these free tools useful? Shout me a cup of coffee—or more—on GitHub Sponsors. It helps keep the projects open, useful, and moving.</p><div class="footer-support-links"><a href="https://github.com/sponsors/merill">Sponsor Merill on GitHub →</a></div></section></div><div class="footer-bottom"><div><div>Independent change tracking for Microsoft Entra administrators.</div><div class="refresh-status"><span>Last refreshed <time datetime="${this.generatedAt}" data-local-datetime>${generatedLabel}</time> <span class="refresh-relative" data-relative-time="${this.generatedAt}">recently</span></span><span>Next refresh <time datetime="${this.nextRefreshAt}" data-local-datetime>${nextLabel}</time> <span class="refresh-relative" data-relative-time="${this.nextRefreshAt}">within 24 hours</span></span></div></div><nav aria-label="Footer"><a href="/about/">About</a><a href="https://merill.net">merill.net</a><a href="https://entra.news">Entra.News weekly</a><a href="https://entra.chat">Entra.Chat podcast</a></nav></div></footer><script src="/assets/site.js"></script></body></html>`;
    return footer.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
  }

  productRail() {
    return `<aside class="left-rail"><h2 class="rail-heading">Products</h2><ul class="product-list">${PRODUCTS.slice(0,10).map(product=>`<li><a href="/products/${product.slug}/"><img src="/assets/products/${product.icon}" alt="">${escapeHtml(product.short)}</a></li>`).join('')}</ul><hr class="rail-rule"><div class="topic-rail"><h2 class="rail-heading">Topics</h2><ul class="plain-list">${TOPICS.slice(0,8).map(topic=>`<li><a href="/topics/${topic.slug}/">${escapeHtml(topic.name)}</a></li>`).join('')}</ul></div></aside>`;
  }

  periodRail(items, type = 'week') {
    this.periodRailCache ||= {};
    if (this.periodRailCache[type]) return this.periodRailCache[type];
    const periods = [...new Set(items.map(item => type === 'month' ? item.date.slice(0,7) : mondayOf(item.date)))].sort().reverse().slice(0,6);
    this.periodRailCache[type] = `<aside class="right-rail"><h2 class="rail-heading">Recent ${type === 'month' ? 'months' : 'weeks'}</h2><div class="archive-links">${periods.map(period=>`<a href="/${type}/${period}/">${type==='month'?moment(`${period}-01`).format('MMMM YYYY'):`Week of ${moment(period).format('D MMMM YYYY')}`}</a>`).join('')}</div><hr class="rail-rule"><div class="rss-box"><img src="/assets/ui/envelope-open.svg" alt=""><a href="https://entra.news">Subscribe to Entra.News</a></div></aside>`;
    return this.periodRailCache[type];
  }

  messageCenterMeta(item) {
    if (item.source !== 'mc') return '';
    const details = [item.changeType, humanizeLabel(item.category)].filter(value => value && value !== 'Message');
    return `<div class="story-source"><span class="mc-label">Message Center</span><a href="${item.originalUrl}">${escapeHtml(item.id)} on mc.merill.net ↗</a>${details.map(value=>`<span>${escapeHtml(value)}</span>`).join('')}</div>`;
  }

  changePill(item) {
    const label = item.source === 'mc' ? 'New' : (item.changeType || 'Updated');
    const style = ['New','Updated','Removed'].includes(label) ? label.toLowerCase() : 'updated';
    return `<span class="change-pill ${style}">${escapeHtml(label)}</span>`;
  }

  groupedItems(items, options = {}) {
    const showDate = Boolean(options.showDate);
    const productGroups = PRODUCTS.map(product => ({ product, items: items.filter(item => item.product.slug === product.slug) })).filter(group => group.items.length);
    return `<section class="product-groups">${productGroups.map(({product,items:productItems})=>{
      const topicGroups = TOPICS.map(topic => ({ topic, items: productItems.filter(item => item.topic.slug === topic.slug) })).filter(group => group.items.length).sort((a,b)=>b.items.length-a.items.length||a.topic.name.localeCompare(b.topic.name));
      return `<section class="product-update-group" id="product-${product.slug}"><header class="product-group-header"><img src="/assets/products/${product.icon}" alt=""><div><h2><a href="/products/${product.slug}/">${escapeHtml(product.name)}</a></h2><span class="product-group-count">${productItems.length} update${productItems.length===1?'':'s'}</span></div></header>${topicGroups.map(({topic,items:topicItems})=>`<section class="topic-update-group"><header class="topic-group-header"><h3><a href="/topics/${topic.slug}/">${escapeHtml(topic.name)}</a></h3><span class="topic-group-count">${topicItems.length}</span></header>${[...topicItems].sort((a,b)=>b.date.localeCompare(a.date)||impactScore(b)-impactScore(a)||a.title.localeCompare(b.title)).map(item=>{const support=[showDate?`<span>${moment(item.date).format('D MMMM YYYY')}</span>`:'',this.messageCenterMeta(item)].filter(Boolean).join('');return `<article class="grouped-story"><div class="grouped-story-head"><h4><a href="${item.url}">${escapeHtml(item.title)}</a></h4>${this.changePill(item)}</div>${support?`<div class="story-support">${support}</div>`:''}</article>`}).join('')}</section>`).join('')}</section>`;
    }).join('')}</section>`;
  }

  periodProductRail(items, periodItems, label) {
    const productCounts = PRODUCTS.map(product=>({product,count:periodItems.filter(item=>item.product.slug===product.slug).length})).filter(entry=>entry.count).sort((a,b)=>b.count-a.count||a.product.short.localeCompare(b.product.short));
    const periods = [...new Set(items.map(item=>mondayOf(item.date)))].sort().reverse().slice(0,6);
    return `<aside class="right-rail month-stats-rail period-product-rail"><h2 class="rail-heading">${escapeHtml(label)} by product</h2>${productCounts.length?`<ul class="rail-count-list">${productCounts.map(({product,count})=>`<li><a href="#product-${product.slug}"><img src="/assets/products/${product.icon}" alt="">${escapeHtml(product.short)}</a><span class="rail-count">${count}</span></li>`).join('')}</ul>`:'<p class="quiet">No product updates.</p>'}<hr class="rail-rule"><h2 class="rail-heading">Recent weeks</h2><div class="archive-links">${periods.map(period=>`<a href="/week/${period}/">Week of ${moment(period).format('D MMMM YYYY')}</a>`).join('')}</div><hr class="rail-rule"><div class="rss-box"><img src="/assets/ui/envelope-open.svg" alt=""><a href="https://entra.news">Subscribe to Entra.News</a></div></aside>`;
  }

  monthStatsRail(items, first, productCounts, topicCounts) {
    const periods = [...new Set(items.map(item=>item.date.slice(0,7)))].sort().reverse().slice(0,6);
    return `<aside class="right-rail month-stats-rail"><h2 class="rail-heading">${first.format('MMMM')} by product</h2><ul class="rail-count-list">${productCounts.map(({product,count})=>`<li><a href="#product-${product.slug}"><img src="/assets/products/${product.icon}" alt="">${escapeHtml(product.short)}</a><span class="rail-count">${count}</span></li>`).join('')}</ul><hr class="rail-rule"><h2 class="rail-heading">By topic</h2><ul class="rail-count-list">${topicCounts.map(({topic,count})=>`<li><a href="/topics/${topic.slug}/">${escapeHtml(topic.name)}</a><span class="rail-count">${count}</span></li>`).join('')}</ul><hr class="rail-rule"><h2 class="rail-heading">Recent months</h2><div class="archive-links">${periods.map(period=>`<a href="/month/${period}/">${moment(`${period}-01`).format('MMMM YYYY')}</a>`).join('')}</div><hr class="rail-rule"><div class="rss-box"><img src="/assets/ui/envelope-open.svg" alt=""><a href="https://entra.news">Subscribe to Entra.News</a></div></aside>`;
  }

  itemRows(items) {
    const byDate = new Map();
    items.forEach(item => { if (!byDate.has(item.date)) byDate.set(item.date, []); byDate.get(item.date).push(item); });
    return [...byDate.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([date, dayItems])=>`<section class="date-group"><h3 class="date-label">${moment(date).format('D MMMM YYYY')}</h3>${dayItems.sort((a,b)=>impactScore(b)-impactScore(a)||a.title.localeCompare(b.title)).map(item=>`<article class="story-row"><h3><a href="${item.url}">${escapeHtml(item.title)}</a></h3>${this.messageCenterMeta(item)}<div class="taxonomy">${escapeHtml(item.product.name)} &nbsp;›&nbsp; ${escapeHtml(item.topic.name)}</div></article>`).join('')}</section>`).join('');
  }

  renderWeek(items, weekStart) {
    const weekEnd = moment(weekStart).add(6,'days').format('YYYY-MM-DD');
    const weekItems = items.filter(item => item.date >= weekStart && item.date <= weekEnd).sort((a,b)=>b.date.localeCompare(a.date));
    const feature = [...weekItems].sort((a,b)=>impactScore(b)-impactScore(a)||b.date.localeCompare(a.date))[0];
    const previousWeek = moment(weekStart).subtract(7,'days').format('YYYY-MM-DD');
    const nextWeek = moment(weekStart).add(7,'days').format('YYYY-MM-DD');
    const previousLink = items.some(item => mondayOf(item.date) === previousWeek) ? `<a href="/week/${previousWeek}/">← Previous week</a>` : '<span></span>';
    const nextLink = items.some(item => mondayOf(item.date) === nextWeek) ? `<a href="/week/${nextWeek}/">Next week →</a>` : '<span></span>';
    return `${this.head(`Week of ${moment(weekStart).format('D MMMM YYYY')}`, `Microsoft Entra changes for the week of ${moment(weekStart).format('D MMMM YYYY')}.`, `/week/${weekStart}/`, 'week')}<div class="page-shell">${this.productRail()}<main class="content"><div class="period-nav">${previousLink}<h1>Week of ${moment(weekStart).format('D MMMM YYYY')}</h1>${nextLink}</div>${feature?`<article class="feature"><div class="eyebrow">${moment(feature.date).format('D MMMM YYYY')}</div><div class="grouped-story-head"><h2>${escapeHtml(feature.title)}</h2>${this.changePill(feature)}</div>${this.messageCenterMeta(feature)}<div class="taxonomy">${escapeHtml(feature.product.name)} &nbsp;›&nbsp; ${escapeHtml(feature.topic.name)}</div><p>${escapeHtml(feature.summary)}</p><a href="${feature.url}">Read full update →</a></article>`:''}<section class="story-list"><h2 class="section-title">Updates this week</h2>${weekItems.length?this.groupedItems(weekItems,{showDate:true}):'<div class="empty"><h2>No tracked updates</h2><p>There are no documentation or Message Center changes recorded for this week.</p></div>'}</section></main>${this.periodProductRail(items,weekItems,'Week')}</div>${this.footer()}`;
  }

  renderDay(items, date) {
    const dayItems = items.filter(item => item.date === date);
    const storedOverview = dayItems.find(item => item.dailyOverview)?.dailyOverview || '';
    const messageCenterItems = dayItems.filter(item => item.source === 'mc').sort((a,b)=>impactScore(b)-impactScore(a));
    const fallbackOverview = dayItems.length ? `${dayItems.length} changes were tracked across ${new Set(dayItems.map(item => item.product.slug)).size} Microsoft Entra products. The leading updates include ${[...dayItems].sort((a,b)=>impactScore(b)-impactScore(a)).slice(0,3).map(item => item.title).join('; ')}.` : '';
    const messageCenterOverview = storedOverview && messageCenterItems.length ? `${messageCenterItems.length} Message Center announcement${messageCenterItems.length===1?' was':'s were'} also published, including ${messageCenterItems.slice(0,2).map(item=>item.title).join('; ')}.` : '';
    const dailyOverview = [storedOverview || fallbackOverview, messageCenterOverview].filter(Boolean).join(' ');
    const earliest = items[items.length - 1]?.date || date;
    const latest = items[0]?.date || date;
    const previousDate = moment(date).subtract(1,'day').format('YYYY-MM-DD');
    const nextDate = moment(date).add(1,'day').format('YYYY-MM-DD');
    const previousLink = previousDate >= earliest ? `<a href="/day/${previousDate}/">← Previous day</a>` : '<span></span>';
    const nextLink = nextDate <= latest ? `<a href="/day/${nextDate}/">Next day →</a>` : '<span></span>';
    const localDateTime = dateAtRefresh(date);
    return `${this.head(moment(date).format('D MMMM YYYY'), `Microsoft Entra changes published on ${moment(date).format('D MMMM YYYY')}.`, `/day/${date}/`, 'day')}<div class="page-shell">${this.productRail()}<main class="content"><div class="period-nav">${previousLink}<h1><time datetime="${localDateTime}" data-local-day>${moment(date).format('dddd, D MMMM YYYY')}</time></h1>${nextLink}</div>${dailyOverview?`<article class="feature"><div class="eyebrow">Plain-English daily brief</div><h2>What changed today</h2><p>${escapeHtml(dailyOverview)}</p></article>`:''}<section class="story-list"><h2 class="section-title">${dayItems.length} update${dayItems.length===1?'':'s'}</h2>${dayItems.length?this.groupedItems(dayItems):'<div class="empty"><h2>No tracked updates</h2><p>Try the previous day or browse the weekly archive.</p></div>'}</section></main>${this.periodProductRail(items,dayItems,'Day')}</div>${this.footer()}`;
  }

  renderMonth(items, month) {
    const first = moment(`${month}-01`), start = first.clone().startOf('month').startOf('week').add(1,'day');
    if (start.date() > 1) start.subtract(7,'days');
    const cells=[]; for(let i=0;i<42;i++) cells.push(start.clone().add(i,'days'));
    const monthItems=items.filter(item=>item.date.startsWith(month));
    const earliestDate=items[items.length-1]?.date||first.format('YYYY-MM-DD'), latestDate=items[0]?.date||first.format('YYYY-MM-DD');
    const calendar = cells.map(day=>{const date=day.format('YYYY-MM-DD');const found=items.filter(item=>item.date===date);const products=[...new Map(found.map(item=>[item.product.slug,item.product])).values()].slice(0,3);const tag=date>=earliestDate&&date<=latestDate?'a':'div';const href=tag==='a'?` href="/day/${date}/"`:'';const count=found.length?`<span class="calendar-count" aria-label="${found.length} update${found.length===1?'':'s'}" title="${found.length} update${found.length===1?'':'s'}">${found.length}</span>`:'';return `<${tag} class="calendar-day${date===monthItems[0]?.date?' selected':''}"${href}><span class="calendar-date-row"><strong>${day.date()}</strong>${count}</span><span class="day-icons">${products.map(p=>`<img src="/assets/products/${p.icon}" alt="${escapeHtml(p.short)}">`).join('')}</span></${tag}>`}).join('');
    const productCounts=PRODUCTS.map(product=>({product,count:monthItems.filter(item=>item.product.slug===product.slug).length})).filter(x=>x.count).sort((a,b)=>b.count-a.count);
    const topicCounts=TOPICS.map(topic=>({topic,count:monthItems.filter(item=>item.topic.slug===topic.slug).length})).filter(x=>x.count).sort((a,b)=>b.count-a.count);
    const joinNames=values=>values.length<2?(values[0]||''):values.length===2?`${values[0]} and ${values[1]}`:`${values.slice(0,-1).join(', ')}, and ${values.at(-1)}`;
    const documentationCount=monthItems.filter(item=>item.source==='docs').length, messageCenterCount=monthItems.filter(item=>item.source==='mc').length;
    const sourceSummary=[documentationCount?`${documentationCount} documentation update${documentationCount===1?'':'s'}`:'',messageCenterCount?`${messageCenterCount} Message Center announcement${messageCenterCount===1?'':'s'}`:''].filter(Boolean);
    const themeNames=topicCounts.slice(0,3).map(({topic})=>topic.name), productNames=productCounts.slice(0,2).map(({product})=>product.short);
    const monthNarrative=monthItems.length?`${joinNames(sourceSummary)} were tracked during ${first.format('MMMM')}. Activity centred on ${joinNames(themeNames)}, with the most changes affecting ${joinNames(productNames)}.`:`No tracked Microsoft Entra changes were recorded during ${first.format('MMMM')}.`;
    const monthOverview=`<section class="month-overview compact"><div><div class="eyebrow">Month in brief</div><h2>What changed in ${first.format('MMMM')}</h2><p>${escapeHtml(monthNarrative)}</p></div></section>`;
    const previousMonth=first.clone().subtract(1,'month').format('YYYY-MM'), nextMonth=first.clone().add(1,'month').format('YYYY-MM');
    const previousLink=previousMonth>=earliestDate.slice(0,7)?`<a href="/month/${previousMonth}/">← Previous month</a>`:'<span></span>';
    const nextLink=nextMonth<=latestDate.slice(0,7)?`<a href="/month/${nextMonth}/">Next month →</a>`:'<span></span>';
    return `${this.head(first.format('MMMM YYYY'), `Microsoft Entra changes during ${first.format('MMMM YYYY')}.`, `/month/${month}/`, 'month')}<div class="page-shell">${this.productRail()}<main class="content"><div class="period-nav">${previousLink}<h1>${first.format('MMMM YYYY')}</h1>${nextLink}</div><div class="calendar">${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=>`<div class="calendar-head"><span class="weekday-long">${day}</span><span class="weekday-short">${day.slice(0,3)}</span></div>`).join('')}${calendar}</div>${monthOverview}<section class="story-list"><h2 class="section-title">${monthItems.length} updates by product</h2>${monthItems.length?this.groupedItems(monthItems,{showDate:true}):'<div class="empty"><h2>No tracked updates</h2><p>There are no documentation or Message Center changes recorded for this month.</p></div>'}</section></main>${this.monthStatsRail(items,first,productCounts,topicCounts)}</div>${this.footer()}`;
  }

  renderCollection(items, collection, kind) {
    const isProduct=kind==='product'; const filtered=items.filter(item=>(isProduct?item.product.slug:item.topic.slug)===collection.slug).sort((a,b)=>b.date.localeCompare(a.date));
    const title=isProduct?collection.name:collection.name; const icon=isProduct?`<img src="/assets/products/${collection.icon}" alt="">`:'';
    return `${this.head(title, `Recent Microsoft Entra updates for ${title}.`, `/${isProduct?'products':'topics'}/${collection.slug}/`, isProduct?'products':'topics')}<div class="detail-layout"><main class="detail-main"><section class="hero-product">${icon}<div><div class="eyebrow">${isProduct?'Product':'Cross-product topic'}</div><h1>${escapeHtml(title)}</h1><p>${isProduct?`Track documentation and Message Center changes for ${escapeHtml(title)}.`:`A cross-product view of Microsoft Entra changes related to ${escapeHtml(title)}.`}</p>${isProduct?`<a href="${collection.learn}">Microsoft Learn documentation ↗</a>`:''}</div></section><section class="article-list"><h2 class="section-title" style="margin-top:28px">Latest ${escapeHtml(title)} changes</h2>${filtered.slice(0,120).map(item=>`<article><time class="eyebrow">${moment(item.date).format('D MMMM YYYY')}</time><div><h2><a href="${item.url}">${escapeHtml(item.title)}</a></h2>${this.messageCenterMeta(item)}<div class="taxonomy">${escapeHtml(item.topic.name)}</div><p>${escapeHtml(item.summary)}</p></div></article>`).join('')||'<div class="empty">No changes currently classified here.</div>'}</section></main><aside class="detail-aside"><h2 class="rail-heading">Browse ${isProduct?'products':'topics'}</h2><ul class="plain-list">${(isProduct?PRODUCTS:TOPICS).map(item=>`<li><a href="/${isProduct?'products':'topics'}/${item.slug}/">${escapeHtml(item.name)}</a></li>`).join('')}</ul></aside></div>${this.footer()}`;
  }

  renderDirectory(items, kind) {
    const isProduct=kind==='product', collections=isProduct?PRODUCTS:TOPICS;
    return `${this.head(isProduct?'Products':'Topics',`Browse Microsoft Entra updates by ${isProduct?'product':'topic'}.`,`/${isProduct?'products':'topics'}/`,isProduct?'products':'topics')}<div class="page-shell">${this.productRail()}<main class="content"><div class="eyebrow">Browse the archive</div><h1 class="page-title">${isProduct?'Microsoft Entra products':'Topics across products'}</h1><p class="lede">${isProduct?'Follow changes within a product, from Entra ID through Global Secure Access and Verified ID.':'Use topics for work that crosses product boundaries, including architecture, standards, authentication, and troubleshooting.'}</p><section class="article-list">${collections.map(collection=>{const count=items.filter(item=>(isProduct?item.product.slug:item.topic.slug)===collection.slug).length;return `<article><div>${isProduct?`<img src="/assets/products/${collection.icon}" alt="" style="width:44px;height:44px">`:''}</div><div><h2><a href="/${isProduct?'products':'topics'}/${collection.slug}/">${escapeHtml(collection.name)}</a></h2><p>${count} tracked update${count===1?'':'s'}</p></div></article>`}).join('')}</section></main>${this.periodRail(items,'month')}</div>${this.footer()}`;
  }

  renderAbout() {
    return `${this.head('About','Why Entra.News Daily was built for the Microsoft Entra community.','/about/','about')}
      <div class="about-layout"><main class="about-main">
        <section class="about-hero"><div class="about-kicker"><img src="/assets/products/entra-family.svg" alt=""><div class="eyebrow">About Entra.News Daily</div></div><h1>Built for the die-hard Microsoft Entra community.</h1><p class="lede">This site is dedicated to the people who want to know what changed in Microsoft Entra—not just what the documentation says today. It is built by <a href="https://merill.net">Merill Fernando</a> for Entra admins, architects, developers, and fellow identity enthusiasts.</p></section>
        <div class="about-pair"><section class="about-section"><h2>Why it exists</h2><p>Microsoft Entra moves quickly. Documentation pages, guidance, previews, and service announcements change every day, but those changes can be difficult to spot once a page has been updated.</p><p>Entra.News Daily keeps a readable record of those changes so you can catch up by day, week, month, product, or topic—and then open the source material when something matters to you.</p></section><section class="about-section"><h2>How it works</h2><p>A scheduled workflow watches the public Microsoft Entra documentation, records additions and updates, and brings in relevant Microsoft 365 Message Center announcements.</p><p>Plain-English summaries make the daily changes easier to scan. Every documentation item keeps the formatted change and raw Markdown diff available, so the source evidence is always close at hand.</p></section></div>
        <section class="about-section" id="stay-current"><h2>Stay current with Microsoft Entra</h2><div class="update-paths"><div class="update-path"><div class="eyebrow">The weekly update</div><h3>Subscribe to Entra.News</h3><p><a href="https://entra.news">Entra.News</a> is the weekly briefing for Microsoft Entra. Subscribe to get the important changes, new guidance, and admin takeaways delivered in one readable update each week.</p><a class="update-link" href="https://entra.news">Subscribe to Entra.News</a></div><div class="update-path"><div class="eyebrow">Daily news and conversation</div><h3>Bookmark Daily and join Discord</h3><p>Bookmark <a href="https://daily.entra.news">daily.entra.news</a> for the day-by-day record. Then join the <a href="https://discord.entra.news">Entra Discord community</a>, where these updates are posted daily and the community hangs out to discuss the latest Entra updates and news.</p><a class="update-link" href="https://discord.entra.news">Join the Entra Discord community</a></div></div></section>
        <section class="about-section"><h2>Made for the community</h2><p>This is an independent community project, not a Microsoft product or service. It is built in the open for people who care deeply about identity and want a calmer way to keep up with constant change.</p><p>If something is missing, incorrectly classified, or could be explained more clearly, please <a href="https://github.com/merill/entra-doc-diff/issues">open an issue on GitHub</a>. Contributions and thoughtful feedback are always welcome.</p></section>
        <blockquote class="community-note"><p>For the Entra fans who read release notes for fun, notice the small changes, and help everyone else understand why they matter.</p></blockquote>
      </main><aside class="about-aside"><h2 class="rail-heading">Built by Merill</h2><p><a href="https://merill.net">Merill Fernando</a> builds tools and writes about Microsoft Entra and Microsoft 365 for the admin and identity community.</p><hr class="rail-rule"><h2 class="rail-heading">Stay current</h2><ul class="plain-list stay-current"><li><a href="https://entra.news">Subscribe to the weekly update</a></li><li><a href="https://daily.entra.news">Bookmark daily.entra.news</a></li><li><a href="https://discord.entra.news">Join the Entra Discord</a></li></ul><hr class="rail-rule"><h2 class="rail-heading">Explore</h2><ul class="plain-list"><li><a href="/day/">Latest day</a></li><li><a href="/">Current week</a></li><li><a href="/month/">Month archive</a></li><li><a href="/products/">Browse products</a></li><li><a href="/topics/">Browse topics</a></li><li><a href="/message-center/">Message Center</a></li></ul><hr class="rail-rule"><h2 class="rail-heading">Follow the project</h2><ul class="plain-list"><li><a href="https://github.com/merill/entra-doc-diff">Source on GitHub</a></li><li><a href="https://entra.chat">Entra.Chat podcast</a></li></ul></aside></div>${this.footer()}`;
  }

  relatedHtml(item, allItems) {
    const candidates = [...new Map([
      ...(this.relatedByProduct?.get(item.product.slug) || []).slice(0,300),
      ...(this.relatedByTopic?.get(item.topic.slug) || []).slice(0,300)
    ].map(candidate => [candidate.id, candidate])).values()];
    return selectRelatedItems(item, candidates).map(related=>`<div class="related-item"><div class="related-meta">${moment(related.date).format('D MMMM YYYY')}${related.source==='mc'?` · <a href="${related.originalUrl}">${escapeHtml(related.id)} ↗</a>`:''}</div><a href="${related.url}">${escapeHtml(related.title)}</a></div>`).join('') || '<p class="quiet">No closely related tracked changes.</p>';
  }

  renderDocDetail(item, allItems) {
    return `${this.head(item.title,item.summary,item.url,'')}<div class="detail-layout"><main class="detail-main"><nav class="breadcrumbs"><a href="/week/${mondayOf(item.date)}/">Week of ${moment(mondayOf(item.date)).format('D MMMM YYYY')}</a> &nbsp;/&nbsp; <a href="/products/${item.product.slug}/">${escapeHtml(item.product.short)}</a> &nbsp;/&nbsp; <a href="/topics/${item.topic.slug}/">${escapeHtml(item.topic.name)}</a></nav><div class="product-kicker"><img src="/assets/products/${item.product.icon}" alt="">${escapeHtml(item.product.name)}</div><h1>${escapeHtml(item.title)}</h1><div class="article-meta"><span>${moment(item.date).format('D MMMM YYYY')}</span><span>${escapeHtml(item.changeType)}</span><span>+${item.additions} / −${item.deletions} lines</span></div><section class="summary-grid single"><div><h2 class="section-title">In brief</h2><p>${escapeHtml(item.summary)}</p></div></section><section class="doc-change" data-diff><h2 class="section-title">Documentation change</h2><div class="diff-tabs"><button class="active" data-diff-tab="formatted">Formatted</button><button data-diff-tab="raw">Raw Markdown</button></div><div class="diff-panel" data-diff-panel="formatted">${formattedDiff(item.patch)}</div><div class="diff-panel" data-diff-panel="raw" hidden><pre class="raw-diff">${escapeHtml(item.patch)}</pre></div></section></main><aside class="detail-aside">${item.publicUrl?`<a class="aside-link" href="${item.publicUrl}"><img src="/assets/ui/book-bookmark.svg" alt="">Open on Microsoft Learn ↗</a>`:''}<a class="aside-link" href="${item.legacyUrl}"><img src="/assets/ui/chart-history.svg" alt="">View daily source report</a><hr class="rail-rule"><h2 class="section-title">Related changes</h2>${this.relatedHtml(item,allItems)}<hr class="rail-rule"><div class="rss-box"><img src="/assets/ui/envelope-open.svg" alt=""><a href="https://entra.news">Subscribe to Entra.News</a></div></aside></div>${this.footer()}`;
  }

  renderMcDetail(item, allItems) {
    return `${this.head(item.title,item.summary,item.url,'message-center')}<div class="detail-layout"><main class="detail-main"><nav class="breadcrumbs"><a href="/message-center/">Message Center</a> &nbsp;/&nbsp; <a href="/products/${item.product.slug}/">${escapeHtml(item.product.short)}</a></nav><div class="product-kicker"><img src="/assets/products/${item.product.icon}" alt="">${escapeHtml(item.product.name)}</div><h1>${escapeHtml(item.title)}</h1><div class="article-meta"><span>${moment(item.date).format('D MMMM YYYY')}</span><a href="${item.originalUrl}">${escapeHtml(item.id)} on mc.merill.net ↗</a><span>${escapeHtml(item.changeType)}</span></div><section class="summary-grid single"><div><h2 class="section-title">In brief</h2><p>${escapeHtml(item.summary)}</p></div></section><section class="doc-change"><h2 class="section-title">Message Center announcement</h2><div class="mc-body">${item.body}</div></section></main><aside class="detail-aside"><a class="aside-link" href="${item.originalUrl}"><img src="/assets/ui/envelope-open.svg" alt="">Open original Message Center item ↗</a><a class="aside-link" href="/products/${item.product.slug}/"><img src="/assets/ui/book-bookmark.svg" alt="">Browse ${escapeHtml(item.product.short)}</a><hr class="rail-rule"><h2 class="section-title">Related changes</h2>${this.relatedHtml(item,allItems)}<hr class="rail-rule"><div class="rss-box"><img src="/assets/ui/envelope-open.svg" alt=""><a href="https://entra.news">Subscribe to Entra.News</a></div></aside></div>${this.footer()}`;
  }

  async build() {
    for (const directory of ['changes','day','week','month','products','topics','message-center','about']) {
      await fs.rm(path.join(this.websiteDir, directory), { recursive: true, force: true });
    }
    this.generatedUrls = new Set(['/']);
    this.periodRailCache = {};
    await fs.mkdir(path.join(this.websiteDir,'assets'),{recursive:true});
    for (const asset of ['favicon.ico','favicon-16x16.png','favicon-32x32.png','apple-touch-icon.png','og-image.png']) {
      await fs.copyFile(path.join(this.siteAssetDir,asset),path.join(this.websiteDir,asset));
    }
    await fs.mkdir(path.join(this.websiteDir,'assets','ui'),{recursive:true});
    for (const asset of ['newspaper.svg','microphone.svg']) {
      await fs.copyFile(path.join(this.siteAssetDir,'ui',asset),path.join(this.websiteDir,'assets','ui',asset));
    }
    await this.write('assets/site.css',CSS);
    await this.write('assets/site.js',JS);
    const reports=await this.loadReports();
    const docs=this.normalizeDocItems(reports);
    const mc=await this.loadMessageCenterItems();
    const items=[...docs,...mc].sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title));
    const latestDate=items[0]?.date||moment().format('YYYY-MM-DD');
    const latestWeek=mondayOf(latestDate), latestMonth=latestDate.slice(0,7);
    const recentCutoff=moment(latestDate).subtract(this.detailDays,'days');
    docs.filter(item=>moment(item.date).isBefore(recentCutoff)).forEach(item => { item.url = item.legacyUrl; });
    this.relatedByProduct = new Map(PRODUCTS.map(product => [product.slug, items.filter(item => item.product.slug === product.slug)]));
    this.relatedByTopic = new Map(TOPICS.map(topic => [topic.slug, items.filter(item => item.topic.slug === topic.slug)]));
    await this.write('index.html',this.renderWeek(items,latestWeek));
    await this.write('day/index.html',this.renderDay(items,latestDate));
    await this.write('month/index.html',this.renderMonth(items,latestMonth));
    await this.write('products/index.html',this.renderDirectory(items,'product'));
    await this.write('topics/index.html',this.renderDirectory(items,'topic'));
    await this.write('about/index.html',this.renderAbout());
    await this.write('message-center/index.html',`${this.head('Message Center','Microsoft 365 Message Center posts relevant to Microsoft Entra administrators.','/message-center/','message-center')}<div class="page-shell">${this.productRail()}<main class="content"><div class="eyebrow">Microsoft 365 roadmap signals</div><h1 class="page-title">Entra in Message Center</h1><p class="lede">Announcements where the service or title includes Microsoft Entra, presented beside related documentation changes.</p><section class="story-list">${this.itemRows(mc.slice(0,160))}</section></main>${this.periodRail(items,'month')}</div>${this.footer()}`);
    const earliestDate=items[items.length-1]?.date||latestDate;
    for(let day=moment(earliestDate);day.isSameOrBefore(moment(latestDate));day.add(1,'day')) {
      const date=day.format('YYYY-MM-DD');
      await this.write(`day/${date}/index.html`,this.renderDay(items,date));
    }
    for(const week of [...new Set(items.map(item=>mondayOf(item.date)))]) await this.write(`week/${week}/index.html`,this.renderWeek(items,week));
    for(let month=moment(`${earliestDate.slice(0,7)}-01`);month.isSameOrBefore(moment(`${latestMonth}-01`));month.add(1,'month')) {
      const monthKey=month.format('YYYY-MM');
      await this.write(`month/${monthKey}/index.html`,this.renderMonth(items,monthKey));
    }
    for(const product of PRODUCTS) await this.write(`products/${product.slug}/index.html`,this.renderCollection(items,product,'product'));
    for(const topic of TOPICS) await this.write(`topics/${topic.slug}/index.html`,this.renderCollection(items,topic,'topic'));
    for(const item of docs.filter(item=>moment(item.date).isSameOrAfter(recentCutoff))) await this.write(`${item.url.replace(/^\//,'')}index.html`,this.renderDocDetail(item,items));
    for(const item of mc) await this.write(`message-center/${item.id}/index.html`,this.renderMcDetail(item,items));
    const rssItems=items.slice(0,50).map(item=>`<item><title>${escapeHtml(item.title)}</title><link>${SITE.url}${item.url}</link><guid>${SITE.url}${item.url}</guid><pubDate>${moment(item.date).toDate().toUTCString()}</pubDate><description>${escapeHtml(item.summary)}</description></item>`).join('');
    await this.write('rss.xml',`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${SITE.name}</title><link>${SITE.url}</link><description>${SITE.description}</description>${rssItems}</channel></rss>`);
    await this.write('robots.txt',`User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`);
    await this.write('llms.txt',`# ${SITE.name}\n\n${SITE.description}\n\n- [Current week](${SITE.url}/)\n- [Products](${SITE.url}/products/)\n- [Topics](${SITE.url}/topics/)\n- [Message Center](${SITE.url}/message-center/)\n- [About](${SITE.url}/about/)\n- [RSS](${SITE.url}/rss.xml)\n`);
    await this.write('CNAME',`${SITE.host}\n`);
    const sitemap=[...this.generatedUrls].filter(url=>!url.startsWith('/assets/')).map(url=>`<url><loc>${SITE.url}${url}</loc></url>`).join('');
    await this.write('sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemap}</urlset>`);
    console.log(`Generated ${this.generatedUrls.size} static Entra.News Daily URLs with ${docs.length} doc changes and ${mc.length} Message Center posts.`);
    return { docs: docs.length, messageCenter: mc.length, urls: this.generatedUrls.size, latestDate };
  }
}

module.exports = { StaticSiteGenerator, isEntraMessage, classifyProduct, classifyTopic, extractMarkdownMetadata, findRelatedItems, selectRelatedItems, sanitizeMcHtml, slugify, formattedDiff };
