#!/usr/bin/env node

require('dotenv').config();
const path = require('path');
const { PeriodSummaryGenerator } = require('../src/period-summaries');

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve('');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = input => {
      for (const character of input) {
        if (character === '\u0003') return finish(new Error('Cancelled'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);
  const selectedKinds = [
    ['--days', 'day'],
    ['--weeks', 'week'],
    ['--months', 'month']
  ].filter(([flag]) => args.has(flag)).map(([, kind]) => kind);
  const apiKey = process.env.OPENAI_API_KEY || await readHidden('OpenAI API key (input hidden): ');
  if (!apiKey) throw new Error('An OpenAI API key is required');
  if (args.has('--ignore-budget')) {
    console.warn('⚠️ Period-summary budget limits are disabled for this explicit regeneration run.');
  }
  const generator = new PeriodSummaryGenerator({
    websiteDir: path.resolve(process.env.WEBSITE_DIR || 'website'),
    mcDataPath: process.env.MC_DATA_PATH,
    apiKey,
    ignoreBudget: args.has('--ignore-budget')
  });
  const datesArgument = rawArgs.find(argument => argument.startsWith('--dates='));
  const dates = datesArgument
    ? datesArgument.slice('--dates='.length).split(',').map(value => value.trim()).filter(Boolean)
    : [];
  const result = await generator.run({
    all: args.has('--all'),
    force: args.has('--force'),
    kinds: selectedKinds.length > 0 ? selectedKinds : undefined,
    dates
  });
  console.log(`✅ Period summaries ready: ${result.generated} API request(s) in this run (${result.days} days, ${result.weeks} weeks, ${result.months} months available), $${result.costUsd.toFixed(4)} estimated API cost.`);
}

main().catch(error => {
  if (/UTC-day period-summary budget/.test(error.message || '')) {
    console.warn(`⚠️ ${error.message}`);
    console.warn('The completed summaries were saved; continuing the site build with the latest available briefs.');
    return;
  }
  console.error(`❌ Unable to generate period summaries: ${error.message}`);
  process.exitCode = 1;
});
