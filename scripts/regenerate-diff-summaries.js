#!/usr/bin/env node

require('dotenv').config();
const path = require('path');
const DocsMonitor = require('../src/monitor-docs');
const {
  allDocumentationChanges,
  readJson,
  serializeAnalysis,
  writeJsonAtomic
} = require('../src/update-state');

function requestedDates(argumentsList) {
  const argument = argumentsList.find(value => value.startsWith('--dates='));
  if (!argument) throw new Error('Pass one or more recovery dates with --dates=YYYY-MM-DD[,YYYY-MM-DD]');
  const dates = [...new Set(argument.slice('--dates='.length).split(',').map(value => value.trim()).filter(Boolean))];
  if (dates.length === 0 || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error('Recovery dates must use YYYY-MM-DD format');
  }
  return dates;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  const dates = requestedDates(process.argv.slice(2));
  const websiteDir = path.resolve(process.env.WEBSITE_DIR || 'website');
  const monitor = new DocsMonitor({ websiteDir });

  for (const date of dates) {
    const filePath = path.join(websiteDir, `${date}.json`);
    const analysis = await readJson(filePath, null);
    if (!analysis) throw new Error(`No daily report exists for ${date}`);
    const changes = allDocumentationChanges(analysis);
    if (changes.length === 0) throw new Error(`Daily report ${date} has no documentation changes`);

    console.log(`🧠 Regenerating ${changes.length} recovered diff summary/summaries for ${date}...`);
    await monitor.generateDiffEnglishSummaries(analysis);
    const incomplete = changes.filter(change => change.englishSummary?.generatedBy !== 'openai');
    if (incomplete.length > 0) {
      throw new Error(`OpenAI did not complete ${incomplete.length} summary/summaries for ${date}`);
    }
    analysis.englishSummary = monitor.createFallbackEnglishSummary(analysis);
    await writeJsonAtomic(filePath, serializeAnalysis(analysis));
  }
}

main().catch(error => {
  console.error(`❌ Unable to regenerate recovered diff summaries: ${error.message}`);
  process.exitCode = 1;
});
