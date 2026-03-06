/**
 * Purpose:
 * Loads key-value pairs from the project's `.env` file into `process.env`.
 *
 * Role in Pipeline:
 * Provides lightweight runtime configuration bootstrap before API-driven
 * planning and generation steps execute.
 *
 * Impact on Overall Solution:
 * Enables environment-dependent behavior (API keys, model/base URL settings)
 * without hardcoding secrets or requiring shell-level exports per run.
 */
const fs = require('node:fs');
const path = require('node:path');

function loadDotEnv(projectRoot) {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadDotEnv };
