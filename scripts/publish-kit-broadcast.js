#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { KitPublisher } = require('../src/kit-publisher');

const AUTO_CUTOFF_UTC_MINUTES = (8 * 60) + 15;

function requestedDate(args = process.argv.slice(2)) {
  const dateIndex = args.indexOf('--date');
  const date = dateIndex >= 0 ? args[dateIndex + 1] : undefined;
  if (dateIndex >= 0 && (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error('--date must use YYYY-MM-DD format');
  }
  return date;
}

async function latestReportDate(websiteDir) {
  const dates = (await fs.readdir(websiteDir))
    .filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map(file => file.slice(0, 10))
    .sort();
  if (dates.length === 0) throw new Error(`No daily JSON reports found in ${websiteDir}`);
  return dates.at(-1);
}

async function loadDailyInput(options = {}) {
  const websiteDir = path.resolve(options.websiteDir || process.env.WEBSITE_DIR || 'website');
  const date = options.date || await latestReportDate(websiteDir);
  const reportPath = path.join(websiteDir, `${date}.json`);
  const summariesPath = path.join(websiteDir, 'period-summaries.json');
  const analysis = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  let periodSummaries = { days: {} };
  try {
    periodSummaries = JSON.parse(await fs.readFile(summariesPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const summary = periodSummaries.days?.[date] || analysis.englishSummary || {};
  return { date, analysis, summary };
}

async function loadDailyInputIfAvailable(options = {}) {
  try {
    return await loadDailyInput(options);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function utcDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid automatic reconciliation time: ${value}`);
  return date.toISOString().slice(0, 10);
}

function reconciliationStartDate(value = process.env.KIT_RECONCILIATION_START_DATE) {
  const date = String(value || '').trim();
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || utcDate(`${date}T00:00:00Z`) !== date) {
    throw new Error('KIT_RECONCILIATION_START_DATE must use a valid YYYY-MM-DD date');
  }
  return date;
}

function previousUtcDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid automatic reconciliation time: ${value}`);
  date.setUTCDate(date.getUTCDate() - 1);
  return utcDate(date);
}

function isAtOrAfterAutomaticCutoff(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid automatic reconciliation time: ${value}`);
  return (date.getUTCHours() * 60) + date.getUTCMinutes() >= AUTO_CUTOFF_UTC_MINUTES;
}

function automaticMode(args = process.argv.slice(2)) {
  return args.includes('--auto');
}

async function verifyExistingDate({ publisher, input, date, requireMarker }) {
  if (!input || !publisher.hasChanges(input.analysis, input.summary)) {
    return { status: 'skipped', reason: input ? 'no-changes' : 'no-report', date };
  }

  const result = await publisher.verifyDaily(date);
  if (result.status === 'missing' && requireMarker) {
    throw new Error(`Daily report ${date} has meaningful changes but no Kit broadcast was created before its UTC-day send window closed`);
  }
  return result;
}

async function runAutomatic(options = {}) {
  const now = options.now instanceof Date ? new Date(options.now.getTime()) : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid automatic reconciliation time: ${options.now}`);
  const websiteDir = path.resolve(options.websiteDir || process.env.WEBSITE_DIR || 'website');
  const publisher = options.publisher || new KitPublisher({ now: () => now });
  const logger = options.logger || console;
  if (publisher.draftMode) throw new Error('Automatic Kit reconciliation cannot run in draft mode');

  const today = utcDate(now);
  const yesterday = previousUtcDate(now);
  const startDate = reconciliationStartDate(options.reconciliationStartDate);
  const [todayInput, yesterdayInput] = await Promise.all([
    loadDailyInputIfAvailable({ websiteDir, date: today }),
    loadDailyInputIfAvailable({ websiteDir, date: yesterday })
  ]);
  const errors = [];
  let previousResult;
  let currentResult;

  try {
    previousResult = await verifyExistingDate({
      publisher,
      input: yesterdayInput,
      date: yesterday,
      requireMarker: !startDate || yesterday >= startDate
    });
    if (previousResult.status === 'missing' && startDate && yesterday < startDate) {
      logger.log(`Ignoring missing Kit broadcast for ${yesterday}; automatic reconciliation starts on ${startDate}.`);
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    currentResult = await verifyExistingDate({
      publisher,
      input: todayInput,
      date: today,
      requireMarker: false
    });

    if (currentResult.status === 'missing') {
      if (!isAtOrAfterAutomaticCutoff(now)) {
        currentResult = { status: 'skipped', reason: 'before-cutoff', date: today };
        logger.log(`The ${today} Kit broadcast is not due before 08:15 UTC.`);
      } else {
        currentResult = await publisher.publishDaily(todayInput);
        if (currentResult.status === 'duplicate') {
          currentResult = await publisher.verifyDaily(today);
        }
        if (currentResult.status === 'skipped' && currentResult.reason === 'not-configured') {
          throw new Error('KIT_API_KEY is required for automatic Kit reconciliation');
        }
      }
    } else if (currentResult.status === 'skipped') {
      logger.log(currentResult.reason === 'no-report'
        ? `No ${today} report exists; no Kit broadcast is required.`
        : `The ${today} report has no meaningful changes; no Kit broadcast is required.`);
    }
  } catch (error) {
    errors.push(error);
  }

  if (errors.length) {
    const uniqueMessages = [...new Set(errors.map(error => error.message))];
    throw new Error(uniqueMessages.join('; '));
  }

  return { status: 'reconciled', date: today, current: currentResult, previous: previousResult };
}

async function main() {
  const args = process.argv.slice(2);
  const requested = requestedDate(args);
  if (automaticMode(args) && requested) throw new Error('--auto and --date cannot be used together');

  if (automaticMode(args)) {
    const result = await runAutomatic();
    console.log(`✅ Kit daily reconciliation completed for ${result.date}.`);
    return;
  }

  const input = await loadDailyInput({ date: requested });
  const result = await new KitPublisher().publishDaily(input);
  if (result.status === 'scheduled') {
    console.log(`✅ Kit daily broadcast scheduled for ${input.date}.`);
  } else if (result.status === 'duplicate') {
    console.log(`✅ Kit daily broadcast for ${input.date} was already scheduled.`);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`❌ Unable to publish Kit daily broadcast: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  AUTO_CUTOFF_UTC_MINUTES,
  automaticMode,
  isAtOrAfterAutomaticCutoff,
  latestReportDate,
  loadDailyInput,
  loadDailyInputIfAvailable,
  previousUtcDate,
  reconciliationStartDate,
  requestedDate,
  runAutomatic,
  utcDate,
  verifyExistingDate
};
