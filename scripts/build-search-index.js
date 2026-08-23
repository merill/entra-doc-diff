#!/usr/bin/env node

const path = require('path');
const { buildSearchIndex } = require('../src/search-index');

buildSearchIndex({
  websiteDir: path.resolve(process.env.WEBSITE_DIR || 'website'),
  mcDataPath: process.env.MC_DATA_PATH,
  docsRepoPath: process.env.DOCS_REPO_PATH || process.env.LOCAL_REPO_PATH
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
