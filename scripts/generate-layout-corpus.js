#!/usr/bin/env node
/**
 * Generates a layout corpus deck that showcases every available layout
 * variation in the renderer. Each slide title includes the variation name.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { renderPlanToFreeportDeck } = require('../pipeline/freeport-deck-engine');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--output') args.output = next, i += 1;
    else if (token === '--no-plan') args.noPlan = true;
    else if (token === '--no-image-manifest') args.noImageManifest = true;
  }
  return args;
}

function slideTitle(variant) {
  return `Layout Variation: ${variant}.`;
}

function baseSlide(layout, variant, extras = {}) {
  return {
    layout,
    layoutVariant: variant,
    pyramidRole: 'supporting_logic',
    supportsArgument: 'A1',
    title: slideTitle(variant),
    summary: 'This slide demonstrates a single renderer variation for developer review.',
    sourceRefs: ['PAGE 1: layout corpus sample'],
    bullets: [
      'Use this slide to inspect spacing, hierarchy, and readability.',
      'Variation naming is reflected directly in the title.',
      'Content is synthetic and designed for visual QA only.',
      'Compare this slide with sibling variations of the same layout.',
    ],
    leftTitle: 'Left Column',
    leftBullets: [
      'Left-side structure and typography sample.',
      'Bullet rhythm and spacing reference.',
      'Card and margin behavior reference.',
    ],
    rightTitle: 'Right Column',
    rightBullets: [
      'Right-side structure and typography sample.',
      'Alternate panel style sample.',
      'Mixed content behavior reference.',
    ],
    metrics: [
      { label: 'Actual P80', value: '17.7 in', note: 'Observed outcome' },
      { label: 'Optimal P80', value: '10.1 in', note: 'Backcast target' },
      { label: 'Vertical Accuracy', value: '85.7%', note: 'Primary modeled lever' },
      { label: 'Overdrill > 2 ft', value: '71.4%', note: 'Execution risk concentration' },
    ],
    chart: {
      title: 'Planned vs Actual',
      categories: ['Energy (kcal/ton)', 'Cost ($/ton)'],
      series: [
        { name: 'Planned', values: [317.5, 0.53] },
        { name: 'Actual', values: [335.6, 0.52] },
      ],
    },
    ...extras,
  };
}

function buildImageAssets(projectRoot) {
  const assetsDir = path.join(projectRoot, 'assets', 'freeport-template');
  const imagePath = path.join(assetsDir, 'hero-world.jpg');
  return {
    images: [
      {
        file: imagePath,
        page: 1,
        widthPx: 1600,
        heightPx: 900,
        contextSnippet: 'drilling context image for layout corpus',
        pageTextSnippet: 'drill overdrill cluster water fragmentation',
        semanticTags: ['drill', 'water', 'performance'],
      },
      {
        file: imagePath,
        page: 2,
        widthPx: 1600,
        heightPx: 900,
        contextSnippet: 'chart context image for layout corpus',
        pageTextSnippet: 'planned actual p80 energy cost',
        semanticTags: ['performance'],
      },
    ],
  };
}

function buildCorpusPlan() {
  const variants = [
    { layout: 'summary_card', variant: 'summary_card' },
    { layout: 'summary_card', variant: 'summary_band' },
    { layout: 'summary_card', variant: 'reconciliation' },
    { layout: 'two_column', variant: 'two_column' },
    { layout: 'two_column', variant: 'two_column_stagger' },
    { layout: 'two_column', variant: 'two_column_image', sourceRefs: ['PAGE 1: drill cluster image'] },
    { layout: 'metrics', variant: 'metrics' },
    { layout: 'metrics', variant: 'metrics_strip' },
    { layout: 'chart_bar', variant: 'chart_bar' },
    { layout: 'chart_bar', variant: 'chart_bar_focus' },
    { layout: 'chart_bar', variant: 'chart_bar_image', sourceRefs: ['PAGE 2: chart context image'] },
    { layout: 'action_split', variant: 'action_split' },
    { layout: 'action_split', variant: 'action_checklist' },
  ];

  const slides = variants.map(({ layout, variant, sourceRefs }) =>
    baseSlide(layout, variant, {
      sourceRefs: sourceRefs || ['PAGE 1: layout corpus sample'],
    })
  );

  return {
    deckTitle: 'Freeport Layout Corpus',
    deckSubtitle: 'All Renderer Variations',
    mainAnswer: 'This corpus displays each available layout variant for visual comparison.',
    supportingArguments: [
      { id: 'A1', claim: 'Variant-level examples accelerate developer design and QA workflows.' },
      { id: 'A2', claim: 'Consistent synthetic content isolates layout differences cleanly.' },
    ],
    slides,
  };
}

async function generateLayoutCorpus({
  outputPath,
  writePlan = true,
  writeImageManifest = true,
} = {}) {
  const projectRoot = path.resolve(__dirname, '..');
  const outPath = path.resolve(outputPath || path.join(projectRoot, 'output', 'layout-corpus.pptx'));
  const planOutPath = outPath.replace(/\.pptx$/i, '.plan.json');
  const manifestOutPath = outPath.replace(/\.pptx$/i, '.image-manifest.json');

  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const plan = buildCorpusPlan();
  const imageAssets = buildImageAssets(projectRoot);

  if (writePlan) {
    await fs.writeFile(planOutPath, JSON.stringify(plan, null, 2));
  }
  if (writeImageManifest) {
    await fs.writeFile(manifestOutPath, JSON.stringify(imageAssets, null, 2));
  }

  const written = await renderPlanToFreeportDeck({ plan, outputPath: outPath, imageAssets });
  return {
    deckPath: written,
    planPath: writePlan ? planOutPath : null,
    imageManifestPath: writeImageManifest ? manifestOutPath : null,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await generateLayoutCorpus({
    outputPath: args.output,
    writePlan: !args.noPlan,
    writeImageManifest: !args.noImageManifest,
  });

  console.log(`Layout corpus deck written: ${result.deckPath}`);
  if (result.planPath) {
    console.log(`Layout corpus plan written: ${result.planPath}`);
  }
  if (result.imageManifestPath) {
    console.log(`Layout corpus image manifest written: ${result.imageManifestPath}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  buildCorpusPlan,
  buildImageAssets,
  generateLayoutCorpus,
};
