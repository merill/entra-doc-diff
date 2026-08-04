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
  const args = new Set(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY || await readHidden('OpenAI API key (input hidden): ');
  if (!apiKey) throw new Error('An OpenAI API key is required');
  const generator = new PeriodSummaryGenerator({
    websiteDir: path.resolve(process.env.WEBSITE_DIR || 'website'),
    mcDataPath: process.env.MC_DATA_PATH,
    apiKey
  });
  const result = await generator.run({ all: args.has('--all'), force: args.has('--force') });
  console.log(`✅ Period summaries ready: ${result.generated} generated in this run, $${result.costUsd.toFixed(4)} estimated API cost.`);
}

main().catch(error => {
  console.error(`❌ Unable to generate period summaries: ${error.message}`);
  process.exitCode = 1;
});
