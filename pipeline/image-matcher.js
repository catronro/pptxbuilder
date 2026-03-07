/**
 * Purpose:
 * Scores extracted image assets against slide semantics and returns a selector
 * that can pick the best unused image for each slide model.
 */
const path = require('node:path');
const fs = require('node:fs');

function sourceRefPages(sourceRefs = []) {
  const pages = [];
  for (const ref of sourceRefs) {
    const m = String(ref).match(/PAGE\s+(\d+)/i);
    if (!m) continue;
    const page = Number(m[1]);
    if (Number.isFinite(page) && page > 0) pages.push(page);
  }
  return [...new Set(pages)];
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'were', 'was', 'are', 'is', 'to', 'of', 'in',
  'on', 'by', 'at', 'as', 'vs', 'per', 'more', 'than', 'without', 'across', 'zone', 'zones', 'page',
  'slide', 'chart', 'table', 'figure', 'shows', 'show', 'using', 'used',
]);

function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && t.length > 2 && !STOPWORDS.has(t));
}

function overlapScore(queryTokens = [], candidateTokens = []) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const q = new Set(queryTokens);
  const c = new Set(candidateTokens);
  let overlap = 0;
  for (const t of q) {
    if (c.has(t)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(q.size, c.size));
}

function overlapCount(queryTokens = [], candidateTokens = []) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const q = new Set(queryTokens);
  const c = new Set(candidateTokens);
  let overlap = 0;
  for (const t of q) {
    if (c.has(t)) overlap += 1;
  }
  return overlap;
}

const CONCEPT_GROUPS = [
  ['overdrill', 'overdrilling', 'overdrilled', 'underdrill', 'underdrilling', 'drill', 'drilling', 'depth', 'holes'],
  ['water', 'wet', 'cluster', 'clustered', 'clusters'],
  ['energy', 'kcal', 'cost', 'fragmentation', 'p80'],
];

function conceptBoost(queryTokens = [], candidateTokens = []) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const q = new Set(queryTokens);
  const c = new Set(candidateTokens);
  let score = 0;
  for (const group of CONCEPT_GROUPS) {
    const qHit = group.some((t) => q.has(t));
    if (!qHit) continue;
    const matches = group.filter((t) => c.has(t)).length;
    if (matches >= 2) score += 0.1;
    else if (matches >= 1) score += 0.05;
  }
  return score;
}

function semanticConfidence(intentTokens = [], imageTokens = []) {
  const overlap = overlapCount(intentTokens, imageTokens);
  const sim = overlapScore(intentTokens, imageTokens);
  // Require both breadth (sim) and substance (count).
  const countNorm = Math.min(1, overlap / 6);
  return (sim * 0.7) + (countNorm * 0.3);
}

function buildImageSelector(imageAssets) {
  const images = Array.isArray(imageAssets?.images) ? imageAssets.images : [];
  const perPage = new Map();
  const all = [];
  const used = new Set();

  for (const img of images) {
    const file = String(img?.file || '');
    const page = Number(img?.page);
    const widthPx = Number(img?.widthPx || 0);
    const heightPx = Number(img?.heightPx || 0);
    if (!file || !Number.isFinite(page) || page <= 0) continue;
    if (!fs.existsSync(file)) continue;
    const contextTokens = tokenize(`${img?.contextSnippet || ''} ${path.basename(file)}`);
    const pageTokens = tokenize(`${img?.pageTextSnippet || ''}`);
    const semanticTokens = Array.isArray(img?.semanticTerms) && img.semanticTerms.length
      ? img.semanticTerms.map((t) => String(t).toLowerCase())
      : [...new Set([...contextTokens, ...pageTokens])];
    const enriched = {
      ...img,
      page,
      file,
      area: widthPx * heightPx,
      contextTokens,
      pageTokens,
      semanticTokens,
    };
    const bucket = perPage.get(page) || [];
    bucket.push(enriched);
    perPage.set(page, bucket);
    all.push(enriched);
  }

  for (const bucket of perPage.values()) {
    bucket.sort((a, b) => (b.area || 0) - (a.area || 0));
  }

  function rankBestCandidate(candidates, queryTokens, pages) {
    let best = null;
    let bestScore = -1;
    let bestOverlap = 0;
    let bestSemantic = 0;
    for (const img of candidates) {
      const overlap = overlapCount(queryTokens, img.semanticTokens);
      const semantic = semanticConfidence(queryTokens, img.semanticTokens);
      const concept = conceptBoost(queryTokens, img.semanticTokens);
      const proximity = pages.includes(img.page) ? 0.07 : 0;
      const areaBonus = img.area > 0 ? Math.min(0.03, img.area / 25000000) : 0;
      const score = (semantic * 0.8) + (concept * 0.15) + proximity + areaBonus;
      if (score > bestScore) {
        bestScore = score;
        bestOverlap = overlap;
        bestSemantic = semantic;
        best = img;
      }
    }
    return {
      best,
      bestScore,
      bestOverlap,
      bestSemantic,
    };
  }

  return function selectForSlide(slideModel) {
    const pages = sourceRefPages(slideModel?.sourceRefs);
    const queryText = [
      slideModel?.title || '',
      slideModel?.summary || '',
      ...(Array.isArray(slideModel?.bullets) ? slideModel.bullets : []),
      slideModel?.leftTitle || '',
      ...(Array.isArray(slideModel?.leftBullets) ? slideModel.leftBullets : []),
      slideModel?.rightTitle || '',
      ...(Array.isArray(slideModel?.rightBullets) ? slideModel.rightBullets : []),
    ].join(' ');
    const queryTokens = tokenize(queryText);
    if (!queryTokens.length) return null;

    const pageCandidates = pages.flatMap((p) => perPage.get(p) || []).filter((img) => !used.has(img.file));
    const fallbackCandidates = all.filter((img) => !used.has(img.file));
    const candidates = pageCandidates.length ? pageCandidates : fallbackCandidates;
    if (!candidates.length) return null;

    const {
      best,
      bestScore,
      bestOverlap,
      bestSemantic,
    } = rankBestCandidate(candidates, queryTokens, pages);
    if (!best) return null;
    // Intent-first gating: if semantics do not align confidently, do not include image.
    if (bestOverlap < 2) return null;
    if (bestSemantic < 0.16) return null;
    if (bestScore < 0.22) return null;
    used.add(best.file);
    return best;
  };
}

module.exports = {
  buildImageSelector,
};
