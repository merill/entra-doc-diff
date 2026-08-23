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

function normalizeStrings(values, field) {
  if (!Array.isArray(values) || !values.length) fail(`${field} must be a non-empty array`);
  return values.map((value, index) => requireString(value, `${field}[${index}]`));
}

// An ordered list of path routes. The first `match` that hits wins and its
// captured groups are substituted into that route's template; `field` names the
// template property so a list can read as `path` for a URL and `name` for a
// heading without the code caring which.
function normalizeRoutes(routes, field, where) {
  if (!Array.isArray(routes) || !routes.length) fail(`${where} must be a non-empty array`);
  return routes.map((route, index) => ({
    match: requireRegExp(route.match, `${where}[${index}].match`),
    template: requireString(route[field], `${where}[${index}].${field}`)
  }));
}

// How a path in the documentation repository maps to a public Microsoft Learn
// URL and to the heading a report groups it under. `areas.stripPrefix` is
// optional: a repository whose paths are already Learn paths omits it.
function normalizeDocs(docs) {
  const raw = docs || {};
  const areas = raw.areas || {};
  if (areas.stripPrefix !== undefined && areas.stripPrefix !== null) {
    requireRegExp(areas.stripPrefix, 'docs.areas.stripPrefix');
  }
  return {
    trackedPaths: requireRegExp(raw.trackedPaths, 'docs.trackedPaths'),
    learnRoutes: normalizeRoutes(raw.learnRoutes, 'path', 'docs.learnRoutes'),
    areas: {
      stripPrefix: areas.stripPrefix || null,
      rules: normalizeRoutes(areas.rules, 'name', 'docs.areas.rules'),
      fallback: requireString(areas.fallback, 'docs.areas.fallback')
    }
  };
}

function normalizeLinkList(entries, field) {
  if (!Array.isArray(entries)) fail(`${field} must be an array`);
  return entries.map((entry, index) => ({
    ...entry,
    url: requireString(entry.url, `${field}[${index}].url`),
    label: requireString(entry.label, `${field}[${index}].label`)
  }));
}

// Page prose. Everything the generator writes into a page that names the
// product belongs here, so the markup in src/ stays product-neutral. Sections
// one product runs and another does not are modelled as lists that the second
// product leaves empty, never as flags.
function normalizeCopy(raw) {
  const copy = raw || {};
  const landing = copy.landing || {};
  const directory = copy.directory || {};
  const search = copy.search || {};
  const compare = copy.compare || {};
  const dailyEmail = copy.dailyEmail || {};
  const detail = copy.detail || {};
  const footer = copy.footer || {};
  const about = copy.about || {};
  if (!Array.isArray(about.extraSections)) fail('copy.about.extraSections must be an array');
  return {
    rssFeedLabel: requireString(copy.rssFeedLabel, 'copy.rssFeedLabel'),
    landing: {
      heading: requireString(landing.heading, 'copy.landing.heading'),
      blurb: requireString(landing.blurb, 'copy.landing.blurb')
    },
    directory: {
      productsLede: requireString(directory.productsLede, 'copy.directory.productsLede'),
      topicsLede: requireString(directory.topicsLede, 'copy.directory.topicsLede')
    },
    search: {
      inputLabel: requireString(search.inputLabel, 'copy.search.inputLabel'),
      placeholder: requireString(search.placeholder, 'copy.search.placeholder')
    },
    compare: {
      pageTitle: requireString(compare.pageTitle, 'copy.compare.pageTitle'),
      lede: requireString(compare.lede, 'copy.compare.lede'),
      placeholderUrl: requireString(compare.placeholderUrl, 'copy.compare.placeholderUrl'),
      mapping: requireString(compare.mapping, 'copy.compare.mapping')
    },
    dailyEmail: {
      eyebrow: requireString(dailyEmail.eyebrow, 'copy.dailyEmail.eyebrow'),
      intro: requireString(dailyEmail.intro, 'copy.dailyEmail.intro')
    },
    detail: {
      adminHeading: requireString(detail.adminHeading, 'copy.detail.adminHeading'),
      summaryLabel: requireString(detail.summaryLabel, 'copy.detail.summaryLabel'),
      summaryDisclosure: requireString(detail.summaryDisclosure, 'copy.detail.summaryDisclosure')
    },
    footer: {
      featureBlurb: requireString(footer.featureBlurb, 'copy.footer.featureBlurb'),
      tagline: requireString(footer.tagline, 'copy.footer.tagline')
    },
    about: {
      heading: requireString(about.heading, 'copy.about.heading'),
      lede: requireString(about.lede, 'copy.about.lede'),
      whyItExists: normalizeStrings(about.whyItExists, 'copy.about.whyItExists'),
      howItWorks: normalizeStrings(about.howItWorks, 'copy.about.howItWorks'),
      emailEyebrow: requireString(about.emailEyebrow, 'copy.about.emailEyebrow'),
      emailBody: requireString(about.emailBody, 'copy.about.emailBody'),
      extraSections: about.extraSections.map((section, index) => ({
        id: requireString(section.id, `copy.about.extraSections[${index}].id`),
        heading: requireString(section.heading, `copy.about.extraSections[${index}].heading`),
        html: requireString(section.html, `copy.about.extraSections[${index}].html`)
      })),
      community: normalizeStrings(about.community, 'copy.about.community'),
      quote: requireString(about.quote, 'copy.about.quote'),
      bio: requireString(about.bio, 'copy.about.bio')
    }
  };
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
      emailEyebrow: requireString(brand.emailEyebrow, 'brand.emailEyebrow'),
      logo: requireString(brand.logo, 'brand.logo'),
      aboutIcon: requireString(brand.aboutIcon, 'brand.aboutIcon'),
      uiAssets: normalizeStrings(brand.uiAssets, 'brand.uiAssets'),
      extraCss: String(brand.extraCss || '')
    },
    build: {
      docsCloneDir: requireString((raw.build || {}).docsCloneDir, 'build.docsCloneDir'),
      detailDays: Number((raw.build || {}).detailDays) || fail('build.detailDays must be a number')
    },
    links: {
      related: [...(((raw.links || {}).related) || [])],
      footer: normalizeLinkList((raw.links || {}).footer, 'links.footer'),
      stayCurrent: normalizeLinkList((raw.links || {}).stayCurrent, 'links.stayCurrent'),
      followProject: normalizeLinkList((raw.links || {}).followProject, 'links.followProject')
    },
    copy: normalizeCopy(raw.copy),
    discord: {
      botName: requireString((raw.discord || {}).botName, 'discord.botName')
    },
    ai: {
      schemaPrefix: requireString((raw.ai || {}).schemaPrefix, 'ai.schemaPrefix'),
      subject: requireString((raw.ai || {}).subject, 'ai.subject'),
      forbiddenOpeners: normalizeStrings((raw.ai || {}).forbiddenOpeners, 'ai.forbiddenOpeners'),
      impactBoost: requireRegExp((raw.ai || {}).impactBoost, 'ai.impactBoost')
    },
    docs: normalizeDocs(raw.docs),
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

// First match wins. `$1`, `$2`, ... in the winning route's template are replaced
// by that match's captured groups; an unmatched subject yields null so the
// caller can supply its own fallback.
function runRoute(routes, subject) {
  const text = String(subject ?? '');
  for (const route of routes) {
    const hit = text.match(route.match);
    if (hit) return route.template.replace(/\$(\d)/g, (token, index) => hit[Number(index)] ?? token);
  }
  return null;
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

module.exports = { getConfig, setConfig, resetConfig, normalize, runRules, runRoute };
