#!/usr/bin/env node
/**
 * Purpose:
 * CLI entry point that orchestrates end-to-end deck generation from either
 * extracted source text or a prebuilt slide plan JSON.
 *
 * Role in Pipeline:
 * Coordinates environment loading, argument parsing, input extraction,
 * LLM planning/normalization/validation, deck rendering, and post-render QA.
 *
 * Impact on Overall Solution:
 * This is the pipeline controller. It enforces the ordered workflow and quality
 * gates so only validated plans and QA-passing decks are emitted to output.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { loadDotEnv } = require('./load-env');
const { planSlidesFromText, normalizePlan, validatePlan } = require('./llm-slide-planner');
const { renderPlanToFreeportDeck } = require('./freeport-deck-engine');

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = { maxSlides: 7 };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--input') args.input = next, i += 1;
    else if (token === '--output') args.output = next, i += 1;
    else if (token === '--plan-file') args.planFile = next, i += 1;
    else if (token === '--image-manifest') args.imageManifest = next, i += 1;
    else if (token === '--max-slides') args.maxSlides = Number(next || 7), i += 1;
  }
  return args;
}

async function extractInputText(inputPath, assetsOutDir) {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'extract_input_text.py');
  const args = assetsOutDir ? [scriptPath, inputPath, assetsOutDir] : [scriptPath, inputPath];
  const { stdout, stderr } = await execFileAsync('python3', args);
  if (stderr && stderr.trim()) {
    throw new Error(stderr.trim());
  }

  const payload = JSON.parse(stdout);
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload;
}

async function runPostRenderQa({ deckPath, planPath }) {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'qa_rendered_deck.py');
  try {
    const { stdout, stderr } = await execFileAsync('python3', [scriptPath, deckPath, planPath], { maxBuffer: 8 * 1024 * 1024 });
    if (stderr && stderr.trim()) {
      throw new Error(stderr.trim());
    }
    const result = JSON.parse(stdout);
    if (!result.ok) {
      throw new Error(`Post-render QA failed:\n- ${result.issues.join('\n- ')}`);
    }
  } catch (err) {
    const stdout = err?.stdout ? String(err.stdout).trim() : '';
    if (stdout.startsWith('{')) {
      try {
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed.issues) && parsed.issues.length) {
          throw new Error(`Post-render QA failed:\n- ${parsed.issues.join('\n- ')}`);
        }
      } catch {
        // fall through to generic error below
      }
    }
    throw new Error(err.message || String(err));
  }
}

async function main() {
  loadDotEnv(path.join(__dirname, '..'));
  const args = parseArgs(process.argv);

  if (!args.input && !args.planFile) {
    throw new Error('Usage: node pipeline/generate-freeport-deck.js --input <file.pdf|file.txt|file.md> [--output <deck.pptx>] [--max-slides 7]');
  }

  const outPath = path.resolve(args.output || path.join(__dirname, '..', 'output', 'generated-freeport-deck.pptx'));
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  let plan;
  let planOut;
  let imageAssets = null;
  if (args.planFile) {
    const raw = await fs.readFile(path.resolve(args.planFile), 'utf8');
    plan = normalizePlan(JSON.parse(raw), Number.isFinite(args.maxSlides) ? args.maxSlides : 7);
    validatePlan(plan);
    if (args.imageManifest) {
      const manifestRaw = await fs.readFile(path.resolve(args.imageManifest), 'utf8');
      imageAssets = JSON.parse(manifestRaw);
    }
    planOut = outPath.replace(/\.pptx$/i, '.plan.json');
    await fs.writeFile(planOut, JSON.stringify(plan, null, 2));
    console.log(`Plan written: ${planOut}`);
  } else {
    const assetsOutDir = outPath.replace(/\.pptx$/i, '.assets');
    const extracted = await extractInputText(path.resolve(args.input), assetsOutDir);
    const skillPath = path.join(__dirname, '..', 'behavior', 'freeport-slide-storytelling-skill.md');

    plan = await planSlidesFromText({
      inputText: extracted.text,
      inputName: path.basename(extracted.path),
      skillPath,
      maxSlides: Number.isFinite(args.maxSlides) ? args.maxSlides : 7,
    });

    if (extracted.imageAssets) {
      imageAssets = extracted.imageAssets;
      const imageManifestOut = outPath.replace(/\.pptx$/i, '.image-manifest.json');
      await fs.writeFile(imageManifestOut, JSON.stringify(extracted.imageAssets, null, 2));
      console.log(`Image manifest written: ${imageManifestOut}`);
    }

    planOut = outPath.replace(/\.pptx$/i, '.plan.json');
    await fs.writeFile(planOut, JSON.stringify(plan, null, 2));
    console.log(`Plan written: ${planOut}`);
  }

  const written = await renderPlanToFreeportDeck({ plan, outputPath: outPath, imageAssets });
  await runPostRenderQa({ deckPath: written, planPath: planOut });
  console.log(`Deck written: ${written}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
