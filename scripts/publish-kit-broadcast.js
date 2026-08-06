#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { KitPublisher } = require('../src/kit-publisher');

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

async function main() {
  const input = await loadDailyInput({ date: requestedDate() });
  const publisher = new KitPublisher();
  const result = await publisher.publishDaily(input);
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

module.exports = { latestReportDate, loadDailyInput, requestedDate };
