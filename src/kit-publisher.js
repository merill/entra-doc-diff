const { getConfig } = require('./config');

const config = getConfig();
const SITE_URL = config.site.url;
const { PRODUCTS, classifyTopic } = require('./static-site');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]));
}

function cleanText(value = '', limit = 1000) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function dailyChanges(summary = {}) {
  const changes = Array.isArray(summary.keyChanges) && summary.keyChanges.length
    ? summary.keyChanges
    : Array.isArray(summary.groups) && summary.groups.length
      ? summary.groups
      : Array.isArray(summary.highlights)
        ? summary.highlights
        : [];

  return changes.slice(0, 10).map(change => ({
    title: cleanText(change.title || change.headline, 180),
    detail: cleanText(change.detail || change.summary, 600),
    category: cleanText(change.product || change.category, 100),
    sourceId: cleanText(change.sourceId, 180)
  })).filter(change => change.title || change.detail);
}

function dateLabel(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid report date: ${date}`);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(parsed);
}

function productFromLabel(label) {
  const value = String(label || '').toLowerCase();
  if (!value) return null;
  return [...PRODUCTS].sort((a, b) => b.name.length - a.name.length).find(product =>
    value === product.name.toLowerCase()
      || value === product.short.toLowerCase()
      || value.includes(product.name.toLowerCase())
      || value.includes(product.short.toLowerCase())
  ) || null;
}

function changeTaxonomy(change) {
  const product = productFromLabel(change.category);
  const inferredTopic = classifyTopic('', change.title, change.detail);
  const topic = inferredTopic?.slug !== 'general' ? inferredTopic : null;
  return {
    product,
    topic,
    labels: [product?.short || change.category, topic?.name].filter(Boolean)
  };
}

class KitPublisher {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.KIT_API_KEY ?? '';
    this.senderEmail = String(options.senderEmail ?? process.env.KIT_SENDER_EMAIL ?? '').trim();
    this.apiBaseUrl = options.apiBaseUrl || 'https://api.kit.com/v4';
    const scheduleDelayMinutes = Number(options.scheduleDelayMinutes ?? process.env.KIT_SCHEDULE_DELAY_MINUTES ?? 5);
    const verificationGraceMinutes = Number(options.verificationGraceMinutes ?? process.env.KIT_SEND_VERIFICATION_GRACE_MINUTES ?? 30);
    const maxAttempts = Number(options.maxAttempts ?? 4);
    this.scheduleDelayMinutes = Number.isFinite(scheduleDelayMinutes) && scheduleDelayMinutes >= 1 ? scheduleDelayMinutes : 5;
    this.verificationGraceMinutes = Number.isFinite(verificationGraceMinutes) && verificationGraceMinutes >= 1 ? verificationGraceMinutes : 30;
    this.maxAttempts = Number.isInteger(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 4;
    this.fetch = options.fetch || globalThis.fetch;
    this.sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.now = options.now || (() => new Date());
    this.logger = options.logger || console;
    this.dryRun = options.dryRun ?? process.env.KIT_DRY_RUN === 'true';
    this.draftMode = options.draftMode ?? process.env.KIT_DRAFT_MODE === 'true';
  }

  marker(date, draftMode = this.draftMode) {
    return `${config.identity.kitMarkerPrefix}:${date}${draftMode ? ':draft' : ''}`;
  }

  hasChanges(analysis = {}, summary = {}) {
    if (dailyChanges(summary).length > 0) return true;
    const totalFiles = Number(analysis.summary?.totalFiles || 0);
    return totalFiles > 0 || ['newFiles', 'modifiedFiles', 'deletedFiles']
      .some(key => Array.isArray(analysis[key]) && analysis[key].length > 0);
  }

  buildBroadcast({ date, analysis = {}, summary = {} }) {
    const dayUrl = `${SITE_URL}/day/${date}/`;
    const label = dateLabel(date);
    const changes = dailyChanges(summary);
    const headline = cleanText(summary.headline || `${config.site.productName} daily update`, 110);
    const overview = cleanText(summary.overview || analysis.englishSummary?.overview || `Review today's tracked ${config.site.productName} changes.`, 1400);
    const subject = cleanText(`${headline} — ${label}`, 150);
    const previewText = cleanText(overview, 180);
    const sendAt = this.draftMode
      ? null
      : new Date(this.now().getTime() + Math.max(1, this.scheduleDelayMinutes) * 60000).toISOString();

    const changeHtml = changes.map(change => {
      const href = change.sourceId ? `${dayUrl}#${encodeURIComponent(change.sourceId)}` : dayUrl;
      const taxonomy = changeTaxonomy(change);
      const icons = [
        taxonomy.product ? `<img src="${SITE_URL}/assets/products/${taxonomy.product.icon}" width="22" height="22" alt="" style="display:inline-block;width:22px!important;max-width:22px!important;height:22px!important;max-height:22px!important;object-fit:contain;vertical-align:middle">` : '',
        taxonomy.topic ? `<img src="${SITE_URL}${taxonomy.topic.icon}" width="18" height="18" alt="" style="display:inline-block;width:18px!important;max-width:18px!important;height:18px!important;max-height:18px!important;object-fit:contain;vertical-align:middle">` : ''
      ].filter(Boolean).join('<span style="display:inline-block;width:6px"></span>');
      const category = taxonomy.labels.length
        ? `<div style="margin:0 0 5px;color:#0d5745;font:700 11px/1.35 Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase">${escapeHtml(taxonomy.labels.join(' · '))}</div>`
        : '';
      const heading = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:0;border-collapse:collapse"><tr>${icons ? `<td width="50" valign="top" style="width:50px;min-width:50px;padding:1px 9px 0 0;vertical-align:top;white-space:nowrap">${icons}</td>` : ''}<td valign="top" style="padding:0;vertical-align:top">${category}<h2 style="margin:0 0 7px;font:600 18px/1.3 Georgia,serif"><a href="${escapeHtml(href)}" style="color:#11181d;text-decoration:none">${escapeHtml(change.title)}</a></h2></td></tr></table>`;
      return `<div style="margin:0 0 20px;padding:0 0 18px;border-bottom:1px solid #d8d3c7">${heading}${change.detail ? `<p style="margin:5px 0 0;color:#46514e;font:14px/1.55 Arial,sans-serif">${escapeHtml(change.detail)}</p>` : ''}</div>`;
    }).join('');

    const content = `<div style="max-width:680px;margin:0 auto;color:#11181d;font-family:Arial,sans-serif"><div style="margin:0 0 26px"><div style="margin:0 0 6px;color:#0d5745;font:700 11px/1.3 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase">${config.brand.emailEyebrow} · ${escapeHtml(label)}</div><h1 style="margin:0 0 12px;font:650 30px/1.2 Georgia,serif"><a href="${dayUrl}" style="color:#11181d;text-decoration:none">${escapeHtml(headline)}</a></h1><p style="margin:0;color:#263030;font:16px/1.6 Arial,sans-serif">${escapeHtml(overview)}</p></div>${changeHtml}<p style="margin:28px 0 0"><a href="${dayUrl}" style="display:inline-block;padding:11px 17px;background:#0d5745;color:#fff;text-decoration:none;font:700 15px/1.3 Arial,sans-serif;border-radius:4px">View all updates for ${escapeHtml(label)} →</a></p><p style="margin:26px 0 0;color:#68716f;font:12px/1.5 Arial,sans-serif">Automated change intelligence from Microsoft Learn documentation and relevant Microsoft 365 Message Center announcements. Verify important details in the linked source material.</p></div>`;

    return {
      content,
      description: this.marker(date),
      ...(this.senderEmail ? { email_address: this.senderEmail } : {}),
      preview_text: previewText,
      subject,
      public: false,
      published_at: null,
      send_at: sendAt,
      thumbnail_alt: null,
      thumbnail_url: null
    };
  }

  async request(method, resourcePath, body, options = {}) {
    if (!this.apiKey) throw new Error('KIT_API_KEY is required to publish a Kit broadcast');
    if (typeof this.fetch !== 'function') throw new Error('A Fetch API implementation is required');
    const maxAttempts = Number(options.maxAttempts ?? this.maxAttempts);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response;
      try {
        response = await this.fetch(`${this.apiBaseUrl}${resourcePath}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Kit-Api-Key': this.apiKey
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
      } catch (error) {
        if (attempt + 1 >= maxAttempts) {
          error.transient = true;
          throw error;
        }
        await this.waitBeforeRetry(attempt);
        continue;
      }

      const responseText = await response.text();
      let data = {};
      if (responseText) {
        try { data = JSON.parse(responseText); } catch { data = { message: responseText }; }
      }
      if (response.ok) return data;

      const transient = response.status === 429 || response.status >= 500;
      if (transient && attempt + 1 < maxAttempts) {
        await this.waitBeforeRetry(attempt, response.headers.get('retry-after'));
        continue;
      }

      const detail = data.errors?.join?.('; ') || data.message || response.statusText || 'request failed';
      const error = new Error(`Kit API ${method} ${resourcePath} failed with HTTP ${response.status}: ${detail}`);
      error.status = response.status;
      error.transient = transient;
      error.retryAfter = response.headers.get('retry-after');
      throw error;
    }

    throw new Error(`Kit API ${method} ${resourcePath} exhausted its retries`);
  }

  async findBroadcast(marker) {
    let after;
    const seenCursors = new Set();

    while (true) {
      const cursor = after ? `&after=${encodeURIComponent(after)}` : '';
      const existing = await this.request('GET', `/broadcasts?per_page=1000${cursor}`);
      const match = (existing.broadcasts || []).find(broadcast => broadcast.description === marker);
      if (match) return match;

      const pagination = existing.pagination || {};
      if (!pagination.has_next_page) return undefined;
      if (!pagination.end_cursor || seenCursors.has(pagination.end_cursor)) {
        throw new Error('Kit broadcast pagination did not advance to a new cursor');
      }
      seenCursors.add(pagination.end_cursor);
      after = pagination.end_cursor;
    }
  }

  async verifyBroadcast(broadcast) {
    if (!broadcast?.id) throw new Error('Cannot verify a Kit broadcast without an id');
    const response = await this.request('GET', `/broadcasts/${encodeURIComponent(broadcast.id)}/stats`);
    const stats = response.broadcast?.stats || {};
    const lifecycleStatus = String(stats.status || '').toLowerCase();

    if (lifecycleStatus === 'completed') {
      this.logger.log(`Verified Kit broadcast ${broadcast.id} completed for ${broadcast.description || 'the daily email'}.`);
      return { status: 'verified', lifecycleStatus, broadcastId: broadcast.id };
    }

    if (lifecycleStatus === 'scheduled' || lifecycleStatus === 'sending') {
      const sendAt = new Date(broadcast.send_at || '');
      if (Number.isNaN(sendAt.getTime())) {
        throw new Error(`Kit broadcast ${broadcast.id} is ${lifecycleStatus} but has no valid send_at timestamp`);
      }
      const deadline = sendAt.getTime() + (this.verificationGraceMinutes * 60000);
      if (this.now().getTime() <= deadline) {
        this.logger.log(`Kit broadcast ${broadcast.id} is ${lifecycleStatus}; completion verification remains within the ${this.verificationGraceMinutes}-minute grace period.`);
        return { status: 'pending', lifecycleStatus, broadcastId: broadcast.id, sendAt: broadcast.send_at };
      }
      throw new Error(`Kit broadcast ${broadcast.id} remained ${lifecycleStatus} more than ${this.verificationGraceMinutes} minutes after ${broadcast.send_at}`);
    }

    throw new Error(`Kit broadcast ${broadcast.id} has unexpected delivery status ${lifecycleStatus || 'unknown'}`);
  }

  async verifyDaily(date, options = {}) {
    const marker = this.marker(date, false);
    const broadcast = options.broadcast || await this.findBroadcast(marker);
    if (!broadcast) return { status: 'missing', marker };
    return this.verifyBroadcast(broadcast);
  }

  async createBroadcastOnce(marker, payload) {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const existing = await this.findBroadcast(marker);
      if (existing) {
        return { status: 'duplicate', broadcastId: existing.id };
      }

      try {
        const created = await this.request('POST', '/broadcasts', payload, { maxAttempts: 1 });
        return {
          status: payload.send_at ? 'scheduled' : 'draft',
          broadcastId: created.broadcast?.id,
          ...(payload.send_at ? { sendAt: payload.send_at } : {})
        };
      } catch (error) {
        if (!error.transient || attempt + 1 >= this.maxAttempts) throw error;
        // A POST may have reached Kit even when its response was lost. Wait, then
        // re-list by the daily marker before making another create request.
        await this.waitBeforeRetry(attempt, error.retryAfter);
      }
    }

    throw new Error(`Kit broadcast ${marker} exhausted its retries`);
  }

  async waitBeforeRetry(attempt, retryAfter) {
    const retrySeconds = Number(retryAfter);
    const delay = Number.isFinite(retrySeconds) && retrySeconds > 0
      ? Math.min(30000, retrySeconds * 1000)
      : Math.min(30000, 1000 * (2 ** attempt));
    this.logger.warn(`Kit API request was transiently unavailable; retrying in ${Math.round(delay / 1000)} second(s).`);
    await this.sleep(delay);
  }

  async publishDaily({ date, analysis = {}, summary = {} }) {
    if (!this.hasChanges(analysis, summary)) {
      this.logger.log(`No meaningful ${config.ai.subject} updates for ${date}; skipping the Kit broadcast.`);
      return { status: 'skipped', reason: 'no-changes' };
    }

    const payload = this.buildBroadcast({ date, analysis, summary });
    if (this.dryRun) {
      this.logger.log(this.draftMode
        ? `KIT_DRY_RUN: would create draft ${payload.description}.`
        : `KIT_DRY_RUN: would schedule ${payload.description} for ${payload.send_at}.`);
      return { status: 'dry-run', payload };
    }
    if (!this.apiKey) {
      this.logger.log('KIT_API_KEY is not configured; skipping the Kit broadcast.');
      return { status: 'skipped', reason: 'not-configured' };
    }

    const marker = payload.description;
    const result = await this.createBroadcastOnce(marker, payload);
    if (result.status === 'duplicate') {
      this.logger.log(`Kit broadcast ${marker} already exists as ${result.broadcastId}; skipping duplicate creation.`);
      return result;
    }

    if (result.status === 'draft') {
      this.logger.log(`Created Kit draft ${marker}${result.broadcastId ? ` as ${result.broadcastId}` : ''}; it will not send until manually tested or scheduled in Kit.`);
      return result;
    }

    this.logger.log(`Scheduled Kit broadcast ${marker}${result.broadcastId ? ` as ${result.broadcastId}` : ''} for ${payload.send_at}.`);
    return result;
  }
}

module.exports = { KitPublisher, changeTaxonomy, cleanText, dailyChanges, escapeHtml, productFromLabel };
