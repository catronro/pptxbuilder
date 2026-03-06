#!/usr/bin/env node
/**
 * Generates solution documentation artifacts:
 * 1) Mermaid source diagram (`solution-flow.mmd`)
 * 2) Rendered PNG diagram (`solution-flow.png`)
 * 3) New-developer narrative guide (`solution-overview.md`)
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = __dirname;
const FLOW_MMD_PATH = path.join(DOCS_DIR, 'solution-flow.mmd');
const FLOW_PNG_PATH = path.join(DOCS_DIR, 'solution-flow.png');
const OVERVIEW_MD_PATH = path.join(DOCS_DIR, 'solution-overview.md');
const FLOW_MD_PATH = path.join(DOCS_DIR, 'solution-flow.md');

function nowIso() {
  return new Date().toISOString();
}

function buildMermaidFlow() {
  return [
    'flowchart TD',
    '  A["pipeline/generate-freeport-deck.js\\nStarts the CLI workflow and controls the full run"] --> B["pipeline/load-env.js (loadDotEnv)\\nLoads environment variables from .env"]',
    '  B --> C{"parseArgs\\nWhich input mode was provided?"}',
    '',
    '  C -->|--input| D["scripts/extract_input_text.py (extractInputText)\\nExtracts clean source text from input file"]',
    '  C -->|--plan-file| E["generate-freeport-deck.js\\nReads an existing slide plan JSON"]',
    '',
    '  D --> F["pipeline/llm-slide-planner.js (planSlidesFromText)\\nBuilds prompts and runs planning attempts"]',
    '  F --> U["pipeline/llm-slide-planner.js (requestAnthropicJson)\\nSends POST /messages request"]',
    '  U --> V["Anthropic LLM API\\nGenerates draft slide plan JSON"]',
    '  V --> W["LLM response text\\nReturns JSON-like content"]',
    '  W --> G',
    '  F --> G["pipeline/llm-slide-planner.js (normalizePlan)\\nCleans fields and enforces output shape"]',
    '  E --> G',
    '',
    '  G --> H["pipeline/llm-slide-planner.js (validatePlan)\\nChecks schema, narrative, layout, and numeric rules"]',
    '  H --> I{"Validation passes?"}',
    '  I -->|No| J["Stop run\\nThrow validation error and exit"]',
    '  I -->|Yes| K["Write output/*.plan.json\\nPersists validated plan artifact"]',
    '',
    '  K --> L["pipeline/freeport-deck-engine.js (renderPlanToFreeportDeck)\\nConverts plan into themed slides"]',
    '  L --> M["behavior/freeport-slide-styleguide.js\\nProvides shared visual styles and slide primitives"]',
    '  M --> N["Write output/*.pptx\\nSaves rendered deck"]',
    '',
    '  N --> O["scripts/qa_rendered_deck.py (runPostRenderQa)\\nChecks rendered text/title placement via PDF"]',
    '  O --> P{"QA passes?"}',
    '  P -->|No| Q["Stop run\\nThrow QA error and exit"]',
    '  P -->|Yes| R["Success\\nOutput includes plan JSON, PPTX, and QA PDF"]',
    '',
    '  S["behavior/freeport-slide-storytelling-skill.md\\nDefines LLM storytelling and schema instructions"] -. prompt source .-> F',
    '  T["tests/fixtures/*.json + scripts/test-validator.js\\nOffline validator tests outside runtime path"] -. test coverage .-> H',
    '',
  ].join('\n');
}

function buildFlowMarkdown() {
  return [
    '# Solution Flow Diagram',
    '',
    `Generated: ${nowIso()}`,
    '',
    '![Solution flow](./solution-flow.png)',
    '',
    'Mermaid source lives in `docs/solution-flow.mmd`.',
    '',
  ].join('\n');
}

function buildOverviewMarkdown() {
  return [
    '# Solution Overview (New Developer Guide)',
    '',
    `Generated: ${nowIso()}`,
    '',
    '## What This Solution Does',
    'This project builds a Freeport-branded PowerPoint deck from either raw source content (`--input`) or a prebuilt slide plan (`--plan-file`).',
    'The pipeline enforces narrative quality and structural correctness before writing a final deck.',
    '',
    '## End-to-End Flow',
    '1. `pipeline/generate-freeport-deck.js` starts the run, parses args, and orchestrates every step.',
    '2. `pipeline/load-env.js` loads `.env` values (API key/model/base URL overrides).',
    '3. If `--input` is used, `scripts/extract_input_text.py` extracts source text.',
    '4. `pipeline/llm-slide-planner.js` creates prompts and calls Anthropic (`POST /messages`) to produce a plan.',
    '5. The same planner file normalizes and validates the plan against strict narrative/layout/schema rules.',
    '6. `pipeline/freeport-deck-engine.js` renders validated slides into a styled `.pptx`.',
    '7. `scripts/qa_rendered_deck.py` converts to PDF and checks title/bullet presence and clipping risk.',
    '8. On success, artifacts are written to `output/` (`.plan.json`, `.pptx`, and QA PDF).',
    '',
    '## Core Components',
    '- `behavior/freeport-slide-storytelling-skill.md`: Prompt contract for narrative shape (SCQA + pyramid), source refs, and layout intent.',
    '- `behavior/freeport-slide-styleguide.js`: Visual system (theme, text styles, shape styles, chart defaults, slide helpers).',
    '- `pipeline/llm-slide-planner.js`: Planning brain and pre-render gatekeeper.',
    '- `pipeline/freeport-deck-engine.js`: Rendering layer from logical layouts to visual slides.',
    '- `scripts/qa_rendered_deck.py`: Post-render quality gate.',
    '',
    '## Where The LLM Is Called',
    'The outbound LLM call happens in `pipeline/llm-slide-planner.js` inside `requestAnthropicJson()`, which uses `fetch()` to call Anthropic `.../messages`.',
    'This function is invoked by `planSlidesFromText()`.',
    '',
    '## Runtime Modes',
    '- Input mode: `node pipeline/generate-freeport-deck.js --input <file>`',
    '- Plan mode: `node pipeline/generate-freeport-deck.js --plan-file <plan.json>`',
    '',
    '## Failure Behavior',
    '- Validation failure: run stops before rendering and prints detailed rule violations.',
    '- Rendering failure: run stops with render error.',
    '- QA failure: run stops after render and prints slide-level QA issues.',
    '',
    '## Generated Documentation Artifacts',
    '- `docs/solution-flow.mmd`: Mermaid source for the architecture flow.',
    '- `docs/solution-flow.png`: Rendered flow diagram.',
    '- `docs/solution-flow.md`: Lightweight page that displays the PNG.',
    '- `docs/solution-overview.md`: This narrative guide.',
    '',
    '## How To Regenerate This Documentation',
    'Run one command from project root:',
    '',
    '```bash',
    'npm run docs:generate',
    '```',
    '',
  ].join('\n');
}

async function renderMermaidToPng(inputPath, outputPath) {
  try {
    await execFileAsync('npx', [
      '-y',
      '@mermaid-js/mermaid-cli',
      '-i',
      inputPath,
      '-o',
      outputPath,
    ], { cwd: ROOT_DIR, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    const stderr = err?.stderr ? String(err.stderr).trim() : '';
    const stdout = err?.stdout ? String(err.stdout).trim() : '';
    const details = [stderr, stdout].filter(Boolean).join('\n');
    throw new Error(`Failed to render Mermaid PNG via mermaid-cli.\n${details}`);
  }
}

async function main() {
  await fs.mkdir(DOCS_DIR, { recursive: true });

  const mermaid = buildMermaidFlow();
  await fs.writeFile(FLOW_MMD_PATH, mermaid, 'utf8');

  await renderMermaidToPng(FLOW_MMD_PATH, FLOW_PNG_PATH);

  await fs.writeFile(FLOW_MD_PATH, buildFlowMarkdown(), 'utf8');
  await fs.writeFile(OVERVIEW_MD_PATH, buildOverviewMarkdown(), 'utf8');

  // eslint-disable-next-line no-console
  console.log('Documentation generated:');
  // eslint-disable-next-line no-console
  console.log(`- ${FLOW_MMD_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`- ${FLOW_PNG_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`- ${FLOW_MD_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`- ${OVERVIEW_MD_PATH}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.message || String(err));
  process.exit(1);
});
