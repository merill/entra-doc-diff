const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { getConfig } = require('./config');

const config = getConfig();

class DiscordPublisher {
  constructor(options = {}) {
    this.webhookUrl = options.webhookUrl || process.env.DISCORD_WEBHOOK_URL || '';
    this.webhookName = options.webhookName || process.env.DISCORD_BOT_NAME || config.discord.botName;
    // Leave avatar_url out by default so Discord uses the image configured on
    // the webhook. A public URL can still be supplied as an explicit override.
    this.avatarUrl = options.avatarUrl ?? process.env.DISCORD_AVATAR_URL ?? '';
    this.enabled = options.enabled ?? (process.env.DISCORD_ENABLED !== 'false' && Boolean(this.webhookUrl));
    this.dryRun = options.dryRun ?? (process.env.DISCORD_DRY_RUN === 'true');
    this.statePath = options.statePath || path.join('website', 'discord-state.json');
    this.siteBaseUrl = (options.siteBaseUrl || process.env.SITE_URL || config.site.url).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.maximumAttempts = options.maximumAttempts || 4;
  }

  truncate(value, maximumLength) {
    const text = String(value || '').trim();
    if (text.length <= maximumLength) return text;
    return `${text.substring(0, Math.max(0, maximumLength - 1)).trim()}…`;
  }

  validateWebhookUrl() {
    if (!this.webhookUrl) return false;

    let url;
    try {
      url = new URL(this.webhookUrl);
    } catch {
      throw new Error('DISCORD_WEBHOOK_URL is not a valid URL');
    }

    const allowedHosts = new Set(['discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com']);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || !url.pathname.startsWith('/api/webhooks/')) {
      throw new Error('DISCORD_WEBHOOK_URL must be an HTTPS Discord webhook URL');
    }

    return true;
  }

  getDiffEventId(file) {
    return `${config.identity.docEventPrefix}:${file.commitSha || 'unknown'}:${file.status || 'modified'}:${file.filename}`;
  }

  getDiffAnchor(file) {
    const digest = crypto.createHash('sha256').update(this.getDiffEventId(file)).digest('hex').substring(0, 12);
    return `change-${digest}`;
  }

  getReportUrl(dateForUrl) {
    return `${this.siteBaseUrl}/day/${dateForUrl}/`;
  }

  createDailySummaryEvent(analysis, dateForUrl) {
    const files = [
      ...(analysis.newFiles || []),
      ...(analysis.modifiedFiles || []),
      ...(analysis.deletedFiles || [])
    ];
    const messageCenterItems = analysis.messageCenterItems || [];
    if (files.length === 0 && messageCenterItems.length === 0) return null;

    const englishSummary = analysis.englishSummary || {};
    const fallbackSummary = files
      .map(file => file.englishSummary?.summary)
      .filter(Boolean)
      .join(' ');
    const documentationGroups = Array.isArray(englishSummary.groups) && englishSummary.groups.length > 0
      ? englishSummary.groups
      : files.length ? [{
          category: files[0].englishSummary?.category || 'Documentation update',
          title: files.length === 1
            ? files[0].englishSummary?.headline || `${config.site.productName} documentation update`
            : `${files.length} ${config.site.productName} documentation updates`,
          summary: fallbackSummary || `${files.length} ${config.site.productName} documentation file${files.length === 1 ? '' : 's'} changed.`,
          sourceFiles: files.map(file => file.filename)
        }] : [];
    const messageCenterGroups = messageCenterItems.map(item => ({
      category: item.changeType || 'Message Center',
      title: item.title,
      summary: item.summary,
      sourceFiles: []
    }));
    const groups = [...documentationGroups, ...messageCenterGroups];
    const hash = crypto.createHash('sha256')
      .update([
        ...files.map(file => file.eventId || this.getDiffEventId(file)),
        ...messageCenterItems.map(item => item.eventId || `message-center:${item.id}:${item.lastModifiedDateTime || item.version || item.date}`)
      ].sort().join('\n'))
      .digest('hex')
      .substring(0, 16);

    return {
      eventId: `${config.identity.batchEventPrefix}:batch:${dateForUrl}:${hash}`,
      type: 'daily',
      title: `${config.site.productName} daily update — ${dateForUrl}`,
      description: englishSummary.overview || `${files.length} documentation and ${messageCenterItems.length} Message Center update${files.length + messageCenterItems.length === 1 ? '' : 's'} were detected.`,
      groups,
      url: this.getReportUrl(dateForUrl)
    };
  }

  createEvents(analysis, dateForUrl) {
    const dailyEvent = this.createDailySummaryEvent(analysis, dateForUrl);
    return dailyEvent ? [dailyEvent] : [];
  }

  buildPayload(event) {
    const identity = {
      username: this.truncate(this.webhookName, 80)
    };

    if (this.avatarUrl) {
      identity.avatar_url = this.avatarUrl;
    }

    const visibleGroups = (event.groups || []).slice(0, 6);
    const fields = visibleGroups.map(group => ({
      name: this.truncate(`${group.category ? `[${group.category}] ` : ''}${group.title}`, 220),
      value: this.truncate(group.summary, 600),
      inline: false
    }));
    const hiddenGroupCount = Math.max(0, (event.groups || []).length - visibleGroups.length);
    fields.push({
      name: 'Read the full daily update',
      value: hiddenGroupCount > 0
        ? `[View all changes on ${config.site.host}](${event.url}) · ${hiddenGroupCount} additional documentation area${hiddenGroupCount === 1 ? '' : 's'}`
        : `[View all changes on ${config.site.host}](${event.url})`,
      inline: false
    });

    return {
      ...identity,
      allowed_mentions: { parse: [] },
      embeds: [{
        title: this.truncate(event.title, 256),
        url: event.url,
        description: this.truncate(event.description, 700),
        color: 0x6f42c1,
        fields
      }]
    };
  }

  async loadState() {
    try {
      const state = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      return {
        version: 1,
        published: state.published && typeof state.published === 'object' ? state.published : {},
        pending: state.pending && typeof state.pending === 'object' ? state.pending : {}
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`⚠️ Unable to read Discord state; starting with an empty state: ${error.message}`);
      }
      return { version: 1, published: {}, pending: {} };
    }
  }

  prunePublishedEvents(published, retentionDays = 120) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    return Object.fromEntries(Object.entries(published).filter(([, timestamp]) => {
      const value = Date.parse(timestamp);
      return Number.isNaN(value) || value >= cutoff;
    }));
  }

  async saveState(state) {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
    await fs.rename(temporaryPath, this.statePath);
  }

  getRetryDelay(response, responseBody, attempt) {
    const headerValue = Number(response.headers?.get?.('retry-after'));
    if (Number.isFinite(headerValue) && headerValue > 0) return Math.ceil(headerValue * 1000);

    const bodyValue = Number(responseBody?.retry_after);
    if (Number.isFinite(bodyValue) && bodyValue > 0) return Math.ceil(bodyValue * 1000);

    return 1000 * (2 ** attempt);
  }

  async sendPayload(payload) {
    const webhookUrl = new URL(this.webhookUrl);
    webhookUrl.searchParams.set('wait', 'true');

    for (let attempt = 0; attempt < this.maximumAttempts; attempt++) {
      let response;
      let responseBody = null;

      try {
        response = await this.fetchImpl(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) return;

        try {
          responseBody = await response.json();
        } catch {
          responseBody = null;
        }
      } catch (error) {
        if (attempt === this.maximumAttempts - 1) throw error;
        await this.sleep(1000 * (2 ** attempt));
        continue;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === this.maximumAttempts - 1) {
        const detail = responseBody?.message ? `: ${responseBody.message}` : '';
        throw new Error(`Discord webhook returned HTTP ${response.status}${detail}`);
      }

      await this.sleep(this.getRetryDelay(response, responseBody, attempt));
    }
  }

  async publish(analysis, dateForUrl) {
    const events = this.createEvents(analysis, dateForUrl);
    if (events.length === 0) return { published: 0, pending: 0, skipped: 0 };

    if (!this.enabled) {
      console.log('ℹ️ Discord publishing is disabled or DISCORD_WEBHOOK_URL is not configured');
      return { published: 0, pending: 0, skipped: events.length };
    }

    this.validateWebhookUrl();
    const state = await this.loadState();
    state.published = this.prunePublishedEvents(state.published);
    state.pending = Object.fromEntries(Object.entries(state.pending).filter(([, event]) => event?.type === 'daily'));

    for (const event of events) {
      if (!state.published[event.eventId]) state.pending[event.eventId] = event;
    }

    if (this.dryRun) {
      console.log(`🧪 Discord dry run: ${Object.keys(state.pending).length} message(s) would be published`);
      return { published: 0, pending: Object.keys(state.pending).length, skipped: 0 };
    }

    // Persist the queue before the first network request so a terminated run
    // can resume without rediscovering or duplicating the source events.
    await this.saveState(state);

    let publishedCount = 0;
    for (const [eventId, event] of Object.entries(state.pending)) {
      try {
        await this.sendPayload(this.buildPayload(event));
        state.published[eventId] = new Date().toISOString();
        delete state.pending[eventId];
        publishedCount++;
        await this.saveState(state);
      } catch (error) {
        console.error(`⚠️ Discord delivery failed for ${eventId}: ${error.message}`);
      }
    }

    await this.saveState(state);
    const pendingCount = Object.keys(state.pending).length;
    console.log(`💬 Discord delivery complete: ${publishedCount} published, ${pendingCount} pending`);
    return { published: publishedCount, pending: pendingCount, skipped: 0 };
  }
}

module.exports = DiscordPublisher;
