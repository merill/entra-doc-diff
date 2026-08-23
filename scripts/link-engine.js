#!/usr/bin/env node

// Links a local checkout of the engine into node_modules, for development.
//
// In CI the engine's setup action does this. Locally there is no action, so
// this points node_modules/@merill/dailynews-engine at a sibling checkout —
// or at DAILYNEWS_ENGINE, if the engine lives somewhere else.

const fs = require('fs');
const path = require('path');

const target = path.resolve(
  process.env.DAILYNEWS_ENGINE || path.join(__dirname, '..', '..', 'dailynews-engine')
);

if (!fs.existsSync(path.join(target, 'package.json'))) {
  console.error(`No engine checkout at ${target}.`);
  console.error('Clone merill/dailynews-engine beside this repository, or set DAILYNEWS_ENGINE.');
  process.exitCode = 1;
  return;
}

const modules = path.join(__dirname, '..', 'node_modules');
const scope = path.join(modules, '@merill');
const link = path.join(scope, 'dailynews-engine');
fs.mkdirSync(scope, { recursive: true });
fs.rmSync(link, { recursive: true, force: true });
fs.symlinkSync(target, link, 'junction');

// npm resolves the `dailynews` in this repository's scripts from node_modules/.bin,
// and only creates that shim for a package it installed itself.
const bin = path.join(modules, '.bin');
const shim = path.join(bin, 'dailynews');
fs.mkdirSync(bin, { recursive: true });
fs.rmSync(shim, { force: true });
fs.symlinkSync(path.join(target, 'bin', 'dailynews.js'), shim);
fs.chmodSync(path.join(target, 'bin', 'dailynews.js'), 0o755);

if (!fs.existsSync(path.join(target, 'node_modules'))) {
  console.warn(`Linked, but ${target} has no node_modules — run npm ci there.`);
}
console.log(`@merill/dailynews-engine -> ${target}`);
