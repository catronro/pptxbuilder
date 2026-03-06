#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { normalizePlan, validatePlan } = require('../pipeline/llm-slide-planner');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runFixture(filePath, shouldPass) {
  const name = path.basename(filePath);
  try {
    const raw = loadJson(filePath);
    const normalized = normalizePlan(raw, 7);
    validatePlan(normalized);
    if (!shouldPass) {
      console.error(`FAIL: ${name} unexpectedly passed`);
      return false;
    }
    console.log(`PASS: ${name}`);
    return true;
  } catch (err) {
    if (shouldPass) {
      console.error(`FAIL: ${name} unexpectedly failed`);
      console.error(String(err.message || err));
      return false;
    }
    console.log(`PASS (expected fail): ${name}`);
    return true;
  }
}

function main() {
  const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures');
  const files = fs.readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const valids = files.filter((f) => f.startsWith('valid-'));
  const invalids = files.filter((f) => f.startsWith('invalid-'));

  let ok = true;
  for (const f of valids) {
    ok = runFixture(path.join(fixturesDir, f), true) && ok;
  }
  for (const f of invalids) {
    ok = runFixture(path.join(fixturesDir, f), false) && ok;
  }

  if (!ok) process.exit(1);
}

main();
