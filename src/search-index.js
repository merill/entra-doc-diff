const fs = require('fs').promises;
const path = require('path');
const moment = require('moment-timezone');
const { StaticSiteGenerator, PRODUCTS, TOPICS } = require('./static-site');
const { getConfig } = require('./config');

const config = getConfig();

const MAX_SOURCE_LENGTH = 12000;

function cleanText(value = '') {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPatch(patch = '') {
  return String(patch)
    .split(/\r?\n/)
    .filter(line => !/^(diff --git |index |--- |\+\+\+ |@@ |new file mode|deleted file mode)/.test(line))
    .map(line => line.replace(/^[+\- ]/, ''))
    .filter(line => !/^\s*(---|title:|description:|ms\.[\w.-]+:)/i.test(line))
    .join('\n');
}

function scalarMeta(value) {
  return value == null ? '' : String(value);
}

function buildUpdateRecord(item) {
  const sourceContent = item.source === 'docs' ? cleanPatch(item.patch) : cleanText(item.body);
  const content = cleanText([
    item.title,
    item.summary,
    item.adminImpact,
    item.product?.name,
    item.topic?.name,
    item.filename,
    sourceContent.slice(0, MAX_SOURCE_LENGTH)
  ].filter(Boolean).join('\n'));
  return {
    url: item.url,
    content,
    language: 'en',
    meta: {
      title: scalarMeta(item.title),
      description: scalarMeta(item.summary),
      date: scalarMeta(item.date),
      product: scalarMeta(item.product?.name),
      productShort: scalarMeta(item.product?.short),
      productSlug: scalarMeta(item.product?.slug),
      productIcon: item.product?.icon ? `/assets/products/${item.product.icon}` : '',
      topic: scalarMeta(item.topic?.name),
      topicSlug: scalarMeta(item.topic?.slug),
      topicIcon: scalarMeta(item.topic?.icon),
      source: scalarMeta(item.source),
      sourceLabel: scalarMeta(item.sourceLabel),
      changeType: scalarMeta(item.changeType),
      changeNature: scalarMeta(item.changeNature),
      recordType: 'update'
    },
    filters: {
      product: [scalarMeta(item.product?.slug)],
      topic: [scalarMeta(item.topic?.slug)],
      source: [scalarMeta(item.source)],
      changeType: [String(item.changeType || 'updated').toLowerCase().replace(/\s+/g, '-')],
      changeNature: [String(item.changeNature || 'unclassified').toLowerCase().replace(/\s+/g, '-')],
      recordType: ['update']
    },
    sort: { date: scalarMeta(item.date) }
  };
}

function periodLabel(type, key) {
  if (type === 'day') return moment(key).format('D MMMM YYYY');
  if (type === 'week') return `Week of ${moment(key).format('D MMMM YYYY')}`;
  return moment(`${key}-01`).format('MMMM YYYY');
}

function briefUrl(type, key) {
  return type === 'month' ? `/month/${key}/` : `/${type}/${key}/`;
}

function buildBriefRecord(type, key, summary = {}) {
  const changes = Array.isArray(summary.keyChanges) ? summary.keyChanges : [];
  const content = cleanText([
    summary.headline,
    summary.overview,
    summary.adminImpact,
    ...changes.flatMap(change => [change.title, change.detail, change.product])
  ].filter(Boolean).join('\n'));
  const typeName = type === 'day' ? 'Daily brief' : type === 'week' ? 'Weekly brief' : 'Monthly brief';
  return {
    url: briefUrl(type, key),
    content,
    language: 'en',
    meta: {
      title: scalarMeta(summary.headline || `${typeName}: ${periodLabel(type, key)}`),
      description: scalarMeta(summary.overview),
      date: type === 'month' ? `${key}-01` : key,
      product: '',
      productShort: '',
      productSlug: '',
      productIcon: '',
      topic: typeName,
      topicSlug: '',
      topicIcon: '',
      source: 'editorial',
      sourceLabel: typeName,
      changeType: typeName,
      recordType: 'brief',
      periodType: type
    },
    filters: {
      source: ['editorial'],
      recordType: ['brief'],
      periodType: [type]
    },
    sort: { date: type === 'month' ? `${key}-01` : key }
  };
}

function groupUpdateRecords(records, maximumItems = 16) {
  const grouped = new Map();
  for (const record of records) {
    const meta = record.meta || {};
    const key = [meta.date, meta.productSlug, meta.topicSlug, meta.source].join('|');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }
  const results = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => a.meta.title.localeCompare(b.meta.title));
    for (let offset = 0; offset < group.length; offset += maximumItems) {
      const chunk = group.slice(offset, offset + maximumItems);
      const first = chunk[0];
      const items = chunk.map(record => ({
        url: record.url,
        title: record.meta.title,
        description: record.meta.description,
        date: record.meta.date,
        product: record.meta.product,
        productShort: record.meta.productShort,
        productSlug: record.meta.productSlug,
        productIcon: record.meta.productIcon,
        topic: record.meta.topic,
        topicSlug: record.meta.topicSlug,
        topicIcon: record.meta.topicIcon,
        source: record.meta.source,
        sourceLabel: record.meta.sourceLabel,
        changeType: record.meta.changeType,
        searchText: record.content.slice(0, 5000)
      }));
      results.push({
        url: `/day/${first.meta.date}/#product-${first.meta.productSlug}`,
        content: chunk.map(record => record.content).join('\n'),
        language: 'en',
        meta: {
          title: `${first.meta.productShort || first.meta.product} updates on ${periodLabel('day', first.meta.date)}`,
          description: `${chunk.length} searchable ${config.site.productName} updates.`,
          date: first.meta.date,
          product: first.meta.product,
          productShort: first.meta.productShort,
          productSlug: first.meta.productSlug,
          productIcon: first.meta.productIcon,
          topic: first.meta.topic,
          topicSlug: first.meta.topicSlug,
          topicIcon: first.meta.topicIcon,
          source: first.meta.source,
          sourceLabel: first.meta.sourceLabel,
          recordType: 'update-group',
          itemCount: String(chunk.length),
          items: JSON.stringify(items)
        },
        filters: {
          product: [first.meta.productSlug],
          topic: [first.meta.topicSlug],
          source: [first.meta.source],
          changeType: [...new Set(chunk.flatMap(record => record.filters.changeType))],
          recordType: ['update']
        },
        sort: { date: first.meta.date }
      });
    }
  }
  return results.sort((a, b) => b.sort.date.localeCompare(a.sort.date) || a.meta.title.localeCompare(b.meta.title));
}

async function loadSearchRecords(options = {}) {
  const generator = new StaticSiteGenerator(options);
  const summaries = await generator.loadPeriodSummaries();
  const reports = await generator.enrichCommitParents(await generator.loadReports());
  const docs = generator.normalizeDocItems(reports);
  const mc = await generator.loadMessageCenterItems();
  const items = [...docs, ...mc].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  const latestDate = items[0]?.date || moment().format('YYYY-MM-DD');
  const recentCutoff = moment(latestDate).subtract(generator.detailDays, 'days');
  docs.filter(item => moment(item.date).isBefore(recentCutoff)).forEach(item => {
    item.url = generator.historicalDocUrl(item);
  });
  const updateRecords = items.map(buildUpdateRecord);
  const records = groupUpdateRecords(updateRecords);
  for (const [collection, type] of [[summaries.days, 'day'], [summaries.weeks, 'week'], [summaries.months, 'month']]) {
    for (const [key, summary] of Object.entries(collection || {})) {
      if (summary?.headline || summary?.overview) records.push(buildBriefRecord(type, key, summary));
    }
  }
  return { records, docs: docs.length, messageCenter: mc.length, updateGroups: records.filter(record => record.meta.recordType === 'update-group').length, summaries };
}

async function buildSearchIndex(options = {}) {
  const websiteDir = path.resolve(options.websiteDir || 'website');
  const outputPath = path.join(websiteDir, 'pagefind');
  const { records, docs, messageCenter, updateGroups } = await loadSearchRecords({ ...options, websiteDir });
  await fs.rm(outputPath, { recursive: true, force: true });
  const pagefind = await import('pagefind');
  const created = await pagefind.createIndex({
    forceLanguage: 'en',
    includeCharacters: '._-',
    keepIndexUrl: false,
    writePlayground: false
  });
  if (!created.index || created.errors.length) throw new Error(`Unable to create Pagefind index: ${created.errors.join('; ')}`);
  const index = created.index;
  try {
    for (let offset = 0; offset < records.length; offset += 75) {
      const responses = await Promise.all(records.slice(offset, offset + 75).map(record => index.addCustomRecord(record)));
      const errors = responses.flatMap(response => response.errors || []);
      if (errors.length) throw new Error(`Unable to add Pagefind records: ${errors.join('; ')}`);
    }
    const written = await index.writeFiles({ outputPath });
    if (written.errors.length) throw new Error(`Unable to write Pagefind index: ${written.errors.join('; ')}`);
  } finally {
    await index.deleteIndex();
    await pagefind.close();
  }
  const manifest = {
    generatedAt: process.env.SITE_GENERATED_AT || new Date().toISOString(),
    records: records.length,
    updates: docs + messageCenter,
    updateGroups,
    documentation: docs,
    messageCenter,
    briefs: records.filter(record => record.meta.recordType === 'brief').length
  };
  await fs.writeFile(path.join(websiteDir, 'search-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Indexed ${manifest.updates} updates in ${manifest.updateGroups} compact groups, plus ${manifest.briefs} editorial briefs.`);
  return manifest;
}

module.exports = { cleanText, cleanPatch, buildUpdateRecord, buildBriefRecord, groupUpdateRecords, loadSearchRecords, buildSearchIndex, PRODUCTS, TOPICS };
