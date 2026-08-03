const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class DiscordPublisher {
  constructor(options = {}) {
    this.webhookUrl = options.webhookUrl || process.env.DISCORD_ENTRA_SCOUT_WEBHOOK_URL || process.env.DISCORD_ENTRA_DOCS_WEBHOOK_URL || '';
    this.webhookName = options.webhookName || process.env.DISCORD_ENTRA_SCOUT_NAME || 'Entra Scout';
    this.avatarUrl = options.avatarUrl || process.env.DISCORD_ENTRA_SCOUT_AVATAR_URL || 'https://raw.githubusercontent.com/merill/entra-doc-diff/main/design/entra-scout-avatar-1024.png';
    this.enabled = options.enabled ?? (process.env.DISCORD_ENABLED !== 'false' && Boolean(this.webhookUrl));
    this.dryRun = options.dryRun ?? (process.env.DISCORD_DRY_RUN === 'true');
    this.statePath = options.statePath || path.join('website', 'discord-state.json');
    this.siteBaseUrl = (options.siteBaseUrl || process.env.ENTRA_DIFF_SITE_URL || 'https://entradiff.merill.net').replace(/\/$/, '');
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
      throw new Error('DISCORD_ENTRA_SCOUT_WEBHOOK_URL is not a valid URL');
    }

    const allowedHosts = new Set(['discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com']);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || !url.pathname.startsWith('/api/webhooks/')) {
      throw new Error('DISCORD_ENTRA_SCOUT_WEBHOOK_URL must be an HTTPS Discord webhook URL');
    }

    return true;
  }

  getDiffEventId(file) {
    return `entra-docs:${file.commitSha || 'unknown'}:${file.status || 'modified'}:${file.filename}`;
  }

  getDiffAnchor(file) {
    const digest = crypto.createHash('sha256').update(this.getDiffEventId(file)).digest('hex').substring(0, 12);
    return `change-${digest}`;
  }

  getReportUrl(dateForUrl) {
    return `${this.siteBaseUrl}/${dateForUrl}.html`;
  }

  getChangeLabel(file) {
    if (file.status === 'added') return 'New documentation';
    if (file.status === 'removed') return 'Removed documentation';
    return 'Updated documentation';
  }

  getCategoryColor(category) {
    const colors = {
      'Preview': 0x8e44ad,
      'General availability': 0x27ae60,
      'Retirement or breaking change': 0xc0392b,
      'Admin action': 0xe67e22,
      'New documentation': 0x2980b9,
      'Documentation change': 0x7f8c8d,
      'Feature update': 0x0078d4
    };
    return colors[category] || 0x0078d4;
  }

  getTimestamp(value) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  createDiffEvent(file, dateForUrl) {
    const summary = file.englishSummary || {};
    const reportUrl = `${this.getReportUrl(dateForUrl)}#${this.getDiffAnchor(file)}`;
    const links = [
      `[EntraDiff](${reportUrl})`,
      file.publicDocsUrl ? `[Microsoft Learn](${file.publicDocsUrl})` : null,
      file.githubUrl ? `[GitHub](${file.githubUrl})` : null
    ].filter(Boolean).join(' · ');

    return {
      eventId: this.getDiffEventId(file),
      type: 'diff',
      category: summary.category || this.getChangeLabel(file),
      title: summary.headline || file.commitMessage || this.getChangeLabel(file),
      description: summary.summary || `${this.getChangeLabel(file)} for ${file.filename}.`,
      adminImpact: summary.adminImpact || 'Review the documentation change and determine whether it affects your tenant configuration or rollout plans.',
      changeLabel: this.getChangeLabel(file),
      filename: file.filename,
      additions: file.additions || 0,
      deletions: file.deletions || 0,
      url: file.publicDocsUrl || reportUrl,
      reportUrl,
      links,
      publishedAt: file.commitDate
    };
  }

  createBulkEvent(analysis, dateForUrl, diffEvents) {
    if (diffEvents.length < 2 || !analysis.englishSummary) return null;

    const hash = crypto.createHash('sha256')
      .update(diffEvents.map(event => event.eventId).sort().join('\n'))
      .digest('hex')
      .substring(0, 16);

    return {
      eventId: `entra-docs:bulk:${dateForUrl}:${hash}`,
      type: 'bulk',
      title: `Microsoft Entra documentation digest — ${dateForUrl}`,
      description: analysis.englishSummary.overview,
      groups: analysis.englishSummary.groups || [],
      url: this.getReportUrl(dateForUrl)
    };
  }

  createEvents(analysis, dateForUrl) {
    const files = [
      ...(analysis.newFiles || []),
      ...(analysis.modifiedFiles || []),
      ...(analysis.deletedFiles || [])
    ];
    const diffEvents = files.map(file => this.createDiffEvent(file, dateForUrl));
    const bulkEvent = this.createBulkEvent(analysis, dateForUrl, diffEvents);
    return bulkEvent ? [bulkEvent, ...diffEvents] : diffEvents;
  }

  buildPayload(event) {
    if (event.type === 'bulk') {
      return {
        username: this.truncate(this.webhookName, 80),
        avatar_url: this.avatarUrl,
        allowed_mentions: { parse: [] },
        embeds: [{
          title: this.truncate(event.title, 256),
          url: event.url,
          description: this.truncate(event.description, 4096),
          color: 0x6f42c1,
          fields: (event.groups || []).slice(0, 25).map(group => ({
            name: this.truncate(`${group.category ? `[${group.category}] ` : ''}${group.title}`, 256),
            value: this.truncate(`${group.summary}\n[View the daily EntraDiff report](${event.url})`, 1024),
            inline: false
          })),
          footer: { text: 'Entra Docs digest · AI-generated with GPT-5.6 Luna' }
        }]
      };
    }

    return {
      username: this.truncate(this.webhookName, 80),
      avatar_url: this.avatarUrl,
      allowed_mentions: { parse: [] },
      embeds: [{
        title: this.truncate(event.title, 256),
        url: event.url,
        description: this.truncate(event.description, 4096),
        color: this.getCategoryColor(event.category),
        fields: [
          {
            name: 'Why Entra administrators should care',
            value: this.truncate(event.adminImpact, 1024),
            inline: false
          },
          {
            name: 'Documentation change',
            value: this.truncate(`${event.changeLabel} · +${event.additions} / -${event.deletions}\n\`${event.filename}\``, 1024),
            inline: false
          },
          {
            name: 'Links',
            value: this.truncate(event.links, 1024),
            inline: false
          }
        ],
        footer: { text: `Entra Docs · ${event.category} · AI-generated with GPT-5.6 Luna` },
        timestamp: this.getTimestamp(event.publishedAt)
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
      console.log('ℹ️ Discord publishing is disabled or DISCORD_ENTRA_SCOUT_WEBHOOK_URL is not configured');
      return { published: 0, pending: 0, skipped: events.length };
    }

    this.validateWebhookUrl();
    const state = await this.loadState();
    state.published = this.prunePublishedEvents(state.published);

    for (const event of events) {
      if (!state.published[event.eventId]) state.pending[event.eventId] = event;
    }

    if (this.dryRun) {
      console.log(`🧪 Discord dry run: ${Object.keys(state.pending).length} message(s) would be published`);
      return { published: 0, pending: Object.keys(state.pending).length, skipped: 0 };
    }

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
