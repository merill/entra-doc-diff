const fs = require('fs').promises;
const path = require('path');
const { getConfig } = require('./config');

const config = getConfig();

const STATE_VERSION = 1;
const REFRESH_HOURS_UTC = [2, 8, 14, 20];

function createMonitorState(value = {}) {
  return {
    version: STATE_VERSION,
    docsHead: String(value.docsHead || ''),
    messageCenterVersions: value.messageCenterVersions && typeof value.messageCenterVersions === 'object'
      ? value.messageCenterVersions
      : {},
    pendingEmailEventIds: Array.isArray(value.pendingEmailEventIds) ? [...new Set(value.pendingEmailEventIds)] : [],
    lastEmailDate: String(value.lastEmailDate || ''),
    migrated: value.migrated === true
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return fallback;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporaryPath, filePath);
}

async function loadMonitorState(filePath) {
  return createMonitorState(await readJson(filePath, {}));
}

function documentationEventId(file) {
  return `${config.identity.docEventPrefix}:${file.commitSha || 'unknown'}:${file.status || 'modified'}:${file.filename}`;
}

function messageCenterVersion(item) {
  return String(item.lastModifiedDateTime || item.version || item.startDate || item.date || 'unknown');
}

function messageCenterEventId(item) {
  return `message-center:${item.id}:${messageCenterVersion(item)}`;
}

function allDocumentationChanges(analysis = {}) {
  return [...(analysis.newFiles || []), ...(analysis.modifiedFiles || []), ...(analysis.deletedFiles || [])];
}

function normalizeAnalysis(analysis = {}) {
  const authors = analysis.summary?.authors instanceof Set
    ? analysis.summary.authors
    : new Set(Array.isArray(analysis.summary?.authors) ? analysis.summary.authors : []);
  return {
    ...analysis,
    newFiles: analysis.newFiles || [],
    modifiedFiles: analysis.modifiedFiles || [],
    deletedFiles: analysis.deletedFiles || [],
    messageCenterItems: analysis.messageCenterItems || [],
    summary: { totalCommits: 0, totalFiles: 0, ...analysis.summary, authors }
  };
}

function mergeDailyAnalysis(existingValue, incomingValue) {
  const existing = normalizeAnalysis(existingValue);
  const incoming = normalizeAnalysis(incomingValue);
  const seen = new Set();
  const mergeBucket = (left, right) => [...left, ...right].filter(file => {
    file.eventId ||= documentationEventId(file);
    if (seen.has(file.eventId)) return false;
    seen.add(file.eventId);
    return true;
  }).sort((a, b) => String(a.firstSeenAt || a.commitDate || '').localeCompare(String(b.firstSeenAt || b.commitDate || '')));
  const newFiles = mergeBucket(existing.newFiles, incoming.newFiles);
  const modifiedFiles = mergeBucket(existing.modifiedFiles, incoming.modifiedFiles);
  const deletedFiles = mergeBucket(existing.deletedFiles, incoming.deletedFiles);
  const messageCenterSeen = new Set();
  const messageCenterItems = [...existing.messageCenterItems, ...incoming.messageCenterItems].filter(item => {
    item.eventId ||= messageCenterEventId(item);
    if (messageCenterSeen.has(item.eventId)) return false;
    messageCenterSeen.add(item.eventId);
    return true;
  });
  const authors = new Set([...existing.summary.authors, ...incoming.summary.authors]);
  const commitIds = new Set(allDocumentationChanges({ newFiles, modifiedFiles, deletedFiles }).map(file => file.commitSha).filter(Boolean));
  return {
    ...existing,
    ...incoming,
    newFiles,
    modifiedFiles,
    deletedFiles,
    messageCenterItems,
    summary: {
      ...existing.summary,
      ...incoming.summary,
      totalCommits: commitIds.size,
      totalFiles: newFiles.length + modifiedFiles.length + deletedFiles.length,
      authors
    }
  };
}

function serializeAnalysis(analysis) {
  const normalized = normalizeAnalysis(analysis);
  return {
    ...normalized,
    summary: { ...normalized.summary, authors: [...normalized.summary.authors].sort() }
  };
}

function detectMessageCenterChanges(items, previousVersions, { migrated = false, now } = {}) {
  const versions = {};
  const changed = [];
  for (const item of items) {
    const version = messageCenterVersion(item);
    versions[item.id] = version;
    if (migrated && previousVersions[item.id] !== version) {
      changed.push({ ...item, version, eventId: messageCenterEventId(item), firstSeenAt: now });
    }
  }
  return { changed, versions };
}

function nextScheduledRefresh(value) {
  const current = new Date(value);
  if (Number.isNaN(current.getTime())) throw new Error(`Invalid refresh date: ${value}`);
  for (let offset = 0; offset <= 1; offset += 1) {
    for (const hour of REFRESH_HOURS_UTC) {
      const candidate = new Date(Date.UTC(
        current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + offset, hour, 15, 0, 0
      ));
      if (candidate > current) return candidate.toISOString();
    }
  }
  throw new Error('Unable to calculate the next refresh');
}

module.exports = {
  STATE_VERSION,
  REFRESH_HOURS_UTC,
  allDocumentationChanges,
  createMonitorState,
  detectMessageCenterChanges,
  documentationEventId,
  loadMonitorState,
  mergeDailyAnalysis,
  messageCenterEventId,
  nextScheduledRefresh,
  readJson,
  serializeAnalysis,
  writeJsonAtomic
};
