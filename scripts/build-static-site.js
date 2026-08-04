#!/usr/bin/env node

const path = require('path');
const { StaticSiteGenerator } = require('../src/static-site');

async function main() {
  const generator = new StaticSiteGenerator({
    websiteDir: path.resolve(process.env.WEBSITE_DIR || 'website'),
    mcDataPath: process.env.MC_DATA_PATH
  });
  await generator.build();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
