// Product configuration: everything that differs between one Daily.*.News site
// and the next. The generator reads from here rather than from literals, so a
// new product is a config file rather than a fork of the code.
//
// This module is deliberately free of product knowledge. It loads, normalises
// and validates; it never supplies a default that only one product would want.

const path = require('path');

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  throw new Error(`dailynews.config.js: ${message}`);
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function requireRegExp(value, field) {
  if (!(value instanceof RegExp)) fail(`${field} must be a RegExp`);
  return value;
}

function normalizeEntries(entries, field, extra = () => {}) {
  if (!Array.isArray(entries) || !entries.length) fail(`${field} must be a non-empty array`);
  const seen = new Set();
  return entries.map((entry, index) => {
    const where = `${field}[${index}]`;
    const slug = requireString(entry.slug, `${where}.slug`);
    if (!SLUG.test(slug)) fail(`${where}.slug must be lowercase alphanumeric with dashes`);
    if (seen.has(slug)) fail(`${where}.slug '${slug}' is duplicated`);
    seen.add(slug);
    requireString(entry.name, `${where}.name`);
    extra(entry, where);
    return { ...entry, slug };
  });
}

function normalizeRules(rules, field, knownSlugs) {
  if (!Array.isArray(rules)) fail(`${field} must be an array`);
  return rules.map((rule, index) => {
    const where = `${field}[${index}]`;
    const slug = requireString(rule.slug, `${where}.slug`);
    if (!knownSlugs.has(slug)) fail(`${where}.slug '${slug}' is not a declared slug`);
    const scope = rule.scope ?? 'text';
    if (scope !== 'text' && scope !== 'title') fail(`${where}.scope must be 'text' or 'title'`);
    requireRegExp(rule.match, `${where}.match`);
    if (rule.unless !== undefined) requireRegExp(rule.unless, `${where}.unless`);
    return { slug, scope, match: rule.match, unless: rule.unless };
  });
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') fail('must export an object');

  const rawSite = raw.site || {};
  const brand = raw.brand || {};
  const taxonomy = raw.taxonomy || {};
  const classify = raw.classify || {};
  const analytics = raw.analytics || {};

  // Validate identity first: it is what a new product fills in first, so an
  // error here is more use than one about a taxonomy they have not written yet.
  const site = {
    name: requireString(rawSite.name, 'site.name'),
    host: requireString(rawSite.host, 'site.host'),
    url: requireString(rawSite.url, 'site.url'),
    description: requireString(rawSite.description, 'site.description'),
    productName: requireString(rawSite.productName, 'site.productName'),
    audience: requireString(rawSite.audience, 'site.audience')
  };
  if (site.url.endsWith('/')) fail('site.url must not end with a slash');

  // `icon` is optional: a product may name its SVG explicitly, or leave it to be
  // derived from the slug by the icon manifest.
  const products = normalizeEntries(taxonomy.products, 'taxonomy.products', (entry, where) => {
    requireString(entry.short, `${where}.short`);
    if (entry.icon !== undefined) requireString(entry.icon, `${where}.icon`);
  });
  const topics = normalizeEntries(taxonomy.topics, 'taxonomy.topics');

  const productSlugs = new Set(products.map(product => product.slug));
  const topicSlugs = new Set(topics.map(topic => topic.slug));

  const defaultProduct = requireString(taxonomy.defaultProduct, 'taxonomy.defaultProduct');
  if (!productSlugs.has(defaultProduct)) fail(`taxonomy.defaultProduct '${defaultProduct}' is not a declared product`);
  const defaultTopic = requireString(taxonomy.defaultTopic, 'taxonomy.defaultTopic');
  if (!topicSlugs.has(defaultTopic)) fail(`taxonomy.defaultTopic '${defaultTopic}' is not a declared topic`);

  return {
    site,
    brand: {
      wordmark: requireString(brand.wordmark, 'brand.wordmark'),
      ogAlt: requireString(brand.ogAlt, 'brand.ogAlt'),
      themeStorageKey: requireString(brand.themeStorageKey, 'brand.themeStorageKey'),
      tokenStorageKey: requireString(brand.tokenStorageKey, 'brand.tokenStorageKey'),
      emailEyebrow: requireString(brand.emailEyebrow, 'brand.emailEyebrow')
    },
    discord: {
      botName: requireString((raw.discord || {}).botName, 'discord.botName')
    },
    ai: {
      schemaPrefix: requireString((raw.ai || {}).schemaPrefix, 'ai.schemaPrefix'),
      impactBoost: requireRegExp((raw.ai || {}).impactBoost, 'ai.impactBoost')
    },
    analytics: {
      piqoSite: String(analytics.piqoSite || '').trim()
    },
    taxonomy: {
      products,
      topics,
      defaultProduct,
      defaultTopic,
      stopwords: new Set(requireString(taxonomy.stopwords, 'taxonomy.stopwords').split(/\s+/)),
      searchAliases: { ...(taxonomy.searchAliases || {}) }
    },
    classify: {
      products: normalizeRules(classify.products, 'classify.products', productSlugs),
      topics: normalizeRules(classify.topics, 'classify.topics', topicSlugs)
    },
    messageCenter: {
      servicePattern: requireRegExp((raw.messageCenter || {}).servicePattern, 'messageCenter.servicePattern')
    }
  };
}

// First match wins. `scope: 'title'` lets a headline settle a classification that
// the body would otherwise muddy; `unless` is the negative guard for the case
// where a broader product name appears inside a narrower one.
function runRules(rules, entries, defaultSlug, filename, title, body) {
  const scopes = {
    title: String(title).toLowerCase(),
    text: `${filename} ${title} ${body}`.toLowerCase()
  };
  const hit = rules.find(rule => {
    const subject = scopes[rule.scope];
    return rule.match.test(subject) && !(rule.unless && rule.unless.test(subject));
  });
  return entries.find(entry => entry.slug === (hit ? hit.slug : defaultSlug));
}

let current = null;

function setConfig(raw) {
  current = normalize(raw);
  return current;
}

function getConfig() {
  if (current) return current;
  const configPath = process.env.DAILYNEWS_CONFIG || path.join(process.cwd(), 'dailynews.config.js');
  let raw;
  try {
    raw = require(configPath);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(configPath)) {
      throw new Error(
        `No product configuration found at ${configPath}. ` +
        'Create one, set DAILYNEWS_CONFIG, or call setConfig() before loading the generator.'
      );
    }
    throw error;
  }
  return setConfig(raw);
}

function resetConfig() {
  current = null;
}

module.exports = { getConfig, setConfig, resetConfig, normalize, runRules };
