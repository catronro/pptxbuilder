#!/usr/bin/env node
/**
 * Generates documentation artifacts from a live scan of the current codebase.
 * Artifacts:
 * - docs/structure-scan.json
 * - docs/solution-flow.mmd
 * - docs/solution-flow.png
 * - docs/solution-flow.md
 * - docs/solution-overview.md
 * - docs/environment-setup.md
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { generateLayoutCorpus } = require('../scripts/generate-layout-corpus');

const execFileAsync = promisify(execFile);

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = __dirname;

const OUT = {
  scanJson: path.join(DOCS_DIR, 'structure-scan.json'),
  flowMmd: path.join(DOCS_DIR, 'solution-flow.mmd'),
  flowPng: path.join(DOCS_DIR, 'solution-flow.png'),
  flowMd: path.join(DOCS_DIR, 'solution-flow.md'),
  overviewMd: path.join(DOCS_DIR, 'solution-overview.md'),
  envSetupMd: path.join(DOCS_DIR, 'environment-setup.md'),
  layoutCorpusPptx: path.join(DOCS_DIR, 'layout-corpus.pptx'),
};

const KEY = {
  generate: path.join(ROOT_DIR, 'pipeline', 'generate-freeport-deck.js'),
  loadEnv: path.join(ROOT_DIR, 'pipeline', 'load-env.js'),
  planner: path.join(ROOT_DIR, 'pipeline', 'llm-slide-planner.js'),
  engine: path.join(ROOT_DIR, 'pipeline', 'freeport-deck-engine.js'),
  styleguide: path.join(ROOT_DIR, 'behavior', 'freeport-slide-styleguide.js'),
  storytelling: path.join(ROOT_DIR, 'behavior', 'freeport-slide-storytelling-skill.md'),
  qaScript: path.join(ROOT_DIR, 'scripts', 'qa_rendered_deck.py'),
  extractScript: path.join(ROOT_DIR, 'scripts', 'extract_input_text.py'),
  validatorScript: path.join(ROOT_DIR, 'scripts', 'test-validator.js'),
};

function nowIso() {
  return new Date().toISOString();
}

function rel(absPath) {
  return path.relative(ROOT_DIR, absPath).replace(/\\/g, '/');
}

function uniq(arr) {
  return [...new Set(arr)];
}

async function readText(absPath) {
  try {
    return await fs.readFile(absPath, 'utf8');
  } catch {
    return '';
  }
}

async function listFiles(absDir, exts = []) {
  try {
    const ents = await fs.readdir(absDir, { withFileTypes: true });
    return ents
      .filter((e) => e.isFile())
      .map((e) => path.join(absDir, e.name))
      .filter((p) => (exts.length ? exts.includes(path.extname(p)) : true))
      .sort()
      .map(rel);
  } catch {
    return [];
  }
}

function extractRequires(text) {
  const out = [];
  const re = /require\(['"](.+?)['"]\)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return uniq(out);
}

function extractFunctionNames(text) {
  const out = [];
  const re = /(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return uniq(out);
}

function extractExports(text) {
  const block = text.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/m);
  if (!block) return [];
  return uniq(
    block[1]
      .split(',')
      .map((s) => s.trim())
      .map((s) => s.replace(/\s*:\s*.+$/, '').trim())
      .filter(Boolean)
  );
}

function extractEnvVars(text) {
  const out = [];
  const re = /process\.env\.([A-Z0-9_]+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return uniq(out).sort();
}

function extractCliFlags(text) {
  const out = [];
  const re = /token\s*===\s*['"](--[a-z0-9-]+)['"]/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return uniq(out);
}

function extractPathJoinTargets(text, folder, ext) {
  const out = [];
  const re = new RegExp(`['\"]${folder}['\"],\\s*['\"]([^'\\\"]+\\${ext.replace('.', '\\.')})['\"]`, 'g');
  let m;
  while ((m = re.exec(text))) out.push(`${folder}/${m[1]}`);
  return uniq(out);
}

function extractFileLiterals(text, ext) {
  const out = [];
  const re = new RegExp(`['"]([A-Za-z0-9_.\\/-]+${ext.replace('.', '\\.')})['"]`, 'g');
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return uniq(out);
}

function discoverScriptRefs(text, availableScriptFiles = []) {
  const available = new Set(availableScriptFiles.map((f) => f.replace(/^scripts\//, '')));
  const literals = extractFileLiterals(text, '.py')
    .map((x) => x.split('/').pop())
    .filter((x) => available.has(x))
    .map((x) => `scripts/${x}`);
  return uniq(literals);
}

function discoverBehaviorRefs(text, availableBehaviorFiles = []) {
  const available = new Set(availableBehaviorFiles.map((f) => f.replace(/^behavior\//, '')));
  const literals = extractFileLiterals(text, '.md')
    .map((x) => x.split('/').pop())
    .filter((x) => available.has(x))
    .map((x) => `behavior/${x}`);
  return uniq(literals);
}

function extractFetchEndpoint(text) {
  const hasMessages = text.includes('/messages');
  if (!hasMessages) return null;
  const baseVar = text.includes('DEFAULT_BASE_URL') ? 'DEFAULT_BASE_URL' : 'base_url';
  return `${baseVar}/messages`;
}

function detectMermaidCliUsage(text) {
  return text.includes('@mermaid-js/mermaid-cli');
}

async function scanStructure() {
  const generatedText = await readText(KEY.generate);
  const loadEnvText = await readText(KEY.loadEnv);
  const plannerText = await readText(KEY.planner);
  const engineText = await readText(KEY.engine);
  const docsGenText = await readText(path.join(DOCS_DIR, 'generate-docs.js'));

  const pipelineFiles = await listFiles(path.join(ROOT_DIR, 'pipeline'), ['.js']);
  const scriptFiles = await listFiles(path.join(ROOT_DIR, 'scripts'), ['.js', '.py']);
  const behaviorFiles = await listFiles(path.join(ROOT_DIR, 'behavior'), ['.js', '.md']);
  const testFixtureFiles = await listFiles(path.join(ROOT_DIR, 'tests', 'fixtures'), ['.json']);

  const discoveredPythonScripts = uniq([
    ...extractPathJoinTargets(generatedText, 'scripts', '.py'),
    ...discoverScriptRefs(generatedText, scriptFiles),
  ]);
  const discoveredBehaviorFiles = uniq([
    ...extractPathJoinTargets(generatedText, 'behavior', '.md'),
    ...discoverBehaviorRefs(generatedText, behaviorFiles),
  ]);

  const hasInputMode = generatedText.includes('--input');
  const hasPlanMode = generatedText.includes('--plan-file');

  const components = [
    {
      file: rel(KEY.generate),
      functions: extractFunctionNames(generatedText),
      exports: extractExports(generatedText),
      requires: extractRequires(generatedText),
      cliFlags: extractCliFlags(generatedText),
      pythonScripts: discoveredPythonScripts,
      behaviorFiles: discoveredBehaviorFiles,
    },
    {
      file: rel(KEY.loadEnv),
      functions: extractFunctionNames(loadEnvText),
      exports: extractExports(loadEnvText),
      requires: extractRequires(loadEnvText),
      envVars: extractEnvVars(loadEnvText),
    },
    {
      file: rel(KEY.planner),
      functions: extractFunctionNames(plannerText),
      exports: extractExports(plannerText),
      requires: extractRequires(plannerText),
      envVars: extractEnvVars(plannerText),
      fetchEndpoint: extractFetchEndpoint(plannerText),
      hasRetryLoop: /for\s*\(let\s+attempt\s*=\s*0;\s*attempt\s*<\s*2/.test(plannerText),
    },
    {
      file: rel(KEY.engine),
      functions: extractFunctionNames(engineText),
      exports: extractExports(engineText),
      requires: extractRequires(engineText),
    },
    {
      file: rel(path.join(DOCS_DIR, 'generate-docs.js')),
      usesMermaidCli: detectMermaidCliUsage(docsGenText),
    },
  ];

  return {
    scannedAt: nowIso(),
    root: ROOT_DIR,
    files: {
      pipeline: pipelineFiles,
      scripts: scriptFiles,
      behavior: behaviorFiles,
      testFixtures: testFixtureFiles,
    },
    keyFiles: Object.fromEntries(Object.entries(KEY).map(([k, v]) => [k, rel(v)])),
    modes: {
      input: hasInputMode,
      planFile: hasPlanMode,
    },
    llm: {
      provider: plannerText.includes('Anthropic') ? 'Anthropic' : 'Unknown',
      endpoint: extractFetchEndpoint(plannerText),
      envVars: extractEnvVars(plannerText).filter((x) => x.startsWith('ANTHROPIC_')),
      callFunction: plannerText.includes('requestAnthropicJson') ? 'requestAnthropicJson' : null,
      orchestratorFunction: plannerText.includes('planSlidesFromText') ? 'planSlidesFromText' : null,
    },
    dependencies: {
      pythonScriptsFromGenerate: discoveredPythonScripts,
      behaviorInputsFromGenerate: discoveredBehaviorFiles,
      styleguideInEngine: engineText.includes('freeport-slide-styleguide') ? 'behavior/freeport-slide-styleguide.js' : null,
      imageManifestFlag: generatedText.includes('--image-manifest'),
      imageAssetsPipeline: generatedText.includes('imageAssets'),
      imageMatcherInEngine: engineText.includes("require('./image-matcher')") || engineText.includes('buildImageSelector'),
      validatorFixtures: testFixtureFiles,
    },
    qualityGates: {
      preRenderValidation: plannerText.includes('validatePlan('),
      postRenderQa: generatedText.includes('runPostRenderQa'),
      plannerRetry: /for\s*\(let\s+attempt\s*=\s*0;\s*attempt\s*<\s*2/.test(plannerText),
    },
    components,
  };
}

function first(arr, fallback) {
  return Array.isArray(arr) && arr.length ? arr[0] : fallback;
}

function buildMermaidFlow(scan) {
  const gen = scan.keyFiles.generate;
  const env = scan.keyFiles.loadEnv;
  const planner = scan.keyFiles.planner;
  const engine = scan.keyFiles.engine;
  const qa = first(scan.dependencies.pythonScriptsFromGenerate.filter((s) => s.includes('qa_')), scan.keyFiles.qaScript);
  const extractor = first(scan.dependencies.pythonScriptsFromGenerate.filter((s) => s.includes('extract_')), scan.keyFiles.extractScript);
  const storytelling = first(scan.dependencies.behaviorInputsFromGenerate, scan.keyFiles.storytelling);
  const styleguide = scan.dependencies.styleguideInEngine || scan.keyFiles.styleguide;
  const llmEndpoint = scan.llm.endpoint || 'LLM endpoint';
  const hasImagePath = Boolean(scan.dependencies.imageManifestFlag || scan.dependencies.imageAssetsPipeline || scan.dependencies.imageMatcherInEngine);

  const lines = [
    'flowchart TD',
    `  A["${gen}\\nStarts the CLI workflow and orchestrates the run"] --> B["${env}\\nLoads environment variables for runtime config"]`,
    '  B --> C{"CLI mode\\nInput file or plan file?"}',
    '',
    `  C -->|--input| D["${extractor}\\nExtracts source text for planning"]`,
    `  C -->|--plan-file| E["${gen}\\nLoads an existing plan JSON"]`,
    ...(hasImagePath ? [`  C -->|--image-manifest| X["${gen}\\nLoads optional image manifest JSON"]`] : []),
    '',
    ...(hasImagePath ? [`  D --> AA["${gen}\\nCan emit extracted image manifest to output"]`] : []),
    `  D --> F["${planner} (planSlidesFromText)\\nBuilds prompts and prepares planning input"]`,
    `  F --> U["${planner} (requestAnthropicJson)\\nCalls external model API"]`,
    `  U --> V["External LLM (${llmEndpoint})\\nReturns draft plan text"]`,
    '  V --> W["Parse response\\nConverts model output into JSON"]',
    `  W --> G["${planner} (normalizePlan)\\nNormalizes fields and output shape"]`,
    `  E --> G`,
    '',
    `  G --> H["${planner} (validatePlan)\\nEnforces schema, narrative, and layout rules"]`,
    '  H --> I{"Plan valid?"}',
    '  I -->|No| J["Stop run\\nEmit validation errors"]',
    '  I -->|Yes| K["Write output/*.plan.json\\nPersist validated plan"]',
    '',
    `  K --> L["${engine} (renderPlanToFreeportDeck)\\nRenders plan into Freeport slides"]`,
    ...(hasImagePath ? [`  X --> Y["${engine}\\nPasses imageAssets into renderer"]`] : []),
    ...(hasImagePath ? ['  Y --> Z["pipeline/image-matcher.js\\nSelects best unused image per slide"]'] : []),
    ...(hasImagePath ? ['  Z --> L'] : []),
    `  L --> M["${styleguide}\\nProvides theme, styles, and slide primitives"]`,
    '  M --> N["Write output/*.pptx\\nSave rendered deck"]',
    '',
    `  N --> O["${qa}\\nRuns post-render QA checks against PDF"]`,
    '  O --> P{"QA pass?"}',
    '  P -->|No| Q["Stop run\\nEmit QA issues"]',
    '  P -->|Yes| R["Success\\nPlan + deck (+ QA PDF) available in output/"]',
    '',
    `  S["${storytelling}\\nDefines LLM storytelling/schema instructions"] -. prompt source .-> F`,
    `  T["${scan.keyFiles.validatorScript} + tests/fixtures/*.json\\nOffline tests for validation rules"] -. test coverage .-> H`,
    '',
  ];

  return lines.join('\n');
}

function buildFlowMarkdown(scan) {
  return [
    '# Solution Flow Diagram',
    '',
    `Generated: ${scan.scannedAt}`,
    '',
    '![Solution flow](./solution-flow.png)',
    '',
    '- Diagram source: `docs/solution-flow.mmd`',
    '- Scan source: `docs/structure-scan.json`',
    '',
  ].join('\n');
}

function buildOverviewMarkdown(scan) {
  const plannerComp = scan.components.find((c) => c.file === scan.keyFiles.planner) || { envVars: [] };
  const genComp = scan.components.find((c) => c.file === scan.keyFiles.generate) || { cliFlags: [] };
  const imageSupport = Boolean(scan.dependencies.imageManifestFlag || scan.dependencies.imageAssetsPipeline || scan.dependencies.imageMatcherInEngine);

  return [
    '# Solution Overview (New Developer Guide)',
    '',
    `Generated from live scan: ${scan.scannedAt}`,
    '',
    '## What This System Does',
    'This system builds Freeport-branded PowerPoint decks from either raw source input or an existing plan file.',
    'It applies strict plan validation before rendering and runs post-render QA before final success.',
    '',
    '## Runtime Entry Point',
    `- Primary CLI: \`${scan.keyFiles.generate}\``,
    `- Supported flags discovered from code: ${genComp.cliFlags && genComp.cliFlags.length ? genComp.cliFlags.map((f) => `\`${f}\``).join(', ') : '(none detected)'}`,
    '',
    '## How It Works (In Order)',
    `1. \`${scan.keyFiles.generate}\` parses CLI args and loads environment variables via \`${scan.keyFiles.loadEnv}\`.`,
    `2. In input mode, \`${scan.keyFiles.extractScript}\` extracts text from source files.`,
    `3. \`${scan.keyFiles.planner}\` builds prompts and calls the LLM endpoint (${scan.llm.endpoint || 'not detected'}).`,
    '4. The planner normalizes and validates the plan against schema/narrative/layout constraints.',
    ...(imageSupport ? ['5. If image assets are present or `--image-manifest` is provided, the renderer uses `pipeline/image-matcher.js` to map images to slides.'] : []),
    `6. \`${scan.keyFiles.engine}\` renders the validated plan into a PPTX using \`${scan.keyFiles.styleguide}\`.`,
    `7. \`${scan.keyFiles.qaScript}\` performs post-render QA checks on the converted PDF.`,
    '8. If all checks pass, artifacts are available in `output/`.',
    '',
    '## LLM Integration Details',
    `- Provider detected: ${scan.llm.provider}`,
    `- Planner call function: \`${scan.llm.callFunction || 'not detected'}\``,
    `- Orchestrator function: \`${scan.llm.orchestratorFunction || 'not detected'}\``,
    `- Endpoint pattern: \`${scan.llm.endpoint || 'not detected'}\``,
    `- Environment variables used: ${plannerComp.envVars && plannerComp.envVars.length ? plannerComp.envVars.map((v) => `\`${v}\``).join(', ') : '(none detected)'}`,
    '',
    '## Quality Gates',
    `- Pre-render plan validation: ${scan.qualityGates.preRenderValidation ? 'enabled' : 'not detected'}`,
    `- Planner retry on failed validation: ${scan.qualityGates.plannerRetry ? 'enabled (2 attempts)' : 'not detected'}`,
    `- Post-render QA: ${scan.qualityGates.postRenderQa ? 'enabled' : 'not detected'}`,
    `- Image manifest path: ${scan.dependencies.imageManifestFlag ? 'detected (--image-manifest)' : 'not detected'}`,
    `- Image-aware rendering path: ${scan.dependencies.imageMatcherInEngine ? 'detected (image-matcher in engine)' : 'not detected'}`,
    '',
    '## Main Code Areas',
    `- Pipeline files: ${scan.files.pipeline.map((f) => `\`${f}\``).join(', ')}`,
    `- Behavior files: ${scan.files.behavior.map((f) => `\`${f}\``).join(', ')}`,
    `- Runtime scripts: ${scan.files.scripts.map((f) => `\`${f}\``).join(', ')}`,
    '',
    '## Artifacts Generated By This Documentation Script',
    '- `docs/structure-scan.json` (machine-readable scan results)',
    '- `docs/solution-flow.mmd` (diagram source)',
    '- `docs/solution-flow.png` (rendered flow diagram)',
    '- `docs/solution-flow.md` (diagram page)',
    '- `docs/solution-overview.md` (this narrative)',
    '- `docs/environment-setup.md` (environment setup guide)',
    '- `docs/layout-corpus.pptx` (all renderer layout variations for visual QA)',
    '',
    '## Refresh Command',
    '```bash',
    'npm run docs:generate',
    '```',
    '',
  ].join('\n');
}

function buildEnvironmentSetupMarkdown(scan) {
  const envVars = scan.llm.envVars && scan.llm.envVars.length
    ? scan.llm.envVars
    : ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'];

  return [
    '# Environment Setup (New Machine)',
    '',
    `Generated from live scan: ${scan.scannedAt}`,
    '',
    '## 1. Prerequisites',
    '- Node.js 20+ and npm',
    '- Python 3.10+ with `pip`',
    '- LibreOffice (`soffice`) available on PATH (required for post-render QA)',
    '- Git',
    '',
    '## 2. Clone and Install',
    '```bash',
    'git clone <your-repo-url>',
    'cd v2PresBuild',
    'npm install',
    'python3 -m pip install --upgrade pypdf pymupdf',
    '```',
    '',
    '## 3. Configure Environment Variables',
    'Create `.env` in the project root:',
    '',
    '```bash',
    'cp .env.example .env',
    '```',
    '',
    'Set these values (detected from code):',
    ...envVars.map((v) => `- \`${v}\``),
    '',
    '## 4. Verify Installation',
    '```bash',
    'node -v',
    'python3 --version',
    'soffice --version',
    'npm run test:validator',
    'npm run docs:generate',
    '```',
    '',
    '## 5. Run The Pipeline',
    'Input mode:',
    '```bash',
    'npm run generate:freeport -- --input <path-to-pdf-or-text> --output output/my-deck.pptx',
    '```',
    '',
    'Plan-file mode:',
    '```bash',
    'npm run generate:freeport -- --plan-file <path-to-plan.json> --output output/my-deck.pptx',
    '```',
    '',
    '## 6. Expected Outputs',
    '- `output/*.plan.json`',
    '- `output/*.pptx`',
    '- `output/*.pdf` (QA conversion output)',
    '',
    '## Troubleshooting',
    '- Missing API key: add it to `.env`.',
    '- `soffice not found`: install LibreOffice and ensure the binary is on PATH.',
    '- PyMuPDF import error: `python3 -m pip install pymupdf`.',
    '- pypdf import error: `python3 -m pip install pypdf`.',
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

  const scan = await scanStructure();
  await fs.writeFile(OUT.scanJson, JSON.stringify(scan, null, 2), 'utf8');

  const mermaid = buildMermaidFlow(scan);
  await fs.writeFile(OUT.flowMmd, mermaid, 'utf8');
  await renderMermaidToPng(OUT.flowMmd, OUT.flowPng);

  await fs.writeFile(OUT.flowMd, buildFlowMarkdown(scan), 'utf8');
  await fs.writeFile(OUT.overviewMd, buildOverviewMarkdown(scan), 'utf8');
  await fs.writeFile(OUT.envSetupMd, buildEnvironmentSetupMarkdown(scan), 'utf8');
  await generateLayoutCorpus({
    outputPath: OUT.layoutCorpusPptx,
    writePlan: false,
    writeImageManifest: false,
  });

  // eslint-disable-next-line no-console
  console.log('Documentation generated from live scan:');
  for (const target of Object.values(OUT)) {
    // eslint-disable-next-line no-console
    console.log(`- ${target}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.message || String(err));
  process.exit(1);
});
